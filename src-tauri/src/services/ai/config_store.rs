//! DPAPI-encrypted single-file config persistence shared by AI providers.
//!
//! Every provider persisted its credentials the same way — encrypt a string,
//! write it to `<app_data_dir>/<name>`, read+decrypt on load, delete on logout —
//! with the I/O copy-pasted (and the error wording slightly divergent) across
//! four files. This type owns that I/O once. Each provider still serializes its
//! own payload: an API key for OpenAI/Anthropic, or a JSON blob of OAuth
//! tokens/project IDs for Gemini/Vertex.

use crate::services::atomic_file::atomic_write;
use crate::services::dpapi;
use std::path::{Path, PathBuf};

pub struct EncryptedConfigStore {
    path: PathBuf,
    tag: &'static str,
}

impl EncryptedConfigStore {
    pub fn new(dir: &Path, file_name: &str, tag: &'static str) -> Self {
        Self {
            path: dir.join(file_name),
            tag,
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Encrypt `plaintext` with DPAPI and write it to disk.
    pub fn save(&self, plaintext: &str) -> Result<(), String> {
        let encrypted = dpapi::encrypt_string(plaintext)?;
        // Atomic write so a crash or a concurrent save from another window can
        // never leave a truncated (unloadable) credential file.
        atomic_write(&self.path, encrypted.as_bytes())
            .map_err(|e| format!("Failed to save config: {e}"))?;
        log::debug!("[{}] Config saved", self.tag);
        Ok(())
    }

    /// Read and decrypt the stored config. Returns `Ok(None)` when the file is
    /// absent or decrypts to an empty payload (treated as "no config").
    pub fn load(&self) -> Result<Option<String>, String> {
        if !self.path.exists() {
            return Ok(None);
        }
        let encrypted = std::fs::read_to_string(&self.path)
            .map_err(|e| format!("Failed to read config: {e}"))?;
        // Trusted in-process read of HoTTY's own store, so pre-entropy blobs
        // written by a dev build before v2.0.0 are still accepted here.
        let plaintext = dpapi::decrypt_string_allow_legacy(&encrypted)?;
        if plaintext.is_empty() {
            return Ok(None);
        }
        Ok(Some(plaintext))
    }

    /// Remove the config file if present (best-effort; used on logout).
    pub fn delete(&self) {
        if self.path.exists() {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hotty_cfgstore_test_{tag}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn path_is_dir_join_file_name() {
        let dir = fresh_dir("path");
        let store = EncryptedConfigStore::new(&dir, "cfg.bin", "TEST");
        assert_eq!(store.path(), dir.join("cfg.bin").as_path());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_returns_none_when_file_absent() {
        let dir = fresh_dir("absent");
        let store = EncryptedConfigStore::new(&dir, "missing.bin", "TEST");
        assert_eq!(store.load().unwrap(), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_then_load_round_trips_plaintext() {
        let dir = fresh_dir("roundtrip");
        let store = EncryptedConfigStore::new(&dir, "cfg.bin", "TEST");
        store.save("super-secret-token").unwrap();
        assert!(store.path().exists(), "save must create the file");
        // The on-disk bytes must be encrypted, not the raw plaintext.
        let on_disk = std::fs::read_to_string(store.path()).unwrap();
        assert!(!on_disk.contains("super-secret-token"));
        assert_eq!(
            store.load().unwrap(),
            Some("super-secret-token".to_string())
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn saving_empty_payload_loads_as_none() {
        let dir = fresh_dir("empty");
        let store = EncryptedConfigStore::new(&dir, "cfg.bin", "TEST");
        store.save("").unwrap();
        // An empty decrypted payload is treated as "no config".
        assert_eq!(store.load().unwrap(), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn delete_removes_the_file_and_is_idempotent() {
        let dir = fresh_dir("delete");
        let store = EncryptedConfigStore::new(&dir, "cfg.bin", "TEST");
        store.save("x").unwrap();
        assert!(store.path().exists());
        store.delete();
        assert!(!store.path().exists());
        assert_eq!(store.load().unwrap(), None);
        // Best-effort: a second delete on an absent file must not panic.
        store.delete();
        let _ = std::fs::remove_dir_all(&dir);
    }
}
