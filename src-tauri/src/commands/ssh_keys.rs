//! Tauri commands for SSH key management.
//!
//! Thin: every rule lives in `services::ssh_keys`, which is where it can be
//! unit-tested. These wrappers exist to move work off the async runtime
//! (`list_ssh_keys` walks a directory, `generate_ssh_key` can spend seconds on
//! RSA) and to convert typed errors into the strings the renderer shows.
//!
//! Note what is *not* here: there is no command that reads a private key. The
//! renderer can list keys, read the public half, and ask for one to be made or
//! removed -- nothing that returns key material.

use serde::Deserialize;
use tauri::AppHandle;
use zeroize::Zeroizing;

use crate::services::os_paths;
use crate::services::ssh_keys::{self, SshKeyAlgorithm, SshKeyInfo, SshKeyListResult};

/// Same bound the SSH config applies to a password or passphrase.
const MAX_PASSPHRASE_LEN: usize = 1024;

/// The non-secret half of a generate request.
///
/// The passphrase is deliberately a separate argument rather than a field here,
/// so this struct can derive `Debug` safely: if anyone ever writes
/// `log::debug!("{req:?}")`, there is no secret in it to leak.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateSshKeyRequest {
    pub name: String,
    pub algorithm: SshKeyAlgorithm,
    pub comment: Option<String>,
}

/// List the keys in `~/.ssh`.
///
/// A missing `~/.ssh` is not an error -- it is the ordinary state of a machine
/// that has never used SSH -- so it comes back as an empty list rather than a
/// failure. `available: false` is reserved for "there is nowhere safe to keep
/// keys at all".
#[tauri::command]
pub async fn list_ssh_keys(app: AppHandle) -> Result<SshKeyListResult, String> {
    tokio::task::spawn_blocking(move || ssh_keys::list_keys(&app))
        .await
        .map_err(|_| "Listing keys was interrupted".to_string())
}

/// Generate a key pair in `~/.ssh`.
#[tauri::command]
pub async fn generate_ssh_key(
    app: AppHandle,
    req: GenerateSshKeyRequest,
    passphrase: Option<String>,
) -> Result<SshKeyInfo, String> {
    // Wrapped immediately, so the plaintext is wiped when this scope ends no
    // matter which branch below returns.
    let passphrase = passphrase.map(Zeroizing::new);
    if let Some(pp) = &passphrase {
        if pp.len() > MAX_PASSPHRASE_LEN {
            return Err("That passphrase is too long".into());
        }
    }

    ssh_keys::generate_key(
        &app,
        &req.name,
        req.algorithm,
        req.comment.as_deref().unwrap_or_default(),
        passphrase,
    )
    .await
}

/// The single-line public key, for the clipboard and the `authorized_keys` box.
#[tauri::command]
pub async fn read_ssh_public_key(name: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || ssh_keys::read_public_key(&name))
        .await
        .map_err(|_| "Reading the public key was interrupted".to_string())?
}

/// Save the public key somewhere the user picks.
///
/// The dialog runs in the backend and the chosen path never reaches the
/// renderer, matching `export_htree` and `web_browser_export_bookmarks`. That
/// also keeps `dialog:allow-save` out of the capability file.
///
/// Returns false when the user cancels -- not an error.
#[tauri::command]
pub async fn export_ssh_public_key(app: AppHandle, name: String) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;

    let contents = ssh_keys::read_public_key(&name)?;
    let suggested = format!("{name}.pub");

    let file_path = app
        .dialog()
        .file()
        .add_filter("SSH public key", &["pub"])
        .set_file_name(&suggested)
        .blocking_save_file();

    let Some(path) = file_path else {
        return Ok(false);
    };
    let path = path
        .as_path()
        .ok_or_else(|| "That location cannot be used".to_string())?;
    std::fs::write(path, format!("{contents}\n"))
        .map_err(|_| "Could not write the public key file".to_string())?;
    Ok(true)
}

/// Open `~/.ssh` in the file manager.
///
/// The folder only, never `/select,<file>` -- the reasoning, and the OS
/// branch, live in `os_paths::open_in_file_manager`.
#[tauri::command]
pub async fn open_ssh_key_folder() -> Result<(), String> {
    let dir = ssh_keys::ssh_dir().map_err(|e| e.to_string())?;
    if !dir.exists() {
        return Err("You do not have a .ssh folder yet".into());
    }

    os_paths::open_in_file_manager(&dir).map_err(|e| {
        // A raw io::Error reads as an OS string; keep the detail in the log.
        log::warn!("could not open the .ssh folder: {e}");
        "Could not open the folder".to_string()
    })?;

    Ok(())
}

/// Delete a key pair HoTTY generated.
///
/// `expected_fingerprint` is what the renderer believes it is deleting. It has
/// to agree with both the ledger and the file on disk; see
/// `ssh_keys::delete_key` for why all three are needed.
#[tauri::command]
pub async fn delete_ssh_key(
    app: AppHandle,
    name: String,
    expected_fingerprint: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || ssh_keys::delete_key(&app, &name, &expected_fingerprint))
        .await
        .map_err(|_| "Deleting the key was interrupted".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    // The commands themselves need an `AppHandle` and a Tauri runtime, so the
    // rules they enforce are tested in `services::ssh_keys`. What is worth
    // pinning here is the shape of the request as it arrives over IPC: the
    // renderer builds this object by hand, and a mismatch is a runtime-only bug.

    #[test]
    fn a_generate_request_deserializes_from_the_renderer_shape() {
        let json =
            r#"{"name":"id_ed25519_hotty","algorithm":"ed25519","comment":"alice@example.com"}"#;
        let req: GenerateSshKeyRequest = serde_json::from_str(json).expect("parse");
        assert_eq!(req.name, "id_ed25519_hotty");
        assert_eq!(req.algorithm, SshKeyAlgorithm::Ed25519);
        assert_eq!(req.comment.as_deref(), Some("alice@example.com"));
    }

    #[test]
    fn a_generate_request_may_omit_the_comment() {
        let json = r#"{"name":"id_rsa_hotty","algorithm":"rsa-3072"}"#;
        let req: GenerateSshKeyRequest = serde_json::from_str(json).expect("parse");
        assert_eq!(req.algorithm, SshKeyAlgorithm::Rsa3072);
        assert!(req.comment.is_none());
    }

    #[test]
    fn the_request_carries_no_secret() {
        // The passphrase is a separate argument on purpose, so `Debug` on this
        // struct can never print one. If a `passphrase` field is ever added,
        // this test should be the thing that stops it.
        let json = r#"{"name":"id_ed25519_hotty","algorithm":"ed25519","passphrase":"hunter2"}"#;
        let req: GenerateSshKeyRequest = serde_json::from_str(json).expect("parse");
        assert!(!format!("{req:?}").contains("hunter2"));
    }

    #[test]
    fn an_unknown_algorithm_is_refused_at_the_boundary() {
        let json = r#"{"name":"id_dsa","algorithm":"dsa-1024"}"#;
        assert!(serde_json::from_str::<GenerateSshKeyRequest>(json).is_err());
    }
}
