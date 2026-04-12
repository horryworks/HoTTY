use base64::{engine::general_purpose::STANDARD as BASE64, Engine};

const SAFE_PREFIX: &str = "[SAFE]";
const LEGACY_PREFIX: &str = "[DPAPI]";

/// Encrypt a plaintext string using Windows DPAPI and return a `[SAFE]`-prefixed
/// base64-encoded ciphertext.
pub(crate) fn encrypt_string(plaintext: &str) -> Result<String, String> {
    let encrypted = crypt_protect(plaintext)?;
    let encoded = BASE64.encode(&encrypted);
    Ok(format!("{SAFE_PREFIX}{encoded}"))
}

/// Decrypt a `[SAFE]`- or `[DPAPI]`-prefixed ciphertext using Windows DPAPI.
/// If the input has no recognised prefix it is returned as-is (plaintext passthrough).
pub(crate) fn decrypt_string(ciphertext: &str) -> Result<String, String> {
    if let Some(b64) = ciphertext.strip_prefix(SAFE_PREFIX) {
        let bytes = BASE64.decode(b64).map_err(|e| format!("base64 decode error: {e}"))?;
        crypt_unprotect(&bytes)
    } else if let Some(b64) = ciphertext.strip_prefix(LEGACY_PREFIX) {
        let bytes = BASE64.decode(b64).map_err(|e| format!("base64 decode error: {e}"))?;
        crypt_unprotect(&bytes)
    } else {
        Ok(ciphertext.to_string())
    }
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

#[cfg(not(windows))]
fn crypt_protect(_plaintext: &str) -> Result<Vec<u8>, String> {
    Err("DPAPI is only available on Windows".into())
}

#[cfg(not(windows))]
fn crypt_unprotect(_encrypted: &[u8]) -> Result<String, String> {
    Err("DPAPI is only available on Windows".into())
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
            let encrypted = encrypt_string(plain).unwrap();
            assert!(encrypted.starts_with(SAFE_PREFIX));
            let decrypted = decrypt_string(&encrypted).unwrap();
            assert_eq!(decrypted, plain);
        }
    }

    #[test]
    fn decrypt_plaintext_passthrough() {
        let plain = "no-prefix-text";
        let result = decrypt_string(plain).unwrap();
        assert_eq!(result, plain);
    }
}
