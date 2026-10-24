//! Validation of a user-entered server base URL, shared by every integration
//! that talks to a server the user names (NetBox, a local AI server).

use tauri::Url;

/// Generous, but bounded — a base URL is a host and maybe a port.
pub const MAX_URL_LEN: usize = 2048;

/// Why a base URL was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum BaseUrlError {
    #[error("the URL is empty")]
    Empty,
    #[error("the URL is too long")]
    TooLong,
    #[error("the URL is not valid")]
    Malformed,
    #[error("the URL must start with http:// or https://")]
    Scheme,
    #[error("the URL has no host")]
    NoHost,
}

/// Validate and normalize a user-entered base URL to `scheme://host[:port]`.
///
/// Path, query, fragment **and userinfo** are dropped: a pasted
/// `https://alice:secret@server.example.com/api/` must not carry credentials
/// into every request, nor double a path onto the endpoint the caller appends.
///
/// ⚠️ Deliberately **not** an SSRF check. HoTTY is a desktop app: the person
/// typing this URL is the person running the app, and the app already opens
/// SSH sessions to arbitrary hosts. A server on `http://127.0.0.1` is a
/// legitimate target — see `a_loopback_url_is_accepted_on_purpose`.
pub fn normalize_base_url(raw: &str) -> Result<String, BaseUrlError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(BaseUrlError::Empty);
    }
    if trimmed.len() > MAX_URL_LEN {
        return Err(BaseUrlError::TooLong);
    }
    let url = Url::parse(trimmed).map_err(|_| BaseUrlError::Malformed)?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(BaseUrlError::Scheme);
    }
    // `host_str` returns an IPv6 literal already bracketed (`[fd00::1]`), so
    // rebuilding from it round-trips without parsing the address ourselves.
    let host = url
        .host_str()
        .filter(|h| !h.is_empty())
        .ok_or(BaseUrlError::NoHost)?;

    let mut out = format!("{}://{}", url.scheme(), host);
    if let Some(port) = url.port() {
        out.push(':');
        out.push_str(&port.to_string());
    }
    Ok(out)
}

/// True when a normalized base URL points at this PC (`localhost`, `127.0.0.0/8`
/// or `::1`). Mirrors `isLoopbackUrl` in `src/utils/loopbackUrl.ts`.
pub fn is_loopback_base_url(base_url: &str) -> bool {
    let Ok(url) = Url::parse(base_url) else {
        return false;
    };
    let Some(host) = url.host_str() else {
        return false;
    };
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    host.trim_start_matches('[')
        .trim_end_matches(']')
        .parse::<std::net::IpAddr>()
        .is_ok_and(|ip| ip.is_loopback())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_and_normalizes_a_plain_https_url() {
        assert_eq!(
            normalize_base_url("https://server.example.com").unwrap(),
            "https://server.example.com"
        );
    }

    #[test]
    fn strips_path_query_fragment_and_userinfo() {
        let out =
            normalize_base_url("https://alice:secret@server.example.com/v1/?q=x#top").unwrap();
        assert_eq!(out, "https://server.example.com");
    }

    #[test]
    fn keeps_an_explicit_port_and_ipv6() {
        assert_eq!(
            normalize_base_url("http://192.0.2.10:8080/v1").unwrap(),
            "http://192.0.2.10:8080"
        );
        assert_eq!(
            normalize_base_url("http://[fd00::1]:8000/api/").unwrap(),
            "http://[fd00::1]:8000"
        );
    }

    #[test]
    fn a_loopback_url_is_accepted_on_purpose() {
        assert_eq!(
            normalize_base_url("http://127.0.0.1:11434").unwrap(),
            "http://127.0.0.1:11434"
        );
        assert!(normalize_base_url("http://localhost:1234").is_ok());
    }

    #[test]
    fn rejects_bad_input() {
        assert_eq!(normalize_base_url("  "), Err(BaseUrlError::Empty));
        assert_eq!(
            normalize_base_url("ftp://server.example.com"),
            Err(BaseUrlError::Scheme)
        );
        assert_eq!(
            normalize_base_url("server.example.com"),
            Err(BaseUrlError::Malformed)
        );
        let long = format!("https://{}.example.com", "a".repeat(MAX_URL_LEN));
        assert_eq!(normalize_base_url(&long), Err(BaseUrlError::TooLong));
        assert!(normalize_base_url("javascript:alert(1)").is_err());
    }

    #[test]
    fn loopback_detection() {
        assert!(is_loopback_base_url("http://localhost:11434"));
        assert!(is_loopback_base_url("http://LOCALHOST:11434"));
        assert!(is_loopback_base_url("http://127.0.0.1:1234"));
        assert!(is_loopback_base_url("http://127.1.2.3"));
        assert!(is_loopback_base_url("http://[::1]:8080"));
        assert!(!is_loopback_base_url("http://192.0.2.10:8080"));
        assert!(!is_loopback_base_url("http://localhost.example.com"));
        assert!(!is_loopback_base_url("http://[fd00::1]"));
        assert!(!is_loopback_base_url("not a url"));
    }
}
