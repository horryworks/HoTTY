//! Shared syntax checks for network targets that arrive from outside the
//! backend — typed by a user, saved in the host tree, or proposed by the AI
//! Chat (`connect` fence). Two callers, two strictness levels:
//!
//! - [`is_valid_host_target`] is the Ping Monitor's rule: the target is handed
//!   to the OS `ping` binary, so it must contain no shell metacharacters at all
//!   (hostname / IPv4 / bare IPv6 characters only).
//! - [`validate_host`] is the SSH / Telnet connect-config rule. The host only
//!   ever reaches a TCP connect, so it is a sanity backstop rather than a shell
//!   guard: it additionally tolerates `_` (seen in hosts files / mDNS names) but
//!   still rejects whitespace, control characters and shell metacharacters so a
//!   renderer-supplied string can never smuggle those into a log line or an
//!   error message.
//!
//! The frontend mirrors the strict rule for AI-supplied hosts
//! (`CONNECT_HOST_RE` in `src/utils/aiConnectRequest.ts`); the backend check
//! here is the defense the frontend cannot bypass.

use std::sync::OnceLock;

/// Longest DNS name (RFC 1035) — also the cap for IP literals, which are shorter.
pub const MAX_HOST_LEN: usize = 253;

/// Strict rule: hostname / IPv4 / bare IPv6 characters only, no leading `-`.
/// Safe to pass to a subprocess argument list.
pub fn is_valid_host_target(target: &str) -> bool {
    if target.is_empty() || target.len() > MAX_HOST_LEN {
        return false;
    }
    static RE: OnceLock<regex_lite::Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        regex_lite::Regex::new(r"^[a-zA-Z0-9:][a-zA-Z0-9.:\-]{0,251}[a-zA-Z0-9.:]?$").unwrap()
    });
    re.is_match(target)
}

/// Connect-config rule: like the strict rule but `_` is tolerated. Leading `-`
/// is still rejected (it would read as a flag if the host ever reached a CLI).
fn is_plausible_connect_host(host: &str) -> bool {
    static RE: OnceLock<regex_lite::Regex> = OnceLock::new();
    let re = RE
        .get_or_init(|| regex_lite::Regex::new(r"^[a-zA-Z0-9_:][a-zA-Z0-9._:\-]{0,252}$").unwrap());
    re.is_match(host)
}

/// Validate an SSH / Telnet host string. Trims first (a trailing space typed
/// into a host field must not fail the connect). The error strings are
/// user-facing and are shown verbatim in the connection error toast — keep them
/// short and free of the offending value.
pub fn validate_host(host: &str) -> Result<(), String> {
    let h = host.trim();
    if h.is_empty() {
        return Err("Host is required".to_string());
    }
    if h.len() > MAX_HOST_LEN {
        return Err("Host is too long".to_string());
    }
    if !is_plausible_connect_host(h) {
        return Err("Host contains invalid characters".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strict_rule_accepts_hostnames_and_ips() {
        for ok in [
            "example.com",
            "192.0.2.10",
            "::1",
            "2001:db8::1",
            "sw-01.example.com",
            "a",
        ] {
            assert!(is_valid_host_target(ok), "{ok}");
        }
    }

    #[test]
    fn strict_rule_rejects_metacharacters_whitespace_and_underscores() {
        for bad in [
            "",
            " ",
            "; rm -rf /",
            "host | cat",
            "host&cmd",
            "host$(evil)",
            "host name",
            "host\n",
            "-flag",
            "my_host",
            "https://example.com",
        ] {
            assert!(!is_valid_host_target(bad), "{bad:?}");
        }
        assert!(!is_valid_host_target(&"a".repeat(254)));
    }

    #[test]
    fn validate_host_trims_and_accepts_plausible_hosts() {
        assert_eq!(validate_host("192.0.2.10"), Ok(()));
        assert_eq!(validate_host(" sw-01.example.com "), Ok(()));
        assert_eq!(validate_host("my_host"), Ok(()));
        assert_eq!(validate_host("2001:db8::1"), Ok(()));
    }

    #[test]
    fn validate_host_reports_empty_and_too_long_with_the_legacy_messages() {
        // These two messages pre-date this module (they were inline in
        // SshConfig::validate); callers and tests depend on the exact text.
        assert_eq!(validate_host("").unwrap_err(), "Host is required");
        assert_eq!(validate_host("   ").unwrap_err(), "Host is required");
        assert_eq!(
            validate_host(&"a".repeat(254)).unwrap_err(),
            "Host is too long"
        );
    }

    #[test]
    fn validate_host_rejects_metacharacters_whitespace_and_control_chars() {
        // NB: a TRAILING newline is trimmed like any whitespace (a pasted host may
        // carry one), so the control-character case puts the newline in the middle.
        for bad in [
            "host name",
            "host;ls",
            "host|cat",
            "host$(x)",
            "ho\nst",
            "-flag",
            "h\x07",
        ] {
            assert_eq!(
                validate_host(bad).unwrap_err(),
                "Host contains invalid characters",
                "{bad:?}"
            );
        }
    }
}
