use crate::services::dpapi::{decrypt_string, encrypt_string};

// ---------------------------------------------------------------------------
// dpapi_encrypt  — single value
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn dpapi_encrypt(plaintext: String) -> Result<String, String> {
    encrypt_string(&plaintext)
}

// ---------------------------------------------------------------------------
// dpapi_decrypt  — single value (supports [SAFE] and legacy [DPAPI])
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn dpapi_decrypt(ciphertext: String) -> Result<String, String> {
    decrypt_string(&ciphertext)
}

// ---------------------------------------------------------------------------
// dpapi_encrypt_batch
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn dpapi_encrypt_batch(values: Vec<String>) -> Result<Vec<String>, String> {
    values
        .into_iter()
        .map(|v| encrypt_string(&v))
        .collect()
}

// ---------------------------------------------------------------------------
// dpapi_decrypt_batch
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn dpapi_decrypt_batch(values: Vec<String>) -> Result<Vec<String>, String> {
    values
        .into_iter()
        .map(|v| decrypt_string(&v))
        .collect()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_decrypt_roundtrip() {
        if cfg!(windows) {
            let plain = "hello secret";
            let encrypted = dpapi_encrypt(plain.to_string()).unwrap();
            assert!(encrypted.starts_with("[SAFE]"));
            let decrypted = dpapi_decrypt(encrypted).unwrap();
            assert_eq!(decrypted, plain);
        }
    }

    #[test]
    fn decrypt_plaintext_passthrough() {
        let plain = "no-prefix-text";
        let result = dpapi_decrypt(plain.to_string()).unwrap();
        assert_eq!(result, plain);
    }

    #[test]
    fn batch_operations() {
        if cfg!(windows) {
            let values = vec!["a".to_string(), "b".to_string(), "c".to_string()];
            let encrypted = dpapi_encrypt_batch(values.clone()).unwrap();
            assert_eq!(encrypted.len(), 3);
            for e in &encrypted {
                assert!(e.starts_with("[SAFE]"));
            }
            let decrypted = dpapi_decrypt_batch(encrypted).unwrap();
            assert_eq!(decrypted, values);
        }
    }
}
