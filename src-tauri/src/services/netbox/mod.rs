//! NetBox integration: a read-only mirror of one NetBox server's Regions and
//! Sites into the Host Tree.
//!
//! Only the HTTP and the API token live here. The reconcile — deciding which
//! folder is which object, what to rename, what to mark gone — is a pure
//! frontend function (`src/utils/netboxSync.ts`), so it can be unit-tested
//! without a server. This side's whole job is to hand that function a
//! validated, flattened snapshot.
//!
//! Security notes (`.claude/rules/security.md`):
//!   * The token is DPAPI-sealed on disk and never returned by any command.
//!   * **No `NetboxError` variant carries the token or a raw response body** —
//!     a NetBox error body can echo the request, and the request carries the
//!     `Authorization` header.
//!   * Only `GET` is ever issued.

pub mod client;
pub mod site_id;
pub mod store;
pub mod url;

pub use client::NetboxClient;
pub use store::NetboxState;

/// The only configurable server today. Mirrored in TypeScript as
/// `NETBOX_DEFAULT_SERVER` (`src/utils/netboxSync.ts`) — the two must agree, and
/// no compiler checks that, so change them together.
pub const DEFAULT_SERVER_KEY: &str = "default";

#[derive(Debug, thiserror::Error)]
pub enum NetboxError {
    #[error("NetBox URL is required")]
    UrlEmpty,
    #[error("NetBox URL is too long")]
    UrlTooLong,
    #[error("NetBox URL is not a valid address")]
    UrlMalformed,
    #[error("NetBox URL must start with http:// or https://")]
    UrlScheme,
    #[error("NetBox URL has no host")]
    UrlNoHost,
    #[error("NetBox API token is required")]
    TokenEmpty,
    #[error("NetBox API token is too long")]
    TokenTooLong,
    #[error("NetBox API token contains characters that cannot be sent in a request header")]
    TokenInvalidChars,
    #[error("Site ID field must be slug, facility, description, or cf:<custom field name>")]
    SiteIdField,
    #[error("No NetBox API token is saved. Open Settings, NetBox and connect first.")]
    NoToken,
    /// The saved token is bound to the address it was issued for. Neither URL
    /// is named here: this string reaches the renderer, and the whole point of
    /// the binding is that the token's server is not the caller's to choose.
    #[error(
        "The saved NetBox token was issued for a different server address. Reconnect in Settings."
    )]
    TokenServerMismatch,
    /// Already-formatted by `ai::errors::describe_http_error`, which caps and
    /// sanitizes any detail it takes from the body.
    #[error("{0}")]
    Http(String),
    /// Already-formatted transport failure (DNS, TLS, connection refused).
    #[error("{0}")]
    Transport(String),
    #[error("NetBox returned a response HoTTY could not read")]
    Decode,
    #[error("NetBox returned more than {0} pages of results; stopping")]
    TooManyPages(u32),
    #[error("A NetBox response was larger than HoTTY will read")]
    TooLarge,
    #[error("Could not read the saved NetBox token: {0}")]
    StoreRead(String),
    #[error("Could not save the NetBox token: {0}")]
    StoreWrite(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Mirrored in TypeScript as `NETBOX_DEFAULT_SERVER`. Nothing checks the two
    /// agree, so pin the literal on this side; a silent divergence would orphan
    /// every folder marker in the user's tree.
    #[test]
    fn the_default_server_key_is_the_one_typescript_writes() {
        assert_eq!(DEFAULT_SERVER_KEY, "default");
    }

    /// The security property this module is built around: an error string
    /// crosses to the renderer, and a NetBox error body can echo the request —
    /// which carries the `Authorization` header.
    #[test]
    fn no_error_message_can_carry_the_token() {
        const TOKEN: &str = "0123456789abcdef0123456789abcdef01234567";
        // Every variant that takes a payload, given a payload containing a
        // token. Only the pre-sanitized pass-through variants echo their input,
        // and those are fed by `describe_http_error`, never by a raw body.
        let carriers = [
            NetboxError::Http(TOKEN.to_string()),
            NetboxError::Transport(TOKEN.to_string()),
            NetboxError::StoreRead(TOKEN.to_string()),
            NetboxError::StoreWrite(TOKEN.to_string()),
        ];
        // Those four are the *only* variants able to echo anything at all, so
        // the check that matters is that no other variant has a payload slot.
        for e in &carriers {
            assert!(
                e.to_string().contains(TOKEN),
                "this test is only meaningful while these variants pass their payload through"
            );
        }

        // The variants a caller cannot influence must be constant strings.
        for e in [
            NetboxError::UrlEmpty,
            NetboxError::UrlTooLong,
            NetboxError::UrlMalformed,
            NetboxError::UrlScheme,
            NetboxError::UrlNoHost,
            NetboxError::TokenEmpty,
            NetboxError::TokenTooLong,
            NetboxError::TokenInvalidChars,
            NetboxError::SiteIdField,
            NetboxError::NoToken,
            NetboxError::TokenServerMismatch,
            NetboxError::Decode,
            NetboxError::TooLarge,
        ] {
            let msg = e.to_string();
            assert!(!msg.contains(TOKEN));
            assert!(!msg.is_empty());
        }
    }

    /// A read failure once reported itself as a failed save, which sends the
    /// user to look at the wrong thing.
    #[test]
    fn the_store_variants_say_which_direction_failed() {
        assert!(NetboxError::StoreRead("x".into())
            .to_string()
            .contains("read"));
        assert!(NetboxError::StoreWrite("x".into())
            .to_string()
            .contains("save"));
    }

    /// Neither URL is named: the whole point of the binding is that the token's
    /// server is not the caller's to choose, so the message must not confirm
    /// which address the caller guessed.
    #[test]
    fn the_mismatch_message_names_no_address() {
        let msg = NetboxError::TokenServerMismatch.to_string();
        assert!(!msg.contains("http"));
        assert!(msg.contains("Reconnect"));
    }

    #[test]
    fn the_page_limit_is_named_in_its_own_error() {
        assert!(NetboxError::TooManyPages(40).to_string().contains("40"));
    }
}
