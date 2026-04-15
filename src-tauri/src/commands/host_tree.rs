use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use serde::Serialize;
use sha2::Sha256;
use std::sync::Arc;
use tauri::State;
use tauri_plugin_dialog::DialogExt;
use tokio::sync::Mutex;

use crate::services::dpapi::{decrypt_string, decrypt_v1_safe_string, encrypt_string};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Magic number at the start of every .htree file (ASCII "HOTTY").
const MAGIC: &[u8; 5] = b"HOTTY";

/// PBKDF2 iteration count — matches the Electron implementation.
const PBKDF2_ITERATIONS: u32 = 100_000;

/// AES-256 key length in bytes.
const KEY_LEN: usize = 32;

/// Salt length in bytes.
const SALT_LEN: usize = 16;

/// AES-GCM nonce (IV) length in bytes.
const NONCE_LEN: usize = 12;

/// AES-GCM authentication tag length in bytes.
const TAG_LEN: usize = 16;

/// Maximum number of host tree items that can be exported.
const MAX_ITEMS: usize = 50_000;

/// Maximum password length.
const MAX_PASSWORD_LEN: usize = 10_000;

/// Header size: MAGIC + SALT + NONCE + TAG.
const HEADER_SIZE: usize = MAGIC.len() + SALT_LEN + NONCE_LEN + TAG_LEN;

/// Crypto output: (salt, nonce, ciphertext_with_tag).
type CryptoPayload = (Vec<u8>, Vec<u8>, Vec<u8>);

// ---------------------------------------------------------------------------
// Managed state — server-side import path
// ---------------------------------------------------------------------------

/// Holds the file path selected by `select_import_file`, consumed once by
/// `decrypt_import_file`.  Stored server-side so the renderer can never
/// supply an arbitrary path.
pub struct ImportPathState {
    inner: Arc<Mutex<Option<String>>>,
}

impl Default for ImportPathState {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(None)),
        }
    }
}

impl ImportPathState {
    pub fn new() -> Self {
        Self::default()
    }
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct ExportResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

/// Derive a 256-bit key from a password and salt using PBKDF2-HMAC-SHA256.
fn derive_key(password: &str, salt: &[u8]) -> [u8; KEY_LEN] {
    let mut key = [0u8; KEY_LEN];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, PBKDF2_ITERATIONS, &mut key);
    key
}

/// Encrypt `plaintext` with AES-256-GCM.  Returns `(salt, nonce, ciphertext_with_tag)`.
fn encrypt_aes256gcm(
    password: &str,
    plaintext: &[u8],
) -> Result<CryptoPayload, String> {
    let mut salt = vec![0u8; SALT_LEN];
    rand::thread_rng().fill_bytes(&mut salt);

    let mut nonce_bytes = vec![0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);

    let key = derive_key(password, &salt);
    let cipher =
        Aes256Gcm::new_from_slice(&key).map_err(|e| format!("cipher init failed: {e}"))?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("encryption failed: {e}"))?;

    // aes-gcm appends the 16-byte tag to the ciphertext automatically
    Ok((salt, nonce_bytes, ciphertext))
}

/// Decrypt `ciphertext_with_tag` using AES-256-GCM.
fn decrypt_aes256gcm(
    password: &str,
    salt: &[u8],
    nonce_bytes: &[u8],
    ciphertext_with_tag: &[u8],
) -> Result<Vec<u8>, String> {
    let key = derive_key(password, salt);
    let cipher =
        Aes256Gcm::new_from_slice(&key).map_err(|e| format!("cipher init failed: {e}"))?;
    let nonce = Nonce::from_slice(nonce_bytes);

    cipher
        .decrypt(nonce, ciphertext_with_tag)
        .map_err(|_| "decryption failed: wrong password or corrupted file".to_string())
}

/// Build the .htree binary payload:
/// `[MAGIC 5B][salt 16B][nonce 12B][tag 16B][encrypted_data]`
///
/// Note: aes-gcm crate appends the tag at the end of the ciphertext.
/// We extract the last 16 bytes as the tag and place it in the header
/// to match the original Electron format.
fn build_htree_payload(salt: &[u8], nonce: &[u8], ciphertext_with_tag: &[u8]) -> Vec<u8> {
    let ct_len = ciphertext_with_tag.len();
    let tag = &ciphertext_with_tag[ct_len - TAG_LEN..];
    let encrypted = &ciphertext_with_tag[..ct_len - TAG_LEN];

    let mut payload = Vec::with_capacity(HEADER_SIZE + encrypted.len());
    payload.extend_from_slice(MAGIC);
    payload.extend_from_slice(salt);
    payload.extend_from_slice(nonce);
    payload.extend_from_slice(tag);
    payload.extend_from_slice(encrypted);
    payload
}

/// Parse a .htree binary payload into `(salt, nonce, ciphertext_with_tag)`.
/// Reassembles the tag at the end of the ciphertext for the aes-gcm crate.
fn parse_htree_payload(data: &[u8]) -> Result<CryptoPayload, String> {
    if data.len() < HEADER_SIZE {
        return Err("file too small to be a valid .htree file".into());
    }

    if &data[..MAGIC.len()] != MAGIC {
        return Err("invalid file: missing HOTTY magic number".into());
    }

    let offset = MAGIC.len();
    let salt = data[offset..offset + SALT_LEN].to_vec();
    let nonce = data[offset + SALT_LEN..offset + SALT_LEN + NONCE_LEN].to_vec();
    let tag = data[offset + SALT_LEN + NONCE_LEN..HEADER_SIZE].to_vec();
    let encrypted = &data[HEADER_SIZE..];

    // Reassemble: ciphertext + tag (aes-gcm expects tag appended)
    let mut ciphertext_with_tag = Vec::with_capacity(encrypted.len() + TAG_LEN);
    ciphertext_with_tag.extend_from_slice(encrypted);
    ciphertext_with_tag.extend_from_slice(&tag);

    Ok((salt, nonce, ciphertext_with_tag))
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Export host tree data to an encrypted .htree file.
///
/// The `data` parameter is the JSON-serialized host tree array.
/// A native "Save" dialog lets the user choose the output path.
#[tauri::command]
pub async fn export_htree(
    app: tauri::AppHandle,
    data: String,
    password: String,
) -> Result<ExportResult, String> {
    // Validate inputs
    if password.is_empty() || password.len() > MAX_PASSWORD_LEN {
        return Ok(ExportResult {
            success: false,
            error: Some("password must be 1–10,000 characters".into()),
        });
    }

    // Validate data is valid JSON array and within size limit
    let items: Vec<serde_json::Value> =
        serde_json::from_str(&data).map_err(|e| format!("invalid JSON data: {e}"))?;
    if items.len() > MAX_ITEMS {
        return Ok(ExportResult {
            success: false,
            error: Some(format!("too many items: {} (max {MAX_ITEMS})", items.len())),
        });
    }

    // Encrypt
    let (salt, nonce, ciphertext) = encrypt_aes256gcm(&password, data.as_bytes())?;
    let payload = build_htree_payload(&salt, &nonce, &ciphertext);

    // Show save dialog
    let file_path = app
        .dialog()
        .file()
        .add_filter("HoTTY Host Tree", &["htree"])
        .set_file_name("hosts.htree")
        .blocking_save_file();

    let path = match file_path {
        Some(p) => p,
        None => {
            return Ok(ExportResult {
                success: false,
                error: Some("export cancelled".into()),
            });
        }
    };

    // Write file
    let path_ref = path
        .as_path()
        .ok_or_else(|| "invalid export path".to_string())?;
    std::fs::write(path_ref, &payload).map_err(|e| format!("failed to write file: {e}"))?;

    Ok(ExportResult {
        success: true,
        error: None,
    })
}

/// Open a file dialog for the user to select a .htree file for import.
/// The selected path is stored server-side and consumed by `decrypt_import_file`.
///
/// Returns the path string (for display) or `null` if cancelled.
#[tauri::command]
pub async fn select_import_file(
    app: tauri::AppHandle,
    import_state: State<'_, ImportPathState>,
) -> Result<Option<String>, String> {
    let file_path = app
        .dialog()
        .file()
        .add_filter("HoTTY Host Tree", &["htree"])
        .blocking_pick_file();

    let path = match file_path {
        Some(p) => p,
        None => {
            *import_state.inner.lock().await = None;
            return Ok(None);
        }
    };

    let path_str = path
        .as_path()
        .ok_or_else(|| "invalid import path".to_string())?
        .to_string_lossy()
        .to_string();

    *import_state.inner.lock().await = Some(path_str.clone());
    Ok(Some(path_str))
}

/// Decrypt a previously selected .htree file using the given password.
///
/// Security: reads from the server-side stored path, not from the renderer.
/// The stored path is consumed (cleared) after a single use.
#[tauri::command]
pub async fn decrypt_import_file(
    import_state: State<'_, ImportPathState>,
    password: String,
) -> Result<String, String> {
    // Validate password
    if password.is_empty() || password.len() > MAX_PASSWORD_LEN {
        return Err("password must be 1–10,000 characters".into());
    }

    // Take the stored path (single use)
    let path_str = import_state
        .inner
        .lock()
        .await
        .take()
        .ok_or("no import file selected — call select_import_file first")?;

    // Read file
    let data = std::fs::read(&path_str).map_err(|e| format!("failed to read file: {e}"))?;

    // Parse header
    let (salt, nonce, ciphertext_with_tag) = parse_htree_payload(&data)?;

    // Decrypt
    let plaintext = decrypt_aes256gcm(&password, &salt, &nonce, &ciphertext_with_tag)?;

    // Parse as UTF-8 and validate JSON
    let json_str =
        String::from_utf8(plaintext).map_err(|_| "decrypted data is not valid UTF-8")?;

    // Validate it's a JSON array
    let mut tree: Vec<serde_json::Value> =
        serde_json::from_str(&json_str).map_err(|e| format!("invalid host tree data: {e}"))?;

    // Migrate v1 (Electron safeStorage) credentials to v2 DPAPI in place.
    for node in tree.iter_mut() {
        migrate_credentials(node);
    }

    serde_json::to_string(&tree).map_err(|e| format!("failed to serialise host tree: {e}"))
}

/// Walk a host-tree node and, for every host entry, upgrade any `[SAFE]`-prefixed
/// `username` / `password` field that was written by the v1 Electron build
/// (`[SAFE]` + base64(`v10` + DPAPI-blob)) into the v2 format
/// (`[SAFE]` + base64(DPAPI-blob)). Fields that already decrypt under v2 are left
/// untouched. Fields that can't be decoded under either scheme are left as-is so
/// the user can re-enter them manually.
fn migrate_credentials(node: &mut serde_json::Value) {
    // Recurse into child folders first.
    if let Some(children) = node.get_mut("children").and_then(|c| c.as_array_mut()) {
        for child in children.iter_mut() {
            migrate_credentials(child);
        }
    }

    let is_host = node
        .get("type")
        .and_then(|t| t.as_str())
        .map(|t| t == "host")
        .unwrap_or(false);
    if !is_host {
        return;
    }

    let Some(entry) = node.get_mut("entry").and_then(|e| e.as_object_mut()) else {
        return;
    };

    for field in ["username", "password"] {
        let Some(current) = entry.get(field).and_then(|v| v.as_str()) else {
            continue;
        };
        if !current.starts_with("[SAFE]") && !current.starts_with("[DPAPI]") {
            continue;
        }

        // Already a valid v2 ciphertext? Leave it alone.
        if decrypt_string(current).is_ok() {
            continue;
        }

        match decrypt_v1_safe_string(current) {
            Ok(plain) => match encrypt_string(&plain) {
                Ok(v2_cipher) => {
                    entry.insert(field.to_string(), serde_json::Value::String(v2_cipher));
                }
                Err(e) => {
                    log::warn!("htree import: re-encrypt of migrated {field} failed: {e}");
                }
            },
            Err(e) => {
                log::warn!("htree import: could not migrate v1 {field}: {e}");
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_key_is_deterministic() {
        let salt = b"0123456789abcdef";
        let k1 = derive_key("password", salt);
        let k2 = derive_key("password", salt);
        assert_eq!(k1, k2);
    }

    #[test]
    fn derive_key_differs_with_different_passwords() {
        let salt = b"0123456789abcdef";
        let k1 = derive_key("alpha", salt);
        let k2 = derive_key("bravo", salt);
        assert_ne!(k1, k2);
    }

    #[test]
    fn derive_key_differs_with_different_salts() {
        let k1 = derive_key("password", b"salt_one________");
        let k2 = derive_key("password", b"salt_two________");
        assert_ne!(k1, k2);
    }

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let plaintext = b"hello, host tree!";
        let password = "test-password-123";

        let (salt, nonce, ciphertext) = encrypt_aes256gcm(password, plaintext).unwrap();
        let decrypted = decrypt_aes256gcm(password, &salt, &nonce, &ciphertext).unwrap();

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn wrong_password_fails() {
        let plaintext = b"secret data";
        let (salt, nonce, ciphertext) = encrypt_aes256gcm("correct", plaintext).unwrap();
        let result = decrypt_aes256gcm("wrong", &salt, &nonce, &ciphertext);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("wrong password or corrupted file"));
    }

    #[test]
    fn htree_payload_roundtrip() {
        let plaintext = br#"[{"id":"1","type":"folder","name":"Test"}]"#;
        let password = "export-password";

        let (salt, nonce, ciphertext) = encrypt_aes256gcm(password, plaintext).unwrap();
        let payload = build_htree_payload(&salt, &nonce, &ciphertext);

        // Verify magic
        assert_eq!(&payload[..5], b"HOTTY");

        // Verify total size: header + encrypted data (without tag since tag is in header)
        let ct_len = ciphertext.len() - TAG_LEN;
        assert_eq!(payload.len(), HEADER_SIZE + ct_len);

        // Parse back
        let (parsed_salt, parsed_nonce, parsed_ct) = parse_htree_payload(&payload).unwrap();
        assert_eq!(parsed_salt, salt);
        assert_eq!(parsed_nonce, nonce);
        assert_eq!(parsed_ct, ciphertext);

        // Decrypt from parsed
        let decrypted = decrypt_aes256gcm(password, &parsed_salt, &parsed_nonce, &parsed_ct).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn parse_htree_rejects_too_small() {
        let data = vec![0u8; 10];
        let result = parse_htree_payload(&data);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("too small"));
    }

    #[test]
    fn parse_htree_rejects_bad_magic() {
        let mut data = vec![0u8; HEADER_SIZE + 10];
        data[..5].copy_from_slice(b"WRONG");
        let result = parse_htree_payload(&data);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("magic number"));
    }

    #[test]
    fn build_htree_payload_format() {
        let salt = vec![1u8; SALT_LEN];
        let nonce = vec![2u8; NONCE_LEN];
        // Simulate ciphertext (10 bytes) + tag (16 bytes)
        let mut ct_with_tag = vec![3u8; 10];
        ct_with_tag.extend_from_slice(&[4u8; TAG_LEN]);

        let payload = build_htree_payload(&salt, &nonce, &ct_with_tag);

        // Check layout
        assert_eq!(&payload[0..5], b"HOTTY");
        assert_eq!(&payload[5..21], &[1u8; SALT_LEN]);
        assert_eq!(&payload[21..33], &[2u8; NONCE_LEN]);
        assert_eq!(&payload[33..49], &[4u8; TAG_LEN]); // tag
        assert_eq!(&payload[49..59], &[3u8; 10]); // encrypted data
    }

    #[test]
    fn empty_payload_encrypt_decrypt() {
        let plaintext = b"[]";
        let password = "p";
        let (salt, nonce, ct) = encrypt_aes256gcm(password, plaintext).unwrap();
        let payload = build_htree_payload(&salt, &nonce, &ct);
        let (s, n, c) = parse_htree_payload(&payload).unwrap();
        let dec = decrypt_aes256gcm(password, &s, &n, &c).unwrap();
        assert_eq!(dec, plaintext);
    }

    #[test]
    fn large_data_encrypt_decrypt() {
        // ~100KB of JSON data
        let item = r#"{"id":"abc","type":"host","name":"Server"}"#;
        let items: Vec<&str> = (0..1000).map(|_| item).collect();
        let json = format!("[{}]", items.join(","));

        let (salt, nonce, ct) = encrypt_aes256gcm("big-password", json.as_bytes()).unwrap();
        let payload = build_htree_payload(&salt, &nonce, &ct);
        let (s, n, c) = parse_htree_payload(&payload).unwrap();
        let dec = decrypt_aes256gcm("big-password", &s, &n, &c).unwrap();
        assert_eq!(dec, json.as_bytes());
    }

    #[test]
    fn import_path_state_starts_empty() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let state = ImportPathState::new();
        rt.block_on(async {
            assert!(state.inner.lock().await.is_none());
        });
    }

    #[test]
    fn migrate_credentials_upgrades_v1_safe_blobs() {
        if !cfg!(windows) {
            return;
        }
        use base64::{engine::general_purpose::STANDARD as BASE64, Engine};

        // Simulate v1 Electron safeStorage: [SAFE] + base64("v10" + DPAPI(plain)).
        let make_v1 = |plain: &str| {
            // Reach into dpapi's private crypt_protect via the public encrypt_string
            // path: v2 encrypt_string gives us a [SAFE]+base64(DPAPI) string, we
            // decode and prepend the v10 marker to build a fake v1 payload.
            let v2 = encrypt_string(plain).unwrap();
            let b64 = v2.strip_prefix("[SAFE]").unwrap();
            let dpapi_bytes = BASE64.decode(b64).unwrap();
            let mut v10 = b"v10".to_vec();
            v10.extend_from_slice(&dpapi_bytes);
            format!("[SAFE]{}", BASE64.encode(&v10))
        };

        let mut node = serde_json::json!({
            "id": "1",
            "type": "host",
            "name": "Server",
            "entry": {
                "username": make_v1("alice"),
                "password": make_v1("hunter2"),
            }
        });

        migrate_credentials(&mut node);

        let entry = node.get("entry").and_then(|e| e.as_object()).unwrap();
        let u = entry.get("username").and_then(|v| v.as_str()).unwrap();
        let p = entry.get("password").and_then(|v| v.as_str()).unwrap();

        // Migrated values are v2 [SAFE] and decrypt under the v2 path.
        assert!(u.starts_with("[SAFE]"));
        assert!(p.starts_with("[SAFE]"));
        assert_eq!(decrypt_string(u).unwrap(), "alice");
        assert_eq!(decrypt_string(p).unwrap(), "hunter2");
    }

    #[test]
    fn migrate_credentials_leaves_v2_blobs_untouched() {
        if !cfg!(windows) {
            return;
        }

        let v2_user = encrypt_string("bob").unwrap();
        let v2_pass = encrypt_string("s3cret").unwrap();

        let mut node = serde_json::json!({
            "id": "1",
            "type": "host",
            "name": "Server",
            "entry": {
                "username": v2_user.clone(),
                "password": v2_pass.clone(),
            }
        });

        migrate_credentials(&mut node);

        let entry = node.get("entry").and_then(|e| e.as_object()).unwrap();
        assert_eq!(entry.get("username").and_then(|v| v.as_str()).unwrap(), v2_user);
        assert_eq!(entry.get("password").and_then(|v| v.as_str()).unwrap(), v2_pass);
    }

    #[test]
    fn migrate_credentials_recurses_into_folders() {
        if !cfg!(windows) {
            return;
        }
        use base64::{engine::general_purpose::STANDARD as BASE64, Engine};

        let v2 = encrypt_string("nested-user").unwrap();
        let b64 = v2.strip_prefix("[SAFE]").unwrap();
        let dpapi_bytes = BASE64.decode(b64).unwrap();
        let mut v10 = b"v10".to_vec();
        v10.extend_from_slice(&dpapi_bytes);
        let v1 = format!("[SAFE]{}", BASE64.encode(&v10));

        let mut root = serde_json::json!({
            "id": "f1",
            "type": "folder",
            "name": "Folder",
            "children": [{
                "id": "h1",
                "type": "host",
                "name": "Inner",
                "entry": { "username": v1, "password": "" }
            }]
        });

        migrate_credentials(&mut root);

        let inner_user = root
            .pointer("/children/0/entry/username")
            .and_then(|v| v.as_str())
            .unwrap();
        assert_eq!(decrypt_string(inner_user).unwrap(), "nested-user");
    }

    #[test]
    fn import_path_state_set_and_take() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let state = ImportPathState::new();
        rt.block_on(async {
            *state.inner.lock().await = Some("/path/to/file.htree".into());
            let taken = state.inner.lock().await.take();
            assert_eq!(taken, Some("/path/to/file.htree".to_string()));
            // Second take returns None (single-use)
            assert!(state.inner.lock().await.is_none());
        });
    }
}
