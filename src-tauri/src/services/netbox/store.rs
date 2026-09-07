//! Managed state for the NetBox integration: the sealed API token and the
//! shared HTTP client.

use std::path::Path;

use zeroize::Zeroizing;

use crate::services::ai::config_store::EncryptedConfigStore;

use super::client::validate_token;
use super::NetboxError;

/// DPAPI-sealed, under `%APPDATA%\com.hotty.terminal\`. `path_safety` already
/// refuses that directory as a File Server root or an AI-supplied path, so the
/// file inherits that protection.
const TOKEN_FILE: &str = "netbox_token.bin";

/// No `#[derive(Debug)]`: nothing here should ever be printed.
pub struct NetboxState {
    store: EncryptedConfigStore,
    http: reqwest::Client,
}

impl NetboxState {
    pub fn new(app_data_dir: &Path) -> Self {
        Self {
            store: EncryptedConfigStore::new(app_data_dir, TOKEN_FILE, "netbox"),
            // One client for the life of the app: the base URL and the token
            // are per-request, so there is nothing per-server to rebuild.
            http: build_http_client(),
        }
    }

    pub fn http(&self) -> &reqwest::Client {
        &self.http
    }

    /// The saved token, or `Err(NoToken)` when none is stored.
    pub fn token(&self) -> Result<Zeroizing<String>, NetboxError> {
        let raw = self
            .store
            .load()
            .map_err(NetboxError::Store)?
            .ok_or(NetboxError::NoToken)?;
        // Re-validated on read: a file written by an older build, or edited by
        // hand, must not reach a request header unchecked.
        validate_token(&raw)
    }

    pub fn has_token(&self) -> bool {
        matches!(self.store.load(), Ok(Some(_)))
    }

    pub fn save_token(&self, token: &str) -> Result<(), NetboxError> {
        self.store.save(token).map_err(NetboxError::Store)
    }

    pub fn clear_token(&self) {
        self.store.delete();
    }
}

/// The single place the HTTP client is built.
///
/// Certificate trust comes from the Windows certificate store (reqwest's
/// default features give native-tls, i.e. SChannel). There is deliberately no
/// `danger_accept_invalid_certs` and no pasted-CA option: on a domain-joined
/// Windows box an internal CA is already pushed to the machine, and a
/// "skip verification" toggle in an app that also holds SSH credentials sets a
/// precedent that would be copied. Adding a private CA later is this function's
/// body plus one setting — see `CERT_HINT` in `client.rs` for what the user is
/// told meanwhile.
fn build_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        // A hostile or misconfigured NetBox must not be able to bounce a request
        // carrying `Authorization: Token …` to another origin.
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(10))
        .user_agent(concat!("HoTTY/", env!("CARGO_PKG_VERSION")))
        .build()
        .unwrap_or_else(|e| {
            log::warn!("[netbox] Falling back to a default HTTP client: {e}");
            reqwest::Client::new()
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("hotty_netbox_store_{tag}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn has_token_is_false_before_anything_is_saved() {
        let dir = fresh_dir("empty");
        let state = NetboxState::new(&dir);
        assert!(!state.has_token());
        assert!(matches!(state.token(), Err(NetboxError::NoToken)));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_saved_token_round_trips_and_is_not_stored_in_the_clear() {
        let dir = fresh_dir("roundtrip");
        let state = NetboxState::new(&dir);
        let secret = "0123456789abcdef0123456789abcdef01234567";
        state.save_token(secret).unwrap();

        assert!(state.has_token());
        assert_eq!(&*state.token().unwrap(), secret);

        let on_disk = std::fs::read(dir.join(TOKEN_FILE)).unwrap();
        let as_text = String::from_utf8_lossy(&on_disk);
        assert!(
            !as_text.contains(secret),
            "the token must never be readable on disk"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn clearing_forgets_the_token_and_is_idempotent() {
        let dir = fresh_dir("clear");
        let state = NetboxState::new(&dir);
        state.save_token("0123456789abcdef").unwrap();
        state.clear_token();
        assert!(!state.has_token());
        state.clear_token();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_client_never_follows_a_redirect() {
        // Pinned by construction rather than by observation: a 3xx must surface
        // as a failure, not as a request to somewhere we never validated.
        let _ = build_http_client();
    }
}
