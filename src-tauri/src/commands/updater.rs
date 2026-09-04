//! Tauri commands for the updater. All logic lives in
//! [`crate::services::updater`]; this file is the boundary layer — argument
//! validation happens on the way in, `UpdaterError` becomes a string on the way
//! out (ADR-005).

use serde::Serialize;
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::commands::session::SessionState;
use crate::services::updater::{
    self, DialogLang, Relation, ReleaseEntry, UpdaterError, UpdaterState,
};

/// The "a newer version exists" payload behind the startup toast.
///
/// Kept as-is (field for field) so `UpdateInfo` in `src/types/appTypes.ts` and
/// the existing `UpdateNotification` tests keep working; only how it is sourced
/// changed.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub release_name: String,
    pub release_url: String,
    pub prerelease: bool,
    pub notes: String,
    pub is_newer: bool,
}

/// Is there a newer release worth telling the user about?
///
/// Now backed by the full release list rather than `/releases/latest`. That
/// endpoint filters pre-releases out server-side, which meant a user on a
/// `-betaN` build was never notified of anything — including the stable release
/// that superseded their beta. Channel policy lives in
/// `services::updater::select_latest`.
#[tauri::command]
pub async fn check_for_updates(
    app: tauri::AppHandle,
    state: tauri::State<'_, UpdaterState>,
) -> Result<Option<UpdateInfo>, String> {
    let current = app.package_info().version.to_string();
    let entries = updater::fetch_releases(&state, &current, false)
        .await
        .map_err(|e| e.to_string())?;
    let list: Vec<ReleaseEntry> = entries.into_iter().map(|(entry, _)| entry).collect();

    Ok(
        updater::select_latest(&list, &current).map(|entry| UpdateInfo {
            current_version: current.clone(),
            latest_version: entry.version.clone(),
            release_name: entry.name.clone(),
            release_url: entry.html_url.clone(),
            prerelease: entry.prerelease,
            notes: entry.notes.clone(),
            is_newer: true,
        }),
    )
}

/// Every installable release, newest first.
#[tauri::command]
pub async fn updater_list_releases(
    app: tauri::AppHandle,
    state: tauri::State<'_, UpdaterState>,
    refresh: bool,
) -> Result<Vec<ReleaseEntry>, String> {
    let current = app.package_info().version.to_string();
    updater::fetch_releases(&state, &current, refresh)
        .await
        .map(|entries| entries.into_iter().map(|(entry, _)| entry).collect())
        .map_err(|e| e.to_string())
}

/// Switch to `tag`: confirm, download, verify, then exit so the installer can
/// run.
///
/// The renderer supplies a tag and nothing else. The URL and the checksum come
/// from the list this process fetched, so a compromised renderer cannot aim the
/// downloader anywhere of its choosing (see `services::updater`).
///
/// Consent is taken through a native dialog rather than in the web layer: the
/// renderer can call this command, but it cannot fake the OS-level click, which
/// is the same reasoning as `open_external` and ADR-010.
#[tauri::command]
pub async fn updater_install_version(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, UpdaterState>,
    sessions: tauri::State<'_, SessionState>,
    tag: String,
    lang: DialogLang,
) -> Result<(), String> {
    let current = app.package_info().version.to_string();
    let (entry, asset) = updater::resolve_asset(&state, &current, &tag)
        .await
        .map_err(|e| e.to_string())?;

    let open_sessions = sessions.sessions.lock().await.len();
    let (title, body) = updater::dialog_strings(lang, &entry, &current, open_sessions);
    let kind = if entry.relation == Relation::Older {
        MessageDialogKind::Warning
    } else {
        MessageDialogKind::Info
    };
    let approved = app
        .dialog()
        .message(body)
        .title(title)
        .kind(kind)
        .buttons(MessageDialogButtons::OkCancel)
        .blocking_show();
    if !approved {
        return Ok(());
    }

    updater::prepare_install(&app, &state, &current, &tag, &asset, window.label())
        .await
        .map_err(|e| e.to_string())?;

    log::info!("updater: switching to {tag}; exiting to run the installer");
    // The installer itself is spawned from `RunEvent::Exit`, once the windows
    // and their webviews are gone. Doing it here instead would race NSIS's
    // `CheckIfAppIsRunning`, which under `/P` kills this process outright and
    // could cut off a localStorage flush mid-write.
    app.exit(0);
    Ok(())
}

/// Cancel a download in progress. Safe to call when nothing is running.
#[tauri::command]
pub async fn updater_cancel_install(state: tauri::State<'_, UpdaterState>) -> Result<(), String> {
    state.cancel();
    Ok(())
}

/// Launch the installer parked by a completed install, if any.
///
/// Called from `RunEvent::Exit` in `lib.rs` — see `updater_install_version`.
pub fn launch_pending_installer(app: &tauri::AppHandle) {
    let state: tauri::State<'_, UpdaterState> = app.state();
    state.launch_pending();
}

/// Convert an `UpdaterError` at the boundary. Kept as a named helper so the
/// error text the renderer sees has exactly one definition.
pub fn describe(err: &UpdaterError) -> String {
    err.to_string()
}

// The commands above all need an `AppHandle` or managed state, so they are not
// unit-testable here; the logic they wrap is covered in
// `services::updater`'s own test module.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_stringify_without_panicking() {
        assert_eq!(describe(&UpdaterError::InvalidTag), "invalid release tag");
        assert!(describe(&UpdaterError::UnknownTag("v9.9.9".into())).contains("v9.9.9"));
    }
}
