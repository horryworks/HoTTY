pub mod commands;
pub mod services;

use tauri::Manager;

use commands::ai::{
    ai_auth_auto, ai_auth_logout, ai_auth_start, ai_auth_status, ai_chat_cancel, ai_chat_clear,
    ai_chat_send, ai_list_locations, ai_list_models, ai_set_location, ai_set_provider,
    select_service_account_key_file, AIServiceState, ApprovedServiceAccountKeys,
};
use commands::dpapi::{dpapi_decrypt, dpapi_decrypt_batch, dpapi_encrypt, dpapi_encrypt_batch};
use commands::file_explorer::{file_explorer_get_drives, file_explorer_list_directory};
use commands::host_tree::{
    decrypt_import_file, export_htree, migrate_host_tree_credentials, select_import_file,
    ImportPathState,
};
use commands::iap_tunnel::{
    gce_iap_check_auth, gce_iap_check_gcloud, gce_iap_list_instances, gce_iap_list_projects,
    gce_iap_list_zones, gce_iap_respond_vm_start,
};
use commands::log_viewer::{confirm_log_dir, list_log_files, read_log_file};
use commands::ping_monitor::{
    ping_monitor_start, ping_monitor_stop, ping_monitor_update_interval,
    ping_monitor_update_targets,
};
use commands::session::{
    connect_session, disconnect_session, send_input, ssh_host_key_response, term_resize,
    update_session_logging, SessionState,
};
use commands::ssh_algorithms::{get_ssh_algorithms, save_ssh_algorithms};
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
use services::ai::providers::anthropic::AnthropicProvider;
use services::ai::providers::gemini::GeminiProvider;
use services::ai::providers::openai::OpenAIProvider;
use services::ai::providers::vertexai::VertexAIProvider;
use services::ai::{AIProviderRegistry, AIService};
use services::log_manager::LogManager;
use services::ping_monitor::PingMonitorState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(SessionState::new())
        .manage(LogManager::new())
        .manage(ImportPathState::new())
        .manage(ApprovedEditorPaths::new())
        .manage(ApprovedServiceAccountKeys::new())
        .manage(PingMonitorState::new())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let version = app.package_info().version.to_string();
                let _ = window.set_title(&format!("HoTTY v{}", version));
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

            let mut registry = AIProviderRegistry::new();
            registry.register(Box::new(OpenAIProvider::new(app_data_dir.clone())));
            registry.register(Box::new(AnthropicProvider::new(app_data_dir.clone())));
            registry.register(Box::new(GeminiProvider::new(app_data_dir.clone())));
            registry.register(Box::new(VertexAIProvider::new(app_data_dir)));

            let service = AIService::new(registry, "openai");
            app.manage(AIServiceState {
                service: tokio::sync::Mutex::new(service),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Session management
            connect_session,
            disconnect_session,
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
            // DPAPI encryption
            dpapi_encrypt,
            dpapi_decrypt,
            dpapi_encrypt_batch,
            dpapi_decrypt_batch,
            // Themes
            get_themes,
            save_custom_theme,
            delete_custom_theme,
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
            // GCE IAP tunnel
            gce_iap_check_gcloud,
            gce_iap_check_auth,
            gce_iap_list_projects,
            gce_iap_list_zones,
            gce_iap_list_instances,
            gce_iap_respond_vm_start,
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
