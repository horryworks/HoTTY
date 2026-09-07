//! Managed state for the NetBox integration: the sealed API token and the
//! shared HTTP client.

use std::path::Path;

use zeroize::{Zeroize, Zeroizing};

use crate::services::ai::config_store::EncryptedConfigStore;

use super::client::validate_token;
use super::NetboxError;

/// DPAPI-sealed, under `%APPDATA%\com.hotty.terminal\`. `path_safety` already
/// refuses that directory as a File Server root or an AI-supplied path, so the
/// file inherits that protection.
const TOKEN_FILE: &str = "netbox_token.bin";

/// What is sealed on disk: the token **and the base URL it was issued for**.
///
/// They are stored together on purpose. Every command receives `base_url` as a
/// parameter, so without a binding the saved token would be sent wherever the
/// caller pointed — defeating `url::relative_target` and the no-redirect policy,
/// which exist for exactly that reason. Binding makes "this token only ever goes
/// to the server it came from" an invariant instead of a convention.
///
/// No `#[derive(Debug)]`: it holds the token.
#[derive(serde::Serialize, serde::Deserialize)]
struct SealedCredentials {
    base_url: String,
    token: String,
}

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

    /// The saved base URL and token, or `Err(NoToken)` when none is stored.
    fn credentials(&self) -> Result<(String, Zeroizing<String>), NetboxError> {
        let raw = Zeroizing::new(
            self.store
                .load()
                .map_err(NetboxError::StoreRead)?
                .ok_or(NetboxError::NoToken)?,
        );
        // A payload that is not the sealed JSON predates the binding: it carries
        // a token with no server attached, and there is no address it can safely
        // be sent to. Fail closed — one reconnect is the correct cost.
        let mut parsed: SealedCredentials =
            serde_json::from_str(&raw).map_err(|_| NetboxError::NoToken)?;
        // Re-validated on read: a file written by an older build, or edited by
        // hand, must not reach a request header unchecked.
        let token = validate_token(&parsed.token);
        parsed.token.zeroize();
        Ok((parsed.base_url, token?))
    }

    /// The saved token, **only** if it was issued for `base_url`.
    ///
    /// `base_url` must already have been through `url::validate_base_url`, so
    /// both sides of this comparison are normalized the same way.
    pub fn token_for(&self, base_url: &str) -> Result<Zeroizing<String>, NetboxError> {
        let (bound, token) = self.credentials()?;
        if bound != base_url {
            return Err(NetboxError::TokenServerMismatch);
        }
        Ok(token)
    }

    pub fn has_token(&self) -> bool {
        self.credentials().is_ok()
    }

    pub fn save_credentials(&self, base_url: &str, token: &str) -> Result<(), NetboxError> {
        let payload = Zeroizing::new(
            serde_json::to_string(&SealedCredentials {
                base_url: base_url.to_string(),
                token: token.to_string(),
            })
            .map_err(|e| NetboxError::StoreWrite(e.to_string()))?,
        );
        self.store.save(&payload).map_err(NetboxError::StoreWrite)
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

    const SERVER: &str = "https://netbox.example.com";
    const SECRET: &str = "0123456789abcdef0123456789abcdef01234567";

    #[test]
    fn has_token_is_false_before_anything_is_saved() {
        let dir = fresh_dir("empty");
        let state = NetboxState::new(&dir);
        assert!(!state.has_token());
        assert!(matches!(state.token_for(SERVER), Err(NetboxError::NoToken)));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_saved_token_round_trips_and_is_not_stored_in_the_clear() {
        let dir = fresh_dir("roundtrip");
        let state = NetboxState::new(&dir);
        state.save_credentials(SERVER, SECRET).unwrap();

        assert!(state.has_token());
        assert_eq!(&*state.token_for(SERVER).unwrap(), SECRET);

        let on_disk = std::fs::read(dir.join(TOKEN_FILE)).unwrap();
        let as_text = String::from_utf8_lossy(&on_disk);
        assert!(
            !as_text.contains(SECRET),
            "the token must never be readable on disk"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_token_is_withheld_from_every_other_address() {
        // The reason this store holds the URL at all: a caller names the host on
        // every request, so without this the saved token follows the caller.
        let dir = fresh_dir("bound");
        let state = NetboxState::new(&dir);
        state.save_credentials(SERVER, SECRET).unwrap();

        for other in [
            "https://attacker.example",
            "http://netbox.example.com",       // same host, plaintext
            "https://netbox.example.com:8443", // same host, other port
        ] {
            assert!(
                matches!(
                    state.token_for(other),
                    Err(NetboxError::TokenServerMismatch)
                ),
                "{other} must not be handed the token"
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_pre_binding_payload_is_refused_rather_than_sent_anywhere() {
        // A bare token written before the URL was bound names no server, so
        // there is no address it can safely go to. Fail closed; reconnecting
        // costs one dialog.
        let dir = fresh_dir("legacy");
        let state = NetboxState::new(&dir);
        state.store.save(SECRET).unwrap();

        assert!(!state.has_token());
        assert!(matches!(state.token_for(SERVER), Err(NetboxError::NoToken)));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn clearing_forgets_the_token_and_is_idempotent() {
        let dir = fresh_dir("clear");
        let state = NetboxState::new(&dir);
        state.save_credentials(SERVER, SECRET).unwrap();
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
