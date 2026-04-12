pub mod commands;
pub mod services;

use commands::session::{
    connect_session, disconnect_session, send_input, ssh_host_key_response, term_resize,
    update_session_encoding, SessionState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Debug)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .manage(SessionState::new())
        .invoke_handler(tauri::generate_handler![
            connect_session,
            disconnect_session,
            send_input,
            term_resize,
            update_session_encoding,
            ssh_host_key_response,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
