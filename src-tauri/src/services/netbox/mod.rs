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
    #[error(
        "Site ID field must be slug, facility, description, or cf:<custom field name>"
    )]
    SiteIdField,
    #[error("No NetBox API token is saved. Open Settings, NetBox and connect first.")]
    NoToken,
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
    #[error("Could not save the NetBox token: {0}")]
    Store(String),
}
