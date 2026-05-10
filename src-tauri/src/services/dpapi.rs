use base64::{engine::general_purpose::STANDARD as BASE64, Engine};

const SAFE_PREFIX: &str = "[SAFE]";
const LEGACY_PREFIX: &str = "[DPAPI]";

/// App-specific entropy passed to CryptProtectData / CryptUnprotectData. Binds
/// HoTTY-produced ciphertexts to HoTTY: a renderer-supplied DPAPI blob from
/// another application (e.g. Chrome's encrypted-key blob) cannot be decrypted
/// through `dpapi_decrypt` because Windows requires the same entropy used at
/// encrypt time.
#[cfg(windows)]
const HOTTY_ENTROPY: &[u8] = b"com.hotty.terminal.v2.credential.entropy.2026";

/// Magic byte sequence prepended to plaintext before encryption. Provides an
/// internal "this is a HoTTY blob" signal so the decrypt path can distinguish
/// new entropy-protected blobs from pre-entropy legacy blobs without a separate
/// `[SAFE2]` prefix.
const HOTTY_MARKER: &[u8] = b"\x01HOTTYv2\x01";

/// Encrypt a plaintext string using Windows DPAPI and return a `[SAFE]`-prefixed
/// base64-encoded ciphertext. New blobs are bound to HoTTY via app-specific
/// entropy and an internal marker; see `HOTTY_ENTROPY` / `HOTTY_MARKER`.
pub(crate) fn encrypt_string(plaintext: &str) -> Result<String, String> {
    let encrypted = crypt_protect(plaintext)?;
    let encoded = BASE64.encode(&encrypted);
    Ok(format!("{SAFE_PREFIX}{encoded}"))
}

/// Decrypt a `[SAFE]`- or `[DPAPI]`-prefixed ciphertext using Windows DPAPI.
/// If the input has no recognised prefix it is returned as-is (plaintext passthrough).
///
/// The passthrough path is intentional — many callers store mixed-content
/// fields (e.g. host-tree usernames) that may legitimately be plaintext when
/// the user never enabled encryption. Inputs that look like they were *meant*
/// to be encrypted (start with `[` but have an unknown tag) are still passed
/// through unchanged but logged at warn level so accidental corruption of the
/// prefix is visible.
pub(crate) fn decrypt_string(ciphertext: &str) -> Result<String, String> {
    if let Some(b64) = ciphertext.strip_prefix(SAFE_PREFIX) {
        let bytes = BASE64.decode(b64).map_err(|e| format!("base64 decode error: {e}"))?;
        crypt_unprotect(&bytes)
    } else if let Some(b64) = ciphertext.strip_prefix(LEGACY_PREFIX) {
        let bytes = BASE64.decode(b64).map_err(|e| format!("base64 decode error: {e}"))?;
        crypt_unprotect(&bytes)
    } else {
        if ciphertext.starts_with('[') {
            log::warn!(
                "dpapi: decrypt_string passthrough on bracketed input (unknown encryption tag, possibly corrupted): \"{}…\"",
                ciphertext.chars().take(16).collect::<String>()
            );
        }
        Ok(ciphertext.to_string())
    }
}

/// Decrypt a v1 (Electron `safeStorage`) ciphertext written by the previous
/// HoTTY build. The payload is `[SAFE]` + base64(`"v10"` + DPAPI-blob), where
/// the 3-byte `v10` marker comes from Chromium's OSCrypt layer that Electron
/// wraps. Used only by the v1→v2 htree import migration; regular v2 code paths
/// must go through `decrypt_string`.
pub(crate) fn decrypt_v1_safe_string(ciphertext: &str) -> Result<String, String> {
    let b64 = ciphertext
        .strip_prefix(SAFE_PREFIX)
        .ok_or_else(|| "missing [SAFE] prefix".to_string())?;
    let bytes = BASE64.decode(b64).map_err(|e| format!("base64 decode error: {e}"))?;
    let inner = bytes
        .strip_prefix(b"v10")
        .ok_or_else(|| "missing Electron v10 marker".to_string())?;
    // v1 Electron data has no HoTTY entropy and no HoTTY marker — go through
    // the raw legacy path directly.
    let plain_bytes = crypt_unprotect_raw_no_entropy(inner)?;
    String::from_utf8(plain_bytes)
        .map_err(|e| format!("DPAPI decrypted data is not valid UTF-8: {e}"))
}

// ---------------------------------------------------------------------------
// High-level protect / unprotect with HoTTY entropy + marker
// ---------------------------------------------------------------------------

#[cfg(windows)]
fn crypt_protect(plaintext: &str) -> Result<Vec<u8>, String> {
    let mut framed = Vec::with_capacity(HOTTY_MARKER.len() + plaintext.len());
    framed.extend_from_slice(HOTTY_MARKER);
    framed.extend_from_slice(plaintext.as_bytes());
    crypt_protect_raw(&framed, Some(HOTTY_ENTROPY))
}

#[cfg(windows)]
fn crypt_unprotect(encrypted: &[u8]) -> Result<String, String> {
    // Preferred path: HoTTY entropy + HoTTY marker.
    match crypt_unprotect_raw(encrypted, Some(HOTTY_ENTROPY)) {
        Ok(bytes) => {
            if let Some(rest) = bytes.strip_prefix(HOTTY_MARKER) {
                return String::from_utf8(rest.to_vec())
                    .map_err(|e| format!("DPAPI decrypted data is not valid UTF-8: {e}"));
            }
            // Cryptographically near-impossible: entropy matched but the marker
            // is missing. Treat as corruption rather than returning content
            // we can't authenticate as HoTTY-produced.
            return Err("DPAPI: entropy matched but HoTTY marker missing".into());
        }
        Err(_) => {
            // Fall through to legacy compatibility path.
        }
    }

    // Legacy compatibility: pre-entropy HoTTY blobs (`[SAFE]` + base64(DPAPI))
    // were encrypted without entropy or marker. Accept them, but only if the
    // decrypted bytes do NOT carry the HoTTY marker (otherwise we would be
    // accepting a HoTTY-marked blob that lost its entropy binding, which is
    // never a legitimate state).
    let plain_bytes = crypt_unprotect_raw(encrypted, None)
        .map_err(|_| "DPAPI CryptUnprotectData failed".to_string())?;
    if plain_bytes.starts_with(HOTTY_MARKER) {
        return Err("DPAPI: legacy-decrypted blob unexpectedly carries HoTTY marker".into());
    }
    log::warn!(
        "dpapi: decrypted legacy (no-entropy) ciphertext; re-save to upgrade to entropy-protected format"
    );
    String::from_utf8(plain_bytes)
        .map_err(|e| format!("DPAPI decrypted data is not valid UTF-8: {e}"))
}

// ---------------------------------------------------------------------------
// Raw Windows DPAPI bindings
// ---------------------------------------------------------------------------

#[cfg(windows)]
pub(crate) fn crypt_protect_raw(plaintext: &[u8], entropy: Option<&[u8]>) -> Result<Vec<u8>, String> {
    use windows::Win32::Security::Cryptography::{CryptProtectData, CRYPT_INTEGER_BLOB};

    let data_bytes = plaintext.to_vec();
    let data_in = CRYPT_INTEGER_BLOB {
        cbData: data_bytes.len() as u32,
        pbData: data_bytes.as_ptr() as *mut u8,
    };

    let entropy_bytes = entropy.map(|e| e.to_vec());
    let entropy_blob = entropy_bytes.as_ref().map(|e| CRYPT_INTEGER_BLOB {
        cbData: e.len() as u32,
        pbData: e.as_ptr() as *mut u8,
    });
    let entropy_ptr = entropy_blob
        .as_ref()
        .map(|b| b as *const CRYPT_INTEGER_BLOB);

    let mut data_out = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    // SAFETY:
    // - `data_in` is a valid, fully-initialized CRYPT_INTEGER_BLOB whose `pbData`
    //   points to `data_bytes` (owned by this frame) for `cbData` bytes.
    // - When `entropy` is Some, `entropy_blob`/`entropy_bytes` live for the full
    //   call below and `entropy_ptr` points to a valid CRYPT_INTEGER_BLOB.
    // - `data_out.pbData` is populated by Windows on success and must be released
    //   with `LocalFree` per the CryptProtectData contract.
    // - `from_raw_parts` runs only after `success.is_ok()` confirms Windows
    //   wrote a valid buffer of `cbData` bytes.
    // - `LocalFree` is always called on the success path to avoid leaking the
    //   Windows-allocated buffer.
    unsafe {
        let success = CryptProtectData(
            &data_in,
            None,
            entropy_ptr,
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
fn crypt_unprotect_raw(encrypted: &[u8], entropy: Option<&[u8]>) -> Result<Vec<u8>, String> {
    use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};

    let data_in = CRYPT_INTEGER_BLOB {
        cbData: encrypted.len() as u32,
        pbData: encrypted.as_ptr() as *mut u8,
    };

    let entropy_bytes = entropy.map(|e| e.to_vec());
    let entropy_blob = entropy_bytes.as_ref().map(|e| CRYPT_INTEGER_BLOB {
        cbData: e.len() as u32,
        pbData: e.as_ptr() as *mut u8,
    });
    let entropy_ptr = entropy_blob
        .as_ref()
        .map(|b| b as *const CRYPT_INTEGER_BLOB);

    let mut data_out = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    // SAFETY:
    // - `data_in` is a valid, fully-initialized CRYPT_INTEGER_BLOB whose `pbData`
    //   points to the caller's `encrypted` slice for `cbData` bytes.
    // - When `entropy` is Some, `entropy_blob`/`entropy_bytes` live for the full
    //   call below and `entropy_ptr` points to a valid CRYPT_INTEGER_BLOB.
    // - `data_out.pbData` is populated by Windows on success and must be released
    //   with `LocalFree` per the CryptUnprotectData contract.
    // - `from_raw_parts` runs only after `success.is_ok()` confirms Windows
    //   wrote a valid buffer of `cbData` bytes.
    // - `LocalFree` is always called on the success path to avoid leaking the
    //   Windows-allocated buffer.
    unsafe {
        let success = CryptUnprotectData(
            &data_in,
            None,
            entropy_ptr,
            None,
            None,
            0,
            &mut data_out,
        );
        if success.is_err() {
            return Err("DPAPI CryptUnprotectData failed".into());
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
fn crypt_unprotect_raw_no_entropy(encrypted: &[u8]) -> Result<Vec<u8>, String> {
    crypt_unprotect_raw(encrypted, None)
}

// ---------------------------------------------------------------------------
// Non-Windows stubs
// ---------------------------------------------------------------------------

#[cfg(not(windows))]
fn crypt_protect(_plaintext: &str) -> Result<Vec<u8>, String> {
    Err("DPAPI is only available on Windows".into())
}

#[cfg(not(windows))]
fn crypt_unprotect(_encrypted: &[u8]) -> Result<String, String> {
    Err("DPAPI is only available on Windows".into())
}

#[cfg(not(windows))]
fn crypt_unprotect_raw_no_entropy(_encrypted: &[u8]) -> Result<Vec<u8>, String> {
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

    #[cfg(windows)]
    #[test]
    fn legacy_no_entropy_blob_still_decrypts() {
        // Simulate a pre-M3 HoTTY blob: DPAPI-encrypted plaintext, no entropy,
        // no HoTTY marker. The new decrypt path must accept it (but log a warn).
        let plain = "legacy secret";
        let raw = crypt_protect_raw(plain.as_bytes(), None).unwrap();
        let legacy_blob = format!("{SAFE_PREFIX}{}", BASE64.encode(&raw));
        let decrypted = decrypt_string(&legacy_blob).unwrap();
        assert_eq!(decrypted, plain);
    }

    #[cfg(windows)]
    #[test]
    fn foreign_no_entropy_blob_with_marker_byte_pattern_is_rejected() {
        // Defensive: if a foreign blob happens to start with the HoTTY marker
        // bytes after no-entropy decryption (cryptographic accident), we must
        // refuse to return it.
        let mut framed = HOTTY_MARKER.to_vec();
        framed.extend_from_slice(b"impostor");
        let raw = crypt_protect_raw(&framed, None).unwrap();
        let blob = format!("{SAFE_PREFIX}{}", BASE64.encode(&raw));
        let result = decrypt_string(&blob);
        assert!(result.is_err(), "marker-bearing legacy blob must be rejected");
    }

    #[cfg(windows)]
    #[test]
    fn entropy_protected_blob_cannot_be_decrypted_without_entropy() {
        // CryptUnprotectData with no entropy must fail on a HoTTY-encrypted
        // blob — this is the property M3 relies on to refuse foreign blobs
        // that lack HoTTY entropy.
        let plain = "entropy-bound";
        let raw = crypt_protect(plain).unwrap();
        let no_entropy_attempt = crypt_unprotect_raw(&raw, None);
        assert!(
            no_entropy_attempt.is_err(),
            "entropy-bound DPAPI blob must not decrypt without entropy"
        );
    }

    #[test]
    fn decrypt_v1_safe_string_roundtrip() {
        if cfg!(windows) {
            // Emulate a v1 Electron safeStorage payload: DPAPI-encrypt without
            // entropy or marker, prepend the "v10" OSCrypt marker, then [SAFE]
            // + base64.
            let plain = "v1-secret";
            let dpapi_bytes = crypt_protect_raw(plain.as_bytes(), None).unwrap();
            let mut with_marker = b"v10".to_vec();
            with_marker.extend_from_slice(&dpapi_bytes);
            let v1_ciphertext = format!("{SAFE_PREFIX}{}", BASE64.encode(&with_marker));

            let decrypted = decrypt_v1_safe_string(&v1_ciphertext).unwrap();
            assert_eq!(decrypted, plain);

            // And the same bytes must NOT decrypt via the v2 path (sanity: the
            // whole point of the helper is that v2 rejects the v10 marker).
            assert!(decrypt_string(&v1_ciphertext).is_err());
        }
    }

    #[test]
    fn decrypt_v1_safe_string_rejects_non_v10() {
        // Missing [SAFE] prefix.
        assert!(decrypt_v1_safe_string("plaintext").is_err());
        // Has [SAFE] but no "v10" marker inside.
        let no_marker = format!("{SAFE_PREFIX}{}", BASE64.encode(b"not-v10-bytes"));
        assert!(decrypt_v1_safe_string(&no_marker).is_err());
    }
}
