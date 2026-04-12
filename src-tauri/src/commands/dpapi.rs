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
// dpapi_verify_user  — Windows LogonUser API
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn dpapi_verify_user(password: String) -> Result<bool, String> {
    verify_user_impl(&password)
}

// ---------------------------------------------------------------------------
// Platform-specific implementations
// ---------------------------------------------------------------------------

#[cfg(windows)]
fn verify_user_impl(password: &str) -> Result<bool, String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::Security::{
        LogonUserW, LOGON32_LOGON_INTERACTIVE, LOGON32_PROVIDER_DEFAULT,
    };

    let username = std::env::var("USERNAME")
        .map_err(|_| "USERNAME environment variable not set".to_string())?;

    let username_w: Vec<u16> = OsStr::new(&username).encode_wide().chain(Some(0)).collect();
    let dot_w: Vec<u16> = OsStr::new(".").encode_wide().chain(Some(0)).collect();
    let password_w: Vec<u16> = OsStr::new(password).encode_wide().chain(Some(0)).collect();

    unsafe {
        let mut token = windows::Win32::Foundation::HANDLE::default();
        let result = LogonUserW(
            windows::core::PCWSTR(username_w.as_ptr()),
            windows::core::PCWSTR(dot_w.as_ptr()),
            windows::core::PCWSTR(password_w.as_ptr()),
            LOGON32_LOGON_INTERACTIVE,
            LOGON32_PROVIDER_DEFAULT,
            &mut token,
        );
        if result.is_ok() {
            let _ = CloseHandle(token);
            Ok(true)
        } else {
            Ok(false)
        }
    }
}

#[cfg(not(windows))]
fn verify_user_impl(_password: &str) -> Result<bool, String> {
    Err("User verification is only available on Windows".into())
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
