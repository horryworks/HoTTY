pub mod commands;
pub mod services;

use std::sync::Arc;

use tauri::Manager;

use commands::ai::{
    ai_auth_auto, ai_auth_logout, ai_auth_start, ai_auth_status, ai_chat_cancel, ai_chat_clear,
    ai_chat_send, ai_classify_command, ai_list_locations, ai_list_models, ai_set_location,
    ai_set_provider, select_service_account_key_file, AIServiceState, ApprovedServiceAccountKeys,
};
use commands::dpapi::{dpapi_decrypt, dpapi_decrypt_batch, dpapi_encrypt, dpapi_encrypt_batch};
use commands::file_explorer::{file_explorer_get_drives, file_explorer_list_directory};
use commands::file_server::{
    file_server_firewall_allow, file_server_firewall_status, file_server_sftp_start,
    file_server_sftp_stop, file_server_tftp_start, file_server_tftp_stop,
};
use commands::host_tree::{
    decrypt_import_file, export_htree, migrate_host_tree_credentials, select_import_file,
    ImportPathState,
};
use commands::iap_tunnel::{
    gce_iap_check_auth, gce_iap_check_gcloud, gce_iap_get_cache, gce_iap_list_instances,
    gce_iap_list_projects, gce_iap_list_vm_actions, gce_iap_list_zones, gce_iap_refresh_cache,
    gce_iap_respond_vm_start, gce_iap_start_instance, gce_iap_stop_instance,
};
use commands::licenses::get_third_party_licenses;
use commands::log_viewer::{confirm_log_dir, list_log_files, read_log_file};
use commands::ping_monitor::{
    ping_monitor_start, ping_monitor_stop, ping_monitor_update_interval,
    ping_monitor_update_targets,
};
use commands::session::{
    connect_session, disconnect_session, list_all_sessions, send_input, ssh_host_key_response,
    term_resize, update_session_logging, SessionState,
};
use commands::ssh_algorithms::{get_ssh_algorithms, save_ssh_algorithms};
use commands::sync::broadcast_shared_change;
use commands::system::{
    detect_git_bash, focus_window, list_serial_ports, list_system_fonts, list_wsl_distributions,
    open_debug_log_folder, open_external, show_context_menu,
};
use commands::text_editor::{
    text_editor_approve_dropped_file, text_editor_open_file, text_editor_read_file,
    text_editor_save_file, text_editor_write_file, ApprovedEditorPaths,
};
use commands::themes::{delete_custom_theme, get_themes, save_custom_theme};
use commands::updater::check_for_updates;
use commands::utilities::{log_debug, select_folder, select_image};
use commands::watch::{clear_watch_buffer, get_watch_buffer, set_watching, take_watch_buffer};
use commands::web_browser::{
    web_browser_back, web_browser_clear_browsing_data, web_browser_create, web_browser_current_url,
    web_browser_destroy, web_browser_export_bookmarks, web_browser_forward,
    web_browser_import_bookmarks, web_browser_navigate, web_browser_reload, web_browser_set_bounds,
    web_browser_set_visible, web_browser_set_zoom, web_browser_stop,
};
use commands::window::{create_app_window, create_window, WindowCounterState};
use services::ai::providers::anthropic::AnthropicProvider;
use services::ai::providers::gemini::GeminiProvider;
use services::ai::providers::openai::OpenAIProvider;
use services::ai::providers::vertexai::VertexAIProvider;
use services::ai::{AIProviderRegistry, AIService};
use services::file_server::FileServerState;
use services::iap_tunnel::GcloudCacheState;
use services::log_manager::LogManager;
use services::ping_monitor::PingMonitorState;
use services::session_service::{PendingSizes, SessionOwners};
use services::watch_buffer::WatchBufferState;
use services::web_browser::WebBrowserState;

/// Disconnect and clean up every session owned by a window that just closed, so
/// closing one window never leaks another window's sockets/PTYs or its backend
/// watch/owner state. (Tauri exits the process when the last window closes, at
/// which point the OS reclaims everything regardless.)
fn cleanup_window_sessions(app: &tauri::AppHandle, label: &str) {
    let owners = app.state::<SessionOwners>();
    let ids = owners.sessions_for(label);
    if ids.is_empty() {
        return;
    }
    let watch = app.state::<WatchBufferState>();
    for id in &ids {
        watch.remove(id);
        owners.remove(id);
    }
    // This window may also have been WATCHING sessions owned by OTHER windows;
    // drop those watches so they don't leak (keeping the hot append path engaged
    // and buffering for a reader that no longer exists).
    watch.remove_watcher_for_window(label);
    let sessions = app.state::<SessionState>().sessions.clone();
    let log_manager = (*app.state::<LogManager>()).clone();
    tauri::async_runtime::spawn(async move {
        for id in &ids {
            log_manager.stop_logging(id).await;
        }
        // Remove every owned session under the map lock, then release the lock
        // before awaiting disconnect() — teardown of one window's sessions must
        // not block session commands from the surviving windows.
        let removed = {
            let mut map = sessions.lock().await;
            let mut v = Vec::new();
            for id in &ids {
                if let Some((service, _meta)) = map.remove(id) {
                    v.push(service);
                }
            }
            v
        };
        for shared in removed {
            let mut service = shared.lock().await;
            let _ = service.disconnect().await;
        }
    });
}

/// Stop the File Server (TFTP/SFTP) instances a closing window owned, so their
/// listeners don't outlive the window in this shared process. Mirrors
/// [`cleanup_window_sessions`]; a window that ran no File Server is a cheap no-op.
fn cleanup_window_file_servers(app: &tauri::AppHandle, label: &str) {
    let state = app.state::<FileServerState>();
    let tftp = state.tftp.clone();
    let sftp = state.sftp.clone();
    let label = label.to_string();
    tauri::async_runtime::spawn(async move {
        services::file_server::stop_servers_for_window(&tftp, &sftp, &label).await;
    });
}

/// Format the main window's title for a given app version (e.g. `HoTTY v2.0.9`).
/// Extracted from `setup` so the title contract has unit coverage without
/// booting a Tauri runtime.
fn main_window_title(version: &str) -> String {
    format!("HoTTY v{version}")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // MUST be the first plugin registered (tauri-plugin-single-instance
        // requirement). A second EXE launch is forwarded here instead of
        // starting a second process; we open a new window in the existing one.
        .plugin(tauri_plugin_single_instance::init(
            |app: &tauri::AppHandle, _argv: Vec<String>, _cwd: String| {
                if let Err(e) = create_app_window(app) {
                    log::error!("single-instance: failed to open new window: {e}");
                }
            },
        ))
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .manage(SessionState::new())
        .manage(LogManager::new())
        .manage(ImportPathState::new())
        .manage(ApprovedEditorPaths::new())
        .manage(ApprovedServiceAccountKeys::new())
        .manage(PingMonitorState::new())
        .manage(FileServerState::new())
        .manage(WebBrowserState::new())
        .manage(WindowCounterState::new())
        .manage(WatchBufferState::new())
        .manage(SessionOwners::new())
        .manage(PendingSizes::new())
        .manage(Arc::new(GcloudCacheState::new()))
        // When a window closes, tear down only the sessions and File Server
        // instances it owned (other windows keep running in this shared process).
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                cleanup_window_sessions(window.app_handle(), window.label());
                cleanup_window_file_servers(window.app_handle(), window.label());
            }
        })
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let version = app.package_info().version.to_string();
                let _ = window.set_title(&main_window_title(&version));
            }

            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to resolve app data directory");

            // Bootstrap LogManager's approved-log-dirs persistence. The file
            // is per-user under app_data_dir, so the renderer cannot write
            // to it; this lets users approve a logging folder once and not
            // be re-prompted on every app launch.
            {
                let log_mgr_state: tauri::State<LogManager> = app.state();
                let log_mgr = (*log_mgr_state).clone();
                let persist_path = app_data_dir.join("approved_log_dirs.json");
                tauri::async_runtime::block_on(async move {
                    log_mgr.set_persist_path(persist_path).await;
                    log_mgr.load_persisted_approvals().await;
                });
            }

            // Load the persisted GCP discovery snapshot so the GCP pane can show
            // the last-known projects/instances instantly on launch and then
            // revalidate in the background (stale-while-revalidate). The file is
            // per-user under app_data_dir and contains no secrets.
            {
                let gcp_cache: tauri::State<Arc<GcloudCacheState>> = app.state();
                let persist_path = app_data_dir.join("gcp_discovery_cache.json");
                gcp_cache.set_persist_path(persist_path);
                gcp_cache.load_persisted();
            }

            let mut registry = AIProviderRegistry::new();
            registry.register(Box::new(OpenAIProvider::new(app_data_dir.clone())));
            registry.register(Box::new(AnthropicProvider::new(app_data_dir.clone())));
            registry.register(Box::new(GeminiProvider::new(app_data_dir.clone())));
            registry.register(Box::new(VertexAIProvider::new(app_data_dir)));

            let service = AIService::new(registry, "openai");
            app.manage(AIServiceState {
                service: tokio::sync::RwLock::new(service),
                cancels: std::sync::Mutex::new(std::collections::HashMap::new()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Session management
            connect_session,
            disconnect_session,
            list_all_sessions,
            send_input,
            term_resize,
            update_session_logging,
            ssh_host_key_response,
            // System / utilities
            list_serial_ports,
            list_wsl_distributions,
            detect_git_bash,
            list_system_fonts,
            focus_window,
            show_context_menu,
            open_debug_log_folder,
            open_external,
            create_window,
            broadcast_shared_change,
            set_watching,
            get_watch_buffer,
            take_watch_buffer,
            clear_watch_buffer,
            // DPAPI encryption
            dpapi_encrypt,
            dpapi_decrypt,
            dpapi_encrypt_batch,
            dpapi_decrypt_batch,
            // Themes
            get_themes,
            save_custom_theme,
            delete_custom_theme,
            // Third-party licenses
            get_third_party_licenses,
            // SSH algorithms
            get_ssh_algorithms,
            save_ssh_algorithms,
            // Log viewer
            list_log_files,
            read_log_file,
            confirm_log_dir,
            // Host tree import/export
            export_htree,
            select_import_file,
            decrypt_import_file,
            migrate_host_tree_credentials,
            // Text editor
            text_editor_open_file,
            text_editor_save_file,
            text_editor_read_file,
            text_editor_write_file,
            text_editor_approve_dropped_file,
            // File explorer
            file_explorer_list_directory,
            file_explorer_get_drives,
            // Ping monitor
            ping_monitor_start,
            ping_monitor_stop,
            ping_monitor_update_targets,
            ping_monitor_update_interval,
            // File server (TFTP / SFTP)
            file_server_tftp_start,
            file_server_tftp_stop,
            file_server_sftp_start,
            file_server_sftp_stop,
            file_server_firewall_status,
            file_server_firewall_allow,
            // Web browser pane (embedded native webview)
            web_browser_create,
            web_browser_navigate,
            web_browser_current_url,
            web_browser_back,
            web_browser_forward,
            web_browser_reload,
            web_browser_stop,
            web_browser_set_bounds,
            web_browser_set_visible,
            web_browser_destroy,
            web_browser_set_zoom,
            web_browser_clear_browsing_data,
            web_browser_export_bookmarks,
            web_browser_import_bookmarks,
            // GCE IAP tunnel
            gce_iap_check_gcloud,
            gce_iap_check_auth,
            gce_iap_list_projects,
            gce_iap_list_zones,
            gce_iap_list_instances,
            gce_iap_respond_vm_start,
            gce_iap_get_cache,
            gce_iap_refresh_cache,
            gce_iap_start_instance,
            gce_iap_stop_instance,
            gce_iap_list_vm_actions,
            // Logging & file dialogs
            log_debug,
            select_image,
            select_folder,
            // AI
            ai_auth_start,
            ai_auth_auto,
            ai_auth_status,
            ai_auth_logout,
            ai_chat_send,
            ai_chat_cancel,
            ai_chat_clear,
            ai_classify_command,
            ai_list_models,
            ai_list_locations,
            ai_set_provider,
            ai_set_location,
            select_service_account_key_file,
            // Updater
            check_for_updates,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
//
// `run` boots a full Tauri runtime and `cleanup_window_sessions` needs a live
// `AppHandle`, so neither is unit-testable here; we cover only the pure
// `main_window_title` helper this module defines.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn main_window_title_formats_version() {
        assert_eq!(main_window_title("2.0.9-beta3"), "HoTTY v2.0.9-beta3");
        assert_eq!(main_window_title("1.0.0"), "HoTTY v1.0.0");
    }
}
