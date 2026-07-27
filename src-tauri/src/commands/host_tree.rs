use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use serde::Serialize;
use sha2::Sha256;
use std::sync::Arc;
use tauri::State;
use tauri_plugin_dialog::DialogExt;
use tokio::sync::Mutex;

use crate::services::dpapi::{
    decrypt_string, decrypt_string_allow_legacy, decrypt_v1_safe_string, encrypt_string,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Magic number at the start of legacy (v1) .htree files (ASCII "HOTTY").
/// v1 files use PBKDF2-HMAC-SHA256 key derivation.
const MAGIC: &[u8; 5] = b"HOTTY";

/// Magic number for v2 .htree files (ASCII "HTRE2"). v2 files use Argon2id key
/// derivation and carry a 1-byte format version immediately after the magic.
const MAGIC_V2: &[u8; 5] = b"HTRE2";

/// Current v2 format version. Selects the Argon2id parameter set below; bump it
/// (and branch in `parse_htree_payload`) if those parameters ever change.
const HTREE_V2_VERSION: u8 = 1;

/// PBKDF2 iteration count for the LEGACY reader. Matches the original Electron
/// implementation and is retained ONLY so existing v1 `.htree` files still
/// import. New exports use Argon2id (see `derive_key_argon2`).
const PBKDF2_ITERATIONS: u32 = 100_000;

/// Argon2id parameters for v2 exports (version 1): 64 MiB memory, 3 passes,
/// 1 lane — comfortably above OWASP 2023 minimums for an interactive, one-shot
/// export/import of a portable secret file.
const ARGON2_M_COST_KIB: u32 = 65_536;
const ARGON2_T_COST: u32 = 3;
const ARGON2_P_COST: u32 = 1;

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

/// Legacy (v1) header size: MAGIC + SALT + NONCE + TAG.
const HEADER_SIZE: usize = MAGIC.len() + SALT_LEN + NONCE_LEN + TAG_LEN;

/// v2 header size: MAGIC_V2 + VERSION(1) + SALT + NONCE + TAG.
const HEADER_SIZE_V2: usize = MAGIC_V2.len() + 1 + SALT_LEN + NONCE_LEN + TAG_LEN;

/// Crypto output: (salt, nonce, ciphertext_with_tag).
type CryptoPayload = (Vec<u8>, Vec<u8>, Vec<u8>);

/// A parsed .htree payload with its detected format:
/// (format, salt, nonce, ciphertext_with_tag).
type ParsedPayload = (HtreeFormat, Vec<u8>, Vec<u8>, Vec<u8>);

/// Which key-derivation scheme a parsed .htree payload uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HtreeFormat {
    /// Legacy v1: PBKDF2-HMAC-SHA256 (MAGIC = "HOTTY").
    LegacyPbkdf2,
    /// v2: Argon2id (MAGIC = "HTRE2").
    Argon2idV1,
}

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
/// LEGACY: used only to read v1 `.htree` files. New exports use Argon2id.
fn derive_key(password: &str, salt: &[u8]) -> [u8; KEY_LEN] {
    let mut key = [0u8; KEY_LEN];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, PBKDF2_ITERATIONS, &mut key);
    key
}

/// Derive a 256-bit key from a password and salt using Argon2id (memory-hard).
/// Used for all v2 `.htree` exports/imports.
fn derive_key_argon2(password: &str, salt: &[u8]) -> Result<[u8; KEY_LEN], String> {
    let params = Params::new(
        ARGON2_M_COST_KIB,
        ARGON2_T_COST,
        ARGON2_P_COST,
        Some(KEY_LEN),
    )
    .map_err(|e| format!("argon2 params invalid: {e}"))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; KEY_LEN];
    argon
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| format!("argon2 key derivation failed: {e}"))?;
    Ok(key)
}

/// AES-256-GCM encrypt with a precomputed key. Generates a fresh random nonce.
/// Returns `(nonce, ciphertext_with_tag)`.
fn aes_gcm_encrypt(key: &[u8; KEY_LEN], plaintext: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
    let mut nonce_bytes = vec![0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);

    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| format!("cipher init failed: {e}"))?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("encryption failed: {e}"))?;
    // aes-gcm appends the 16-byte tag to the ciphertext automatically.
    Ok((nonce_bytes, ciphertext))
}

/// AES-256-GCM decrypt with a precomputed key.
fn aes_gcm_decrypt(
    key: &[u8; KEY_LEN],
    nonce_bytes: &[u8],
    ciphertext_with_tag: &[u8],
) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| format!("cipher init failed: {e}"))?;
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ciphertext_with_tag)
        .map_err(|_| "decryption failed: wrong password or corrupted file".to_string())
}

/// Encrypt with an Argon2id-derived key (v2 path).
/// Returns `(salt, nonce, ciphertext_with_tag)`.
fn encrypt_aes256gcm_argon2(password: &str, plaintext: &[u8]) -> Result<CryptoPayload, String> {
    let mut salt = vec![0u8; SALT_LEN];
    rand::thread_rng().fill_bytes(&mut salt);
    let key = derive_key_argon2(password, &salt)?;
    let (nonce, ciphertext) = aes_gcm_encrypt(&key, plaintext)?;
    Ok((salt, nonce, ciphertext))
}

/// Decrypt a v2 (Argon2id) payload.
fn decrypt_aes256gcm_argon2(
    password: &str,
    salt: &[u8],
    nonce_bytes: &[u8],
    ciphertext_with_tag: &[u8],
) -> Result<Vec<u8>, String> {
    let key = derive_key_argon2(password, salt)?;
    aes_gcm_decrypt(&key, nonce_bytes, ciphertext_with_tag)
}

/// Decrypt a legacy v1 (PBKDF2) payload.
fn decrypt_aes256gcm(
    password: &str,
    salt: &[u8],
    nonce_bytes: &[u8],
    ciphertext_with_tag: &[u8],
) -> Result<Vec<u8>, String> {
    let key = derive_key(password, salt);
    aes_gcm_decrypt(&key, nonce_bytes, ciphertext_with_tag)
}

/// Legacy v1 (PBKDF2) encryption — retained for round-trip tests of the legacy
/// reader. New exports use [`encrypt_aes256gcm_argon2`].
#[cfg(test)]
fn encrypt_aes256gcm(password: &str, plaintext: &[u8]) -> Result<CryptoPayload, String> {
    let mut salt = vec![0u8; SALT_LEN];
    rand::thread_rng().fill_bytes(&mut salt);
    let key = derive_key(password, &salt);
    let (nonce, ciphertext) = aes_gcm_encrypt(&key, plaintext)?;
    Ok((salt, nonce, ciphertext))
}

/// Build a v2 (Argon2id) .htree binary payload:
/// `[MAGIC_V2 5B][VERSION 1B][salt 16B][nonce 12B][tag 16B][encrypted_data]`
///
/// Note: the aes-gcm crate appends the 16-byte tag at the end of the ciphertext.
/// We extract those last 16 bytes and place the tag in the header to match the
/// established on-disk layout.
fn build_htree_payload_v2(salt: &[u8], nonce: &[u8], ciphertext_with_tag: &[u8]) -> Vec<u8> {
    let ct_len = ciphertext_with_tag.len();
    let tag = &ciphertext_with_tag[ct_len - TAG_LEN..];
    let encrypted = &ciphertext_with_tag[..ct_len - TAG_LEN];

    let mut payload = Vec::with_capacity(HEADER_SIZE_V2 + encrypted.len());
    payload.extend_from_slice(MAGIC_V2);
    payload.push(HTREE_V2_VERSION);
    payload.extend_from_slice(salt);
    payload.extend_from_slice(nonce);
    payload.extend_from_slice(tag);
    payload.extend_from_slice(encrypted);
    payload
}

/// Build a legacy v1 (PBKDF2) .htree binary payload:
/// `[MAGIC 5B][salt 16B][nonce 12B][tag 16B][encrypted_data]`
/// Retained for round-trip tests of the legacy reader; new exports use
/// [`build_htree_payload_v2`].
#[cfg(test)]
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

/// Parse a .htree binary payload into `(format, salt, nonce, ciphertext_with_tag)`.
/// Detects the format from the magic number so legacy v1 (PBKDF2) files continue
/// to import while new files use the Argon2id v2 format. Reassembles the tag at
/// the end of the ciphertext for the aes-gcm crate.
fn parse_htree_payload(data: &[u8]) -> Result<ParsedPayload, String> {
    if data.len() < MAGIC.len() {
        return Err("file too small to be a valid .htree file".into());
    }

    let magic = &data[..MAGIC.len()];

    if magic == MAGIC {
        if data.len() < HEADER_SIZE {
            return Err("file too small to be a valid .htree file".into());
        }
        let offset = MAGIC.len();
        let salt = data[offset..offset + SALT_LEN].to_vec();
        let nonce = data[offset + SALT_LEN..offset + SALT_LEN + NONCE_LEN].to_vec();
        let tag = data[offset + SALT_LEN + NONCE_LEN..HEADER_SIZE].to_vec();
        let encrypted = &data[HEADER_SIZE..];

        let mut ciphertext_with_tag = Vec::with_capacity(encrypted.len() + TAG_LEN);
        ciphertext_with_tag.extend_from_slice(encrypted);
        ciphertext_with_tag.extend_from_slice(&tag);
        Ok((HtreeFormat::LegacyPbkdf2, salt, nonce, ciphertext_with_tag))
    } else if magic == MAGIC_V2 {
        if data.len() < HEADER_SIZE_V2 {
            return Err("file too small to be a valid .htree file".into());
        }
        let version = data[MAGIC_V2.len()];
        if version != HTREE_V2_VERSION {
            return Err(format!(
                "unsupported .htree v2 format version: {version} (this build supports {HTREE_V2_VERSION})"
            ));
        }
        let offset = MAGIC_V2.len() + 1;
        let salt = data[offset..offset + SALT_LEN].to_vec();
        let nonce = data[offset + SALT_LEN..offset + SALT_LEN + NONCE_LEN].to_vec();
        let tag = data[offset + SALT_LEN + NONCE_LEN..HEADER_SIZE_V2].to_vec();
        let encrypted = &data[HEADER_SIZE_V2..];

        let mut ciphertext_with_tag = Vec::with_capacity(encrypted.len() + TAG_LEN);
        ciphertext_with_tag.extend_from_slice(encrypted);
        ciphertext_with_tag.extend_from_slice(&tag);
        Ok((HtreeFormat::Argon2idV1, salt, nonce, ciphertext_with_tag))
    } else {
        Err("invalid file: missing HOTTY magic number".into())
    }
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

    // Encrypt (v2: Argon2id key derivation)
    let (salt, nonce, ciphertext) = encrypt_aes256gcm_argon2(&password, data.as_bytes())?;
    let payload = build_htree_payload_v2(&salt, &nonce, &ciphertext);

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

    // Parse header (format is detected from the magic number)
    let (format, salt, nonce, ciphertext_with_tag) = parse_htree_payload(&data)?;

    // Decrypt using the key-derivation scheme the file was written with.
    let plaintext = match format {
        HtreeFormat::Argon2idV1 => {
            decrypt_aes256gcm_argon2(&password, &salt, &nonce, &ciphertext_with_tag)?
        }
        HtreeFormat::LegacyPbkdf2 => {
            decrypt_aes256gcm(&password, &salt, &nonce, &ciphertext_with_tag)?
        }
    };

    // Parse as UTF-8 and validate JSON
    let json_str = String::from_utf8(plaintext).map_err(|_| "decrypted data is not valid UTF-8")?;

    // Validate it's a JSON array
    let mut tree: Vec<serde_json::Value> =
        serde_json::from_str(&json_str).map_err(|e| format!("invalid host tree data: {e}"))?;

    // Migrate v1 (Electron safeStorage) credentials to v2 DPAPI in place.
    for node in tree.iter_mut() {
        migrate_credentials(node);
    }

    serde_json::to_string(&tree).map_err(|e| format!("failed to serialise host tree: {e}"))
}

/// Migrate v1 (Electron `safeStorage`) credentials in a host-tree JSON string to
/// v2 (Rust DPAPI) format in place. Idempotent: v2 blobs and plaintext pass
/// through untouched. Plaintext never crosses IPC — the renderer only sees the
/// re-encrypted v2 ciphertext.
#[tauri::command]
pub fn migrate_host_tree_credentials(tree_json: String) -> Result<String, String> {
    let mut tree: Vec<serde_json::Value> =
        serde_json::from_str(&tree_json).map_err(|e| format!("invalid host tree JSON: {e}"))?;

    for node in tree.iter_mut() {
        migrate_credentials(node);
    }

    serde_json::to_string(&tree).map_err(|e| format!("failed to serialise host tree: {e}"))
}

/// Walk a host-tree node and upgrade every encrypted credential field on each
/// host entry to the current format (`[SAFE]` + base64(entropy-bound DPAPI blob
/// framed with `HOTTY_MARKER`)). Two legacy shapes are upgraded:
///
/// 1. **v1 Electron** — `[SAFE]` + base64(`v10` + DPAPI-blob).
/// 2. **Pre-entropy v2** — `[SAFE]` + base64(DPAPI-blob) with no entropy and no
///    marker, written by Rust dev builds before v2.0.0 (2026-05-10). These are
///    rejected by `decrypt_string`, so upgrading them here is what lets the IPC
///    decrypt path stay entropy-only without stranding anyone's credentials.
///
/// Fields that already decrypt under the current scheme are left untouched
/// (making this idempotent). Fields that can't be decoded under any scheme are
/// left as-is so the user can re-enter them manually.
///
/// The field list must stay in sync with what the frontend encrypts in
/// `useHostManager.encryptTree` — currently `username`, `password`, and
/// `privateKeyPassphrase`.
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

    for field in ["username", "password", "privateKeyPassphrase"] {
        let Some(current) = entry.get(field).and_then(|v| v.as_str()) else {
            continue;
        };
        if !current.starts_with("[SAFE]") && !current.starts_with("[DPAPI]") {
            continue;
        }

        // Already entropy-bound? Leave it alone (keeps this idempotent).
        if decrypt_string(current).is_ok() {
            continue;
        }

        // Try the pre-entropy v2 shape first, then the v1 Electron shape. Both
        // resolve to plaintext we immediately re-encrypt with entropy; the
        // plaintext never leaves this process.
        let recovered = decrypt_string_allow_legacy(current)
            .ok()
            // `decrypt_string_allow_legacy` passes unprefixed input straight
            // through, so guard against "recovering" the ciphertext itself.
            .filter(|plain| plain != current)
            .or_else(|| match decrypt_v1_safe_string(current) {
                Ok(plain) => Some(plain),
                Err(e) => {
                    log::warn!("htree migration: could not decode legacy {field}: {e}");
                    None
                }
            });

        let Some(plain) = recovered else { continue };
        match encrypt_string(&plain) {
            Ok(upgraded) => {
                entry.insert(field.to_string(), serde_json::Value::String(upgraded));
            }
            Err(e) => {
                log::warn!("htree migration: re-encrypt of upgraded {field} failed: {e}");
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
        let (fmt, parsed_salt, parsed_nonce, parsed_ct) = parse_htree_payload(&payload).unwrap();
        assert_eq!(fmt, HtreeFormat::LegacyPbkdf2);
        assert_eq!(parsed_salt, salt);
        assert_eq!(parsed_nonce, nonce);
        assert_eq!(parsed_ct, ciphertext);

        // Decrypt from parsed
        let decrypted =
            decrypt_aes256gcm(password, &parsed_salt, &parsed_nonce, &parsed_ct).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn parse_htree_rejects_too_small() {
        // Correct magic but truncated before the full header → "too small".
        let mut data = MAGIC.to_vec();
        data.extend_from_slice(&[0u8; 5]);
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
    fn argon2_key_derivation_is_deterministic_and_salt_sensitive() {
        let salt = b"0123456789abcdef";
        let k1 = derive_key_argon2("password", salt).unwrap();
        let k2 = derive_key_argon2("password", salt).unwrap();
        assert_eq!(k1, k2);
        let k3 = derive_key_argon2("password", b"fedcba9876543210").unwrap();
        assert_ne!(k1, k3);
        let k4 = derive_key_argon2("different", salt).unwrap();
        assert_ne!(k1, k4);
    }

    #[test]
    fn v2_payload_roundtrip() {
        let plaintext = br#"[{"id":"1","type":"host","name":"Srv"}]"#;
        let password = "v2-export-password";

        let (salt, nonce, ct) = encrypt_aes256gcm_argon2(password, plaintext).unwrap();
        let payload = build_htree_payload_v2(&salt, &nonce, &ct);

        // Magic + version header.
        assert_eq!(&payload[..5], b"HTRE2");
        assert_eq!(payload[5], HTREE_V2_VERSION);
        let ct_len = ct.len() - TAG_LEN;
        assert_eq!(payload.len(), HEADER_SIZE_V2 + ct_len);

        let (fmt, s, n, c) = parse_htree_payload(&payload).unwrap();
        assert_eq!(fmt, HtreeFormat::Argon2idV1);
        let dec = decrypt_aes256gcm_argon2(password, &s, &n, &c).unwrap();
        assert_eq!(dec, plaintext);
    }

    #[test]
    fn v2_wrong_password_fails() {
        let (salt, nonce, ct) = encrypt_aes256gcm_argon2("correct", b"secret data").unwrap();
        let result = decrypt_aes256gcm_argon2("wrong", &salt, &nonce, &ct);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("wrong password or corrupted file"));
    }

    #[test]
    fn parse_rejects_unknown_v2_version() {
        let (salt, nonce, ct) = encrypt_aes256gcm_argon2("p", b"[]").unwrap();
        let mut payload = build_htree_payload_v2(&salt, &nonce, &ct);
        payload[MAGIC_V2.len()] = 0xFF; // corrupt version byte
        let result = parse_htree_payload(&payload);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("unsupported .htree v2 format version"));
    }

    #[test]
    fn legacy_payload_still_parses_and_decrypts() {
        // A file written in the old PBKDF2 format must remain importable.
        let plaintext = b"[]";
        let password = "legacy-pw";
        let (salt, nonce, ct) = encrypt_aes256gcm(password, plaintext).unwrap();
        let payload = build_htree_payload(&salt, &nonce, &ct);

        let (fmt, s, n, c) = parse_htree_payload(&payload).unwrap();
        assert_eq!(fmt, HtreeFormat::LegacyPbkdf2);
        let dec = decrypt_aes256gcm(password, &s, &n, &c).unwrap();
        assert_eq!(dec, plaintext);
    }

    #[test]
    fn empty_payload_encrypt_decrypt() {
        let plaintext = b"[]";
        let password = "p";
        let (salt, nonce, ct) = encrypt_aes256gcm(password, plaintext).unwrap();
        let payload = build_htree_payload(&salt, &nonce, &ct);
        let (_f, s, n, c) = parse_htree_payload(&payload).unwrap();
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
        let (_f, s, n, c) = parse_htree_payload(&payload).unwrap();
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

    #[cfg(windows)]
    fn make_v1_test_blob(plain: &str) -> String {
        use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
        // Real v1 Electron safeStorage: [SAFE] + base64("v10" + DPAPI(plain))
        // where DPAPI was called WITHOUT app entropy and the plaintext had no
        // HoTTY marker. We use crypt_protect_raw with no entropy to faithfully
        // reproduce that on-disk shape.
        let dpapi_bytes =
            crate::services::dpapi::crypt_protect_raw(plain.as_bytes(), None).unwrap();
        let mut v10 = b"v10".to_vec();
        v10.extend_from_slice(&dpapi_bytes);
        format!("[SAFE]{}", BASE64.encode(&v10))
    }

    #[test]
    fn migrate_credentials_upgrades_v1_safe_blobs() {
        if !cfg!(windows) {
            return;
        }

        let make_v1 = make_v1_test_blob;

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

    /// Pre-entropy v2 blobs (Rust dev builds before v2.0.0) are rejected by
    /// `decrypt_string`, so the migration must recover them via the legacy path
    /// and re-encrypt with entropy — otherwise the entropy-only IPC decrypt
    /// path would strand those credentials. Covers `privateKeyPassphrase` too,
    /// which the frontend encrypts but this migration used to skip.
    #[test]
    fn migrate_credentials_upgrades_pre_entropy_blobs() {
        if !cfg!(windows) {
            return;
        }

        let legacy = |plain: &str| {
            let raw = crate::services::dpapi::test_support::legacy_no_entropy_blob(plain);
            assert!(
                decrypt_string(&raw).is_err(),
                "fixture must be un-decryptable under the strict path"
            );
            raw
        };

        let mut node = serde_json::json!({
            "id": "1",
            "type": "host",
            "name": "Server",
            "entry": {
                "username": legacy("alice"),
                "password": legacy("hunter2"),
                "privateKeyPassphrase": legacy("key-pass"),
            }
        });

        migrate_credentials(&mut node);

        let entry = node.get("entry").and_then(|e| e.as_object()).unwrap();
        for (field, expected) in [
            ("username", "alice"),
            ("password", "hunter2"),
            ("privateKeyPassphrase", "key-pass"),
        ] {
            let got = entry.get(field).and_then(|v| v.as_str()).unwrap();
            assert!(got.starts_with("[SAFE]"));
            assert_eq!(
                decrypt_string(got).unwrap(),
                expected,
                "{field} must now decrypt under the entropy-bound path"
            );
        }
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
        assert_eq!(
            entry.get("username").and_then(|v| v.as_str()).unwrap(),
            v2_user
        );
        assert_eq!(
            entry.get("password").and_then(|v| v.as_str()).unwrap(),
            v2_pass
        );
    }

    #[test]
    fn migrate_credentials_recurses_into_folders() {
        if !cfg!(windows) {
            return;
        }

        let v1 = make_v1_test_blob("nested-user");

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
    fn migrate_host_tree_credentials_migrates_v1_blobs() {
        if !cfg!(windows) {
            return;
        }

        let make_v1 = make_v1_test_blob;

        let tree_json = serde_json::json!([
            {
                "id": "f1",
                "type": "folder",
                "name": "Folder",
                "children": [{
                    "id": "h1",
                    "type": "host",
                    "name": "Inner",
                    "entry": { "username": make_v1("alice"), "password": make_v1("hunter2") }
                }]
            },
            {
                "id": "h2",
                "type": "host",
                "name": "Top",
                "entry": { "username": make_v1("bob"), "password": "" }
            }
        ])
        .to_string();

        let migrated = migrate_host_tree_credentials(tree_json).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&migrated).unwrap();

        let inner_user = parsed
            .pointer("/0/children/0/entry/username")
            .and_then(|v| v.as_str())
            .unwrap();
        let inner_pass = parsed
            .pointer("/0/children/0/entry/password")
            .and_then(|v| v.as_str())
            .unwrap();
        let top_user = parsed
            .pointer("/1/entry/username")
            .and_then(|v| v.as_str())
            .unwrap();

        assert_eq!(decrypt_string(inner_user).unwrap(), "alice");
        assert_eq!(decrypt_string(inner_pass).unwrap(), "hunter2");
        assert_eq!(decrypt_string(top_user).unwrap(), "bob");
    }

    #[test]
    fn migrate_host_tree_credentials_idempotent_for_v2() {
        if !cfg!(windows) {
            return;
        }

        let v2_user = encrypt_string("carol").unwrap();
        let v2_pass = encrypt_string("p@ss").unwrap();

        let tree_json = serde_json::json!([{
            "id": "h1",
            "type": "host",
            "name": "Server",
            "entry": { "username": v2_user.clone(), "password": v2_pass.clone() }
        }])
        .to_string();

        let migrated = migrate_host_tree_credentials(tree_json.clone()).unwrap();
        // Functional equivalence: re-running migration must still decrypt to the same plaintexts.
        let parsed: serde_json::Value = serde_json::from_str(&migrated).unwrap();
        let u = parsed
            .pointer("/0/entry/username")
            .and_then(|v| v.as_str())
            .unwrap();
        let p = parsed
            .pointer("/0/entry/password")
            .and_then(|v| v.as_str())
            .unwrap();
        assert_eq!(decrypt_string(u).unwrap(), "carol");
        assert_eq!(decrypt_string(p).unwrap(), "p@ss");

        // Strict identity: v2 blobs are left untouched, so the JSON string is byte-equal.
        assert_eq!(migrated, tree_json);
    }

    #[test]
    fn migrate_host_tree_credentials_rejects_invalid_json() {
        let result = migrate_host_tree_credentials("not json at all".into());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("invalid host tree JSON"));
    }

    #[test]
    fn migrate_host_tree_credentials_handles_empty_array() {
        let migrated = migrate_host_tree_credentials("[]".into()).unwrap();
        assert_eq!(migrated, "[]");
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
