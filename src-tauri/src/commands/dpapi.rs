use base64::{engine::general_purpose::STANDARD as BASE64, Engine};

const SAFE_PREFIX: &str = "[SAFE]";
const LEGACY_PREFIX: &str = "[DPAPI]";

// ---------------------------------------------------------------------------
// dpapi_encrypt  — single value
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn dpapi_encrypt(plaintext: String) -> Result<String, String> {
    let encrypted = crypt_protect(&plaintext)?;
    let encoded = BASE64.encode(&encrypted);
    Ok(format!("{SAFE_PREFIX}{encoded}"))
}

// ---------------------------------------------------------------------------
// dpapi_decrypt  — single value (supports [SAFE] and legacy [DPAPI])
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn dpapi_decrypt(ciphertext: String) -> Result<String, String> {
    if let Some(b64) = ciphertext.strip_prefix(SAFE_PREFIX) {
        let bytes = BASE64.decode(b64).map_err(|e| format!("base64 decode error: {e}"))?;
        crypt_unprotect(&bytes)
    } else if let Some(b64) = ciphertext.strip_prefix(LEGACY_PREFIX) {
        let bytes = BASE64.decode(b64).map_err(|e| format!("base64 decode error: {e}"))?;
        crypt_unprotect(&bytes)
    } else {
        // Not encrypted — return as-is (plaintext passthrough)
        Ok(ciphertext)
    }
}

// ---------------------------------------------------------------------------
// dpapi_encrypt_batch
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn dpapi_encrypt_batch(values: Vec<String>) -> Result<Vec<String>, String> {
    values.into_iter().map(dpapi_encrypt).collect()
}

// ---------------------------------------------------------------------------
// dpapi_decrypt_batch
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn dpapi_decrypt_batch(values: Vec<String>) -> Result<Vec<String>, String> {
    values.into_iter().map(dpapi_decrypt).collect()
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
fn crypt_protect(plaintext: &str) -> Result<Vec<u8>, String> {
    use windows::Win32::Security::Cryptography::{CryptProtectData, CRYPT_INTEGER_BLOB};

    let data_bytes = plaintext.as_bytes().to_vec();
    let data_in = CRYPT_INTEGER_BLOB {
        cbData: data_bytes.len() as u32,
        pbData: data_bytes.as_ptr() as *mut u8,
    };
    let mut data_out = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    unsafe {
        let success = CryptProtectData(
            &data_in,
            None,
            None,
            None,
            None,
            0,
            &mut data_out,
        );
        if success.is_err() {
            return Err("DPAPI CryptProtectData failed".into());
        }

        let slice = std::slice::from_raw_parts(data_out.pbData, data_out.cbData as usize);
        let result = slice.to_vec();
        let _ = windows::Win32::Foundation::LocalFree(
                windows::Win32::Foundation::HLOCAL(data_out.pbData as _),
            );
        Ok(result)
    }
}

#[cfg(windows)]
fn crypt_unprotect(encrypted: &[u8]) -> Result<String, String> {
    use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};

    let data_in = CRYPT_INTEGER_BLOB {
        cbData: encrypted.len() as u32,
        pbData: encrypted.as_ptr() as *mut u8,
    };
    let mut data_out = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    unsafe {
        let success = CryptUnprotectData(
            &data_in,
            None,
            None,
            None,
            None,
            0,
            &mut data_out,
        );
        if success.is_err() {
            return Err("DPAPI CryptUnprotectData failed".into());
        }

        let slice = std::slice::from_raw_parts(data_out.pbData, data_out.cbData as usize);
        let result = String::from_utf8(slice.to_vec())
            .map_err(|e| format!("DPAPI decrypted data is not valid UTF-8: {e}"))?;
        let _ = windows::Win32::Foundation::LocalFree(
                windows::Win32::Foundation::HLOCAL(data_out.pbData as _),
            );
        Ok(result)
    }
}

#[cfg(windows)]
fn verify_user_impl(password: &str) -> Result<bool, String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::Security::{LogonUserW, LOGON32_LOGON_INTERACTIVE, LOGON32_PROVIDER_DEFAULT};
    use windows::Win32::Foundation::CloseHandle;

    // Get current username from environment
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
fn crypt_protect(_plaintext: &str) -> Result<Vec<u8>, String> {
    Err("DPAPI is only available on Windows".into())
}

#[cfg(not(windows))]
fn crypt_unprotect(_encrypted: &[u8]) -> Result<String, String> {
    Err("DPAPI is only available on Windows".into())
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
        // This test only works on Windows
        if cfg!(windows) {
            let plain = "hello secret";
            let encrypted = dpapi_encrypt(plain.to_string()).unwrap();
            assert!(encrypted.starts_with(SAFE_PREFIX));
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
                assert!(e.starts_with(SAFE_PREFIX));
            }
            let decrypted = dpapi_decrypt_batch(encrypted).unwrap();
            assert_eq!(decrypted, values);
        }
    }
}
