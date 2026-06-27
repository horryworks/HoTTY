//! DPAPI-encrypted single-file config persistence shared by AI providers.
//!
//! Every provider persisted its credentials the same way — encrypt a string,
//! write it to `<app_data_dir>/<name>`, read+decrypt on load, delete on logout —
//! with the I/O copy-pasted (and the error wording slightly divergent) across
//! four files. This type owns that I/O once. Each provider still serializes its
//! own payload: an API key for OpenAI/Anthropic, or a JSON blob of OAuth
//! tokens/project IDs for Gemini/Vertex.

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
        std::fs::write(&self.path, &encrypted)
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
        let plaintext = dpapi::decrypt_string(&encrypted)?;
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
