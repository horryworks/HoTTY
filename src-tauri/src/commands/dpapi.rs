use crate::services::dpapi::{decrypt_string, encrypt_string};

// ---------------------------------------------------------------------------
// dpapi_encrypt  — single value
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn dpapi_encrypt(plaintext: String) -> Result<String, String> {
    encrypt_string(&plaintext)
}

// ---------------------------------------------------------------------------
// dpapi_decrypt  — single value
// ---------------------------------------------------------------------------

/// Decrypt one value. Entropy-bound only: pre-entropy blobs are rejected here
/// and upgraded by the host-tree migration instead (see `commands::host_tree`).
/// A single value fails loudly so the one caller that needs to know
/// (`useAiAuthOwner`) can react.
#[tauri::command]
pub fn dpapi_decrypt(ciphertext: String) -> Result<String, String> {
    decrypt_string(&ciphertext)
}

// ---------------------------------------------------------------------------
// dpapi_encrypt_batch
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn dpapi_encrypt_batch(values: Vec<String>) -> Result<Vec<String>, String> {
    values.into_iter().map(|v| encrypt_string(&v)).collect()
}

// ---------------------------------------------------------------------------
// dpapi_decrypt_batch
// ---------------------------------------------------------------------------

/// Decrypt many values, containing failures **per entry**.
///
/// `collect()` into a `Result` would abort the whole batch on the first bad
/// value: one undecryptable credential (wrong Windows profile, corrupted blob,
/// a pre-entropy blob the migration hasn't reached) would take every other
/// credential in the host tree down with it. Instead each failure becomes an
/// empty string and is logged with its index — the blast radius is the one
/// affected field, and an empty credential reads unambiguously as "re-enter
/// this" rather than being mistaken for a real secret or a ciphertext blob.
#[tauri::command]
pub fn dpapi_decrypt_batch(values: Vec<String>) -> Result<Vec<String>, String> {
    Ok(values
        .into_iter()
        .enumerate()
        .map(|(i, v)| {
            decrypt_string(&v).unwrap_or_else(|e| {
                log::warn!("dpapi: batch decrypt failed for entry {i}: {e}");
                String::new()
            })
        })
        .collect())
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

    /// One undecryptable entry must not take the rest of the batch with it —
    /// otherwise a single bad credential blanks every password in the host tree.
    #[test]
    fn batch_decrypt_contains_a_single_bad_entry() {
        if cfg!(windows) {
            let good = dpapi_encrypt("keep-me".to_string()).unwrap();
            // Valid base64, but not a DPAPI blob — decryption must fail.
            let bad = "[SAFE]bm90LWEtZHBhcGktYmxvYg==".to_string();

            let out =
                dpapi_decrypt_batch(vec![good.clone(), bad, good, "plain-username".to_string()])
                    .expect("batch itself must not fail");

            assert_eq!(out.len(), 4);
            assert_eq!(out[0], "keep-me");
            assert_eq!(out[1], "", "failed entry becomes empty, not ciphertext");
            assert_eq!(out[2], "keep-me", "entries after the failure still decrypt");
            assert_eq!(out[3], "plain-username", "unprefixed input passes through");
        }
    }
}
