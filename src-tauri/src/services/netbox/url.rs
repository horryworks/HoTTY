//! URL validation for the NetBox base address, and the paginator guard.

use super::NetboxError;
use tauri::Url;

/// Generous, but bounded — a base URL is a host and maybe a port.
pub const MAX_URL_LEN: usize = 2048;

/// Validate and normalize a user-entered NetBox base URL to `scheme://host[:port]`.
///
/// The single implementation, called from every command, so the check cannot be
/// half-applied. Path, query, fragment **and userinfo** are dropped: a pasted
/// `https://alice:secret@netbox.example.com/dcim/sites/` must not carry
/// credentials into every request, nor double a slash onto `/api/dcim/regions/`.
///
/// ⚠️ Deliberately **not** an SSRF check, and this differs from Yagra on
/// purpose. Yagra is a server with a real SSRF surface, so it refuses loopback.
/// HoTTY is a desktop app: the person typing this URL is the person running the
/// app, and the app already opens SSH sessions to arbitrary hosts. A developer's
/// own `http://127.0.0.1:8000` NetBox is a legitimate user and is accepted —
/// see `a_loopback_url_is_accepted_on_purpose`.
pub fn validate_base_url(raw: &str) -> Result<String, NetboxError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(NetboxError::UrlEmpty);
    }
    if trimmed.len() > MAX_URL_LEN {
        return Err(NetboxError::UrlTooLong);
    }
    let url = Url::parse(trimmed).map_err(|_| NetboxError::UrlMalformed)?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(NetboxError::UrlScheme);
    }
    // `host_str` returns an IPv6 literal already bracketed (`[fd00::1]`), so
    // rebuilding from it round-trips without parsing the address ourselves.
    let host = url.host_str().filter(|h| !h.is_empty()).ok_or(NetboxError::UrlNoHost)?;

    let mut out = format!("{}://{}", url.scheme(), host);
    if let Some(port) = url.port() {
        out.push(':');
        out.push_str(&port.to_string());
    }
    Ok(out)
}

/// The path-and-query of a paginator's `next` link, ready to be re-joined onto
/// the base URL we validated.
///
/// 🚨 NetBox builds `next` from **its own** configured host, which need not be
/// the address we reached it on (reverse proxy, container hostname, split-horizon
/// DNS). Following it verbatim would send the next request — carrying
/// `Authorization: Token …` — to a host `validate_base_url` never saw. This
/// function is the single most important control in the whole integration.
pub fn relative_target(target: &str) -> Result<String, NetboxError> {
    let t = target.trim();
    if t.is_empty() {
        return Err(NetboxError::UrlMalformed);
    }
    // A protocol-relative `//host/path` would change the authority once joined,
    // so it is not treated as a path.
    if t.starts_with('/') && !t.starts_with("//") {
        if t.contains(['\\', '\r', '\n', ' ']) {
            return Err(NetboxError::UrlMalformed);
        }
        return Ok(t.to_string());
    }
    let url = Url::parse(t).map_err(|_| NetboxError::UrlMalformed)?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(NetboxError::UrlScheme);
    }
    let mut out = url.path().to_string();
    if let Some(q) = url.query() {
        out.push('?');
        out.push_str(q);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_and_normalizes_a_plain_https_url() {
        assert_eq!(
            validate_base_url("https://netbox.example.com").unwrap(),
            "https://netbox.example.com"
        );
    }

    #[test]
    fn strips_path_query_and_fragment() {
        assert_eq!(
            validate_base_url("https://netbox.example.com/dcim/sites/?q=x#top").unwrap(),
            "https://netbox.example.com"
        );
    }

    #[test]
    fn strips_userinfo() {
        // Credentials in the URL must never survive into every request.
        let out = validate_base_url("https://alice:secret@netbox.example.com/").unwrap();
        assert_eq!(out, "https://netbox.example.com");
        assert!(!out.contains("secret"));
        assert!(!out.contains("alice"));
    }

    #[test]
    fn keeps_an_explicit_port() {
        assert_eq!(
            validate_base_url("http://192.0.2.10:8000/api/").unwrap(),
            "http://192.0.2.10:8000"
        );
    }

    #[test]
    fn round_trips_an_ipv6_literal() {
        assert_eq!(
            validate_base_url("http://[fd00::1]:8000/api/").unwrap(),
            "http://[fd00::1]:8000"
        );
    }

    #[test]
    fn a_loopback_url_is_accepted_on_purpose() {
        // Pins the deliberate divergence from Yagra: a developer's own NetBox
        // on localhost is a legitimate HoTTY user. Do not "fix" this into an
        // SSRF ban — see the doc comment on `validate_base_url`.
        assert_eq!(
            validate_base_url("http://127.0.0.1:8000").unwrap(),
            "http://127.0.0.1:8000"
        );
        assert!(validate_base_url("http://localhost:8000").is_ok());
    }

    #[test]
    fn trims_surrounding_whitespace() {
        assert_eq!(
            validate_base_url("  https://netbox.example.com \n").unwrap(),
            "https://netbox.example.com"
        );
    }

    #[test]
    fn rejects_empty_and_blank() {
        assert!(matches!(validate_base_url(""), Err(NetboxError::UrlEmpty)));
        assert!(matches!(validate_base_url("   "), Err(NetboxError::UrlEmpty)));
    }

    #[test]
    fn rejects_other_schemes() {
        assert!(matches!(
            validate_base_url("ftp://netbox.example.com"),
            Err(NetboxError::UrlScheme)
        ));
        assert!(matches!(
            validate_base_url("file:///c:/netbox"),
            Err(NetboxError::UrlScheme)
        ));
        // `javascript:` has no host, so it fails parsing or the host check —
        // either way it never reaches a request.
        assert!(validate_base_url("javascript:alert(1)").is_err());
    }

    #[test]
    fn rejects_a_bare_hostname_with_no_scheme() {
        // Not a guess: prefixing https:// for the user would hide a typo.
        assert!(matches!(
            validate_base_url("netbox.example.com"),
            Err(NetboxError::UrlMalformed)
        ));
    }

    #[test]
    fn rejects_an_over_long_url() {
        let long = format!("https://{}.example.com", "a".repeat(MAX_URL_LEN));
        assert!(matches!(validate_base_url(&long), Err(NetboxError::UrlTooLong)));
    }

    #[test]
    fn relative_target_passes_a_path_through() {
        assert_eq!(
            relative_target("/api/dcim/sites/?limit=250&offset=250").unwrap(),
            "/api/dcim/sites/?limit=250&offset=250"
        );
    }

    #[test]
    fn relative_target_strips_the_host_netbox_put_on_next() {
        // The whole point: NetBox names its own host here, and the next request
        // carries the API token.
        assert_eq!(
            relative_target("https://netbox-internal.example/api/dcim/sites/?limit=250&offset=250")
                .unwrap(),
            "/api/dcim/sites/?limit=250&offset=250"
        );
    }

    #[test]
    fn a_next_link_can_never_redirect_the_token_to_another_host() {
        for hostile in [
            "https://evil.example/api/dcim/sites/",
            "http://169.254.169.254/latest/meta-data/",
            "https://user:pass@evil.example/api/",
        ] {
            let out = relative_target(hostile).unwrap();
            assert!(out.starts_with('/'), "must become a path: {out}");
            assert!(!out.contains("evil.example"), "host leaked into {out}");
            assert!(!out.contains("169.254"), "host leaked into {out}");
        }
    }

    #[test]
    fn relative_target_rejects_a_protocol_relative_link() {
        // `//evil.example/x` would change the authority once joined to the base.
        assert!(relative_target("//evil.example/api/").is_err());
    }

    #[test]
    fn relative_target_rejects_garbage() {
        assert!(relative_target("").is_err());
        assert!(relative_target("not a url").is_err());
        assert!(relative_target("ftp://netbox.example.com/api/").is_err());
    }
}
