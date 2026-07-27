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

/// Decrypt a `[SAFE]`- or `[DPAPI]`-prefixed ciphertext, requiring HoTTY entropy
/// **and** the HoTTY marker. This is the path the `dpapi_decrypt` /
/// `dpapi_decrypt_batch` IPC commands use, so a renderer-supplied blob produced
/// by another application can never be decrypted through them: the entropy
/// binding is what makes that impossible, and there is no no-entropy retry here.
///
/// Pre-entropy HoTTY blobs (written by Rust dev builds before v2.0.0) are
/// *rejected* by this function on purpose — they are upgraded in place by the
/// host-tree migration, which uses `decrypt_string_allow_legacy` instead.
///
/// If the input has no recognised prefix it is returned as-is (plaintext
/// passthrough). The passthrough path is intentional — many callers store
/// mixed-content fields (e.g. host-tree usernames) that may legitimately be
/// plaintext when the user never enabled encryption. Inputs that look like they
/// were *meant* to be encrypted (start with `[` but have an unknown tag) are
/// still passed through unchanged but logged at warn level so accidental
/// corruption of the prefix is visible.
pub(crate) fn decrypt_string(ciphertext: &str) -> Result<String, String> {
    decrypt_with(ciphertext, crypt_unprotect_strict)
}

/// Same as [`decrypt_string`], but additionally accepts pre-entropy HoTTY blobs
/// (no entropy, no marker) via a no-entropy retry.
///
/// **Not reachable from IPC.** Restricted to trusted in-process callers that
/// read HoTTY's own on-disk stores (`ai::config_store`, `sftp_server`) plus the
/// host-tree credential migration, which re-encrypts what it reads. Keeping the
/// no-entropy retry off the IPC surface is what preserves the guarantee stated
/// on `HOTTY_ENTROPY`; see also the migration in `commands::host_tree`.
///
/// The migration is the one caller whose *input* is renderer-supplied, so it can
/// in principle be used to launder a foreign no-entropy blob into an
/// entropy-bound one that `decrypt_string` will then open. That is accepted: a
/// no-entropy DPAPI blob is decryptable by *any* process running as the same
/// user, so an attacker who can already supply the blob bytes can call
/// `CryptUnprotectData` directly — the round-trip grants no capability it lacks.
/// The control this file enforces is against a renderer-only attacker, which
/// cannot obtain foreign blob bytes through HoTTY's IPC surface at all.
pub(crate) fn decrypt_string_allow_legacy(ciphertext: &str) -> Result<String, String> {
    decrypt_with(ciphertext, crypt_unprotect_allow_legacy)
}

fn decrypt_with(
    ciphertext: &str,
    unprotect: fn(&[u8]) -> Result<String, String>,
) -> Result<String, String> {
    let stripped = ciphertext
        .strip_prefix(SAFE_PREFIX)
        .or_else(|| ciphertext.strip_prefix(LEGACY_PREFIX));

    if let Some(b64) = stripped {
        let bytes = BASE64
            .decode(b64)
            .map_err(|e| format!("base64 decode error: {e}"))?;
        unprotect(&bytes)
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
    let bytes = BASE64
        .decode(b64)
        .map_err(|e| format!("base64 decode error: {e}"))?;
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

/// Entropy-bound decrypt: requires both `HOTTY_ENTROPY` and `HOTTY_MARKER`.
/// Never retries without entropy, so a foreign DPAPI blob cannot be decrypted
/// through it.
#[cfg(windows)]
fn crypt_unprotect_strict(encrypted: &[u8]) -> Result<String, String> {
    let bytes = crypt_unprotect_raw(encrypted, Some(HOTTY_ENTROPY))
        .map_err(|_| "DPAPI CryptUnprotectData failed".to_string())?;
    let rest = bytes.strip_prefix(HOTTY_MARKER).ok_or_else(|| {
        // Cryptographically near-impossible: entropy matched but the marker is
        // missing. Treat as corruption rather than returning content we can't
        // authenticate as HoTTY-produced.
        "DPAPI: entropy matched but HoTTY marker missing".to_string()
    })?;
    String::from_utf8(rest.to_vec())
        .map_err(|e| format!("DPAPI decrypted data is not valid UTF-8: {e}"))
}

/// `crypt_unprotect_strict` plus a fallback for pre-entropy HoTTY blobs.
///
/// Only for trusted in-process callers — see `decrypt_string_allow_legacy`.
#[cfg(windows)]
fn crypt_unprotect_allow_legacy(encrypted: &[u8]) -> Result<String, String> {
    if let Ok(plain) = crypt_unprotect_strict(encrypted) {
        return Ok(plain);
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
pub(crate) fn crypt_protect_raw(
    plaintext: &[u8],
    entropy: Option<&[u8]>,
) -> Result<Vec<u8>, String> {
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
        let success = CryptProtectData(&data_in, None, entropy_ptr, None, None, 0, &mut data_out);
        if success.is_err() {
            return Err("DPAPI CryptProtectData failed".into());
        }

        let slice = std::slice::from_raw_parts(data_out.pbData, data_out.cbData as usize);
        let result = slice.to_vec();
        let _ = windows::Win32::Foundation::LocalFree(windows::Win32::Foundation::HLOCAL(
            data_out.pbData as _,
        ));
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
        let success = CryptUnprotectData(&data_in, None, entropy_ptr, None, None, 0, &mut data_out);
        if success.is_err() {
            return Err("DPAPI CryptUnprotectData failed".into());
        }

        let slice = std::slice::from_raw_parts(data_out.pbData, data_out.cbData as usize);
        let result = slice.to_vec();
        let _ = windows::Win32::Foundation::LocalFree(windows::Win32::Foundation::HLOCAL(
            data_out.pbData as _,
        ));
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
fn crypt_unprotect_strict(_encrypted: &[u8]) -> Result<String, String> {
    Err("DPAPI is only available on Windows".into())
}

#[cfg(not(windows))]
fn crypt_unprotect_allow_legacy(_encrypted: &[u8]) -> Result<String, String> {
    Err("DPAPI is only available on Windows".into())
}

#[cfg(not(windows))]
fn crypt_unprotect_raw_no_entropy(_encrypted: &[u8]) -> Result<Vec<u8>, String> {
    Err("DPAPI is only available on Windows".into())
}

// ---------------------------------------------------------------------------
// Test support
// ---------------------------------------------------------------------------

/// Fixtures shared with other modules' tests (notably the host-tree credential
/// migration). Kept here so the legacy wire format lives in exactly one place.
#[cfg(test)]
pub(crate) mod test_support {
    /// Build a pre-entropy HoTTY blob: DPAPI-encrypted, no entropy, no marker.
    /// Byte-identical to what a Rust dev build wrote before v2.0.0 — and also to
    /// any *other* application's no-entropy DPAPI blob, which is precisely why
    /// the strict path must refuse it.
    #[cfg(windows)]
    pub(crate) fn legacy_no_entropy_blob(plain: &str) -> String {
        use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
        let raw = super::crypt_protect_raw(plain.as_bytes(), None).unwrap();
        format!("{}{}", super::SAFE_PREFIX, BASE64.encode(&raw))
    }

    #[cfg(not(windows))]
    pub(crate) fn legacy_no_entropy_blob(_plain: &str) -> String {
        // Callers guard with `if !cfg!(windows) { return; }`; this exists only so
        // the test module still compiles off Windows.
        String::new()
    }
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
    use super::test_support::legacy_no_entropy_blob as make_legacy_blob;

    #[cfg(windows)]
    #[test]
    fn strict_decrypt_rejects_legacy_no_entropy_blob() {
        // The security property: `decrypt_string` (what the dpapi_decrypt IPC
        // commands use) must NOT retry without entropy, so a foreign no-entropy
        // DPAPI blob cannot be decrypted through it. This is the guarantee the
        // HOTTY_ENTROPY doc comment states.
        let blob = make_legacy_blob("legacy secret");
        assert!(
            decrypt_string(&blob).is_err(),
            "strict path must refuse a no-entropy blob"
        );
    }

    #[cfg(windows)]
    #[test]
    fn allow_legacy_decrypt_accepts_legacy_no_entropy_blob() {
        // The compatibility escape hatch, reachable only in-process: it is what
        // lets the host-tree migration recover a pre-entropy credential in order
        // to re-encrypt it with entropy.
        let plain = "legacy secret";
        let blob = make_legacy_blob(plain);
        assert_eq!(decrypt_string_allow_legacy(&blob).unwrap(), plain);
    }

    #[cfg(windows)]
    #[test]
    fn entropy_bound_blob_decrypts_through_both_paths() {
        let plain = "current-format secret";
        let blob = encrypt_string(plain).unwrap();
        assert_eq!(decrypt_string(&blob).unwrap(), plain);
        assert_eq!(decrypt_string_allow_legacy(&blob).unwrap(), plain);
    }

    #[cfg(windows)]
    #[test]
    fn foreign_no_entropy_blob_with_marker_byte_pattern_is_rejected() {
        // Defensive: if a foreign blob happens to start with the HoTTY marker
        // bytes after no-entropy decryption (cryptographic accident), we must
        // refuse to return it — on the legacy path too, which is the only one
        // that gets that far.
        let mut framed = HOTTY_MARKER.to_vec();
        framed.extend_from_slice(b"impostor");
        let raw = crypt_protect_raw(&framed, None).unwrap();
        let blob = format!("{SAFE_PREFIX}{}", BASE64.encode(&raw));
        assert!(
            decrypt_string(&blob).is_err(),
            "marker-bearing legacy blob must be rejected by the strict path"
        );
        let result = decrypt_string_allow_legacy(&blob);
        assert!(
            result.is_err(),
            "marker-bearing legacy blob must be rejected"
        );
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
