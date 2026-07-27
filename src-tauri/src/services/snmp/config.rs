//! SNMP target configuration: the wire DTO, the validated domain type, and the
//! validation that turns one into the other.
//!
//! Security notes (`.claude/rules/security.md`):
//!   * Protocol/level choices are enums, so an unknown string is rejected by
//!     serde before any of our code runs — that *is* the allowed-values check.
//!   * Secrets live in `Zeroizing<String>` and are wiped when the poll task ends.
//!   * **No `#[derive(Debug)]` on anything holding a secret.** `Zeroizing`'s
//!     `Debug` forwards to the inner `String` and would print the password
//!     verbatim into a log line. The manual impls below print `<redacted>`,
//!     mirroring `services::ssh::SshConfig`.

use std::sync::OnceLock;
use std::time::Duration;

use regex_lite::Regex;
use serde::Deserialize;
use snmp2::v3::{AuthProtocol, Cipher, KeyExtension};
use zeroize::{Zeroize, Zeroizing};

/// Shortest interval we will poll a device at. SNMP agents run the MIB walk on
/// the switch's control-plane CPU; hammering one at 1 s (which the Ping Monitor
/// happily allows for ICMP) is genuinely abusive on a chassis with 200 ports.
pub const MIN_INTERVAL_MS: u64 = 5_000;
pub const DEFAULT_INTERVAL_MS: u64 = 10_000;

const MIN_TIMEOUT_MS: u64 = 200;
const MAX_TIMEOUT_MS: u64 = 10_000;
const DEFAULT_TIMEOUT_MS: u64 = 2_000;
const MAX_RETRIES: u8 = 3;
const DEFAULT_RETRIES: u8 = 1;

const MAX_HOST_LEN: usize = 253;
const MAX_COMMUNITY_LEN: usize = 64;
/// RFC 3414 caps `msgUserName` at 32 octets.
const MAX_USERNAME_LEN: usize = 32;
/// RFC 3414 §11.2 requires a USM password of at least 8 characters. Enforcing it
/// here turns a baffling `SignatureMismatch` from the device into a clear message.
const MIN_PASSWORD_LEN: usize = 8;
const MAX_PASSWORD_LEN: usize = 128;
const MAX_CONTEXT_LEN: usize = 64;
const MAX_PANE_ID_LEN: usize = 128;

// ---------------------------------------------------------------------------
// Wire DTO
// ---------------------------------------------------------------------------

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum SnmpVersionTag {
    V2c,
    V3,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum SecurityLevel {
    NoAuthNoPriv,
    AuthNoPriv,
    AuthPriv,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum AuthProtocolTag {
    Md5,
    Sha1,
    Sha224,
    Sha256,
    Sha384,
    Sha512,
}

impl From<AuthProtocolTag> for AuthProtocol {
    fn from(tag: AuthProtocolTag) -> Self {
        match tag {
            AuthProtocolTag::Md5 => AuthProtocol::Md5,
            AuthProtocolTag::Sha1 => AuthProtocol::Sha1,
            AuthProtocolTag::Sha224 => AuthProtocol::Sha224,
            AuthProtocolTag::Sha256 => AuthProtocol::Sha256,
            AuthProtocolTag::Sha384 => AuthProtocol::Sha384,
            AuthProtocolTag::Sha512 => AuthProtocol::Sha512,
        }
    }
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum PrivProtocolTag {
    Des,
    Aes128,
    Aes192,
    Aes256,
}

impl From<PrivProtocolTag> for Cipher {
    fn from(tag: PrivProtocolTag) -> Self {
        match tag {
            PrivProtocolTag::Des => Cipher::Des,
            PrivProtocolTag::Aes128 => Cipher::Aes128,
            PrivProtocolTag::Aes192 => Cipher::Aes192,
            PrivProtocolTag::Aes256 => Cipher::Aes256,
        }
    }
}

fn default_port() -> u16 {
    161
}
fn default_timeout_ms() -> u64 {
    DEFAULT_TIMEOUT_MS
}
fn default_retries() -> u8 {
    DEFAULT_RETRIES
}

/// Exactly what the renderer sends. Deliberately permissive in shape (every v3
/// field optional) so `validate` can produce a specific message instead of serde
/// producing "missing field".
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnmpConfigDto {
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub version: SnmpVersionTag,
    #[serde(default)]
    pub community: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub security_level: Option<SecurityLevel>,
    #[serde(default)]
    pub auth_protocol: Option<AuthProtocolTag>,
    #[serde(default)]
    pub auth_password: Option<String>,
    #[serde(default)]
    pub priv_protocol: Option<PrivProtocolTag>,
    #[serde(default)]
    pub priv_password: Option<String>,
    /// SNMPv3 context name. Needed by devices that expose per-VRF/VDC contexts;
    /// empty means the default context.
    #[serde(default)]
    pub context_name: Option<String>,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
    #[serde(default = "default_retries")]
    pub retries: u8,
}

impl std::fmt::Debug for SnmpConfigDto {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SnmpConfigDto")
            .field("host", &self.host)
            .field("port", &self.port)
            .field("version", &self.version)
            .field("community", &self.community.as_ref().map(|_| "<redacted>"))
            .field("username", &self.username)
            .field("security_level", &self.security_level)
            .field("auth_protocol", &self.auth_protocol)
            .field(
                "auth_password",
                &self.auth_password.as_ref().map(|_| "<redacted>"),
            )
            .field("priv_protocol", &self.priv_protocol)
            .field(
                "priv_password",
                &self.priv_password.as_ref().map(|_| "<redacted>"),
            )
            .field("timeout_ms", &self.timeout_ms)
            .field("retries", &self.retries)
            .finish()
    }
}

// ---------------------------------------------------------------------------
// Validated domain type
// ---------------------------------------------------------------------------

pub enum V3Level {
    NoAuthNoPriv,
    AuthNoPriv {
        protocol: AuthProtocol,
        password: Zeroizing<String>,
    },
    AuthPriv {
        auth_protocol: AuthProtocol,
        auth_password: Zeroizing<String>,
        cipher: Cipher,
        priv_password: Zeroizing<String>,
        /// `Some` only for the auth/cipher pairs whose derived key is shorter
        /// than the cipher needs (MD5/SHA1 + AES-192/256, SHA-224 + AES-256).
        /// Vendors disagree on Reeder vs Blumenthal, so the session layer flips
        /// to the other one if the first fails.
        key_extension: Option<KeyExtension>,
    },
}

impl std::fmt::Debug for V3Level {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            V3Level::NoAuthNoPriv => write!(f, "NoAuthNoPriv"),
            V3Level::AuthNoPriv { protocol, .. } => f
                .debug_struct("AuthNoPriv")
                .field("protocol", protocol)
                .field("password", &"<redacted>")
                .finish(),
            V3Level::AuthPriv {
                auth_protocol,
                cipher,
                key_extension,
                ..
            } => f
                .debug_struct("AuthPriv")
                .field("auth_protocol", auth_protocol)
                .field("auth_password", &"<redacted>")
                .field("cipher", cipher)
                .field("priv_password", &"<redacted>")
                .field("key_extension", key_extension)
                .finish(),
        }
    }
}

pub enum SnmpAuth {
    V2c {
        community: Zeroizing<String>,
    },
    V3 {
        username: String,
        context_name: String,
        level: V3Level,
    },
}

impl std::fmt::Debug for SnmpAuth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SnmpAuth::V2c { .. } => f
                .debug_struct("V2c")
                .field("community", &"<redacted>")
                .finish(),
            SnmpAuth::V3 {
                username, level, ..
            } => f
                .debug_struct("V3")
                .field("username", username)
                .field("level", level)
                .finish(),
        }
    }
}

impl SnmpAuth {
    /// Short label for log lines and the pane's connection summary. Contains no
    /// secrets by construction.
    pub fn label(&self) -> &'static str {
        match self {
            SnmpAuth::V2c { .. } => "v2c",
            SnmpAuth::V3 {
                level: V3Level::NoAuthNoPriv,
                ..
            } => "v3/noAuthNoPriv",
            SnmpAuth::V3 {
                level: V3Level::AuthNoPriv { .. },
                ..
            } => "v3/authNoPriv",
            SnmpAuth::V3 {
                level: V3Level::AuthPriv { .. },
                ..
            } => "v3/authPriv",
        }
    }
}

/// A validated, ready-to-connect SNMP target.
///
/// Intentionally does NOT derive `Serialize`: it must never travel back over IPC
/// or into a payload.
#[derive(Debug)]
pub struct SnmpTarget {
    pub host: String,
    pub port: u16,
    pub auth: SnmpAuth,
    pub timeout: Duration,
    pub retries: u8,
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

fn hostname_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"^[a-zA-Z0-9]([a-zA-Z0-9.\-]{0,251}[a-zA-Z0-9])?$").expect("valid regex")
    })
}

fn pane_id_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[A-Za-z0-9_:\-]+$").expect("valid regex"))
}

/// Accepts an IP literal (v4 or v6) or a DNS hostname.
///
/// We never string-concatenate `host:port`, so bracketed IPv6 (`[::1]`) is
/// rejected rather than parsed — the session layer passes `(host, port)` to
/// tokio's `ToSocketAddrs`, which wants the bare address.
pub fn is_valid_host(host: &str) -> bool {
    if host.is_empty() || host.len() > MAX_HOST_LEN {
        return false;
    }
    if host.parse::<std::net::IpAddr>().is_ok() {
        return true;
    }
    if host.contains("..") {
        return false;
    }
    hostname_regex().is_match(host)
}

pub fn is_valid_pane_id(pane_id: &str) -> bool {
    !pane_id.is_empty() && pane_id.len() <= MAX_PANE_ID_LEN && pane_id_regex().is_match(pane_id)
}

fn is_printable_ascii(s: &str) -> bool {
    s.bytes().all(|b| (0x20..=0x7E).contains(&b))
}

/// Clamp a requested poll interval into the range we are willing to poll at.
pub fn clamp_interval(interval_ms: u64) -> u64 {
    interval_ms.max(MIN_INTERVAL_MS)
}

/// Validate the renderer's config and move its secrets into wiped-on-drop
/// storage. Consumes the DTO so no plaintext copy is left behind; fields that
/// turn out to be irrelevant for the chosen security level are explicitly
/// zeroized rather than silently dropped.
pub fn validate(mut dto: SnmpConfigDto) -> Result<SnmpTarget, String> {
    let host = dto.host.trim().to_string();
    if !is_valid_host(&host) {
        return Err(format!("Invalid SNMP host: {host:?}"));
    }
    if dto.port == 0 {
        return Err("SNMP port must be between 1 and 65535".to_string());
    }

    let timeout = Duration::from_millis(dto.timeout_ms.clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS));
    let retries = dto.retries.min(MAX_RETRIES);

    let auth = match dto.version {
        SnmpVersionTag::V2c => {
            // Any v3 material sent alongside a v2c request is unused — wipe it.
            zeroize_opt(&mut dto.auth_password);
            zeroize_opt(&mut dto.priv_password);

            let community = dto
                .community
                .take()
                .ok_or_else(|| "SNMPv2c requires a community string".to_string())?;
            if community.is_empty() || community.len() > MAX_COMMUNITY_LEN {
                return Err(format!(
                    "SNMP community string must be 1-{MAX_COMMUNITY_LEN} characters"
                ));
            }
            if !is_printable_ascii(&community) {
                return Err("SNMP community string contains non-printable characters".to_string());
            }
            SnmpAuth::V2c {
                community: Zeroizing::new(community),
            }
        }
        SnmpVersionTag::V3 => {
            zeroize_opt(&mut dto.community);

            let username = dto
                .username
                .take()
                .ok_or_else(|| "SNMPv3 requires a user name".to_string())?;
            if username.is_empty() || username.len() > MAX_USERNAME_LEN {
                return Err(format!(
                    "SNMPv3 user name must be 1-{MAX_USERNAME_LEN} characters"
                ));
            }
            if !is_printable_ascii(&username) {
                return Err("SNMPv3 user name contains non-printable characters".to_string());
            }

            let context_name = dto.context_name.take().unwrap_or_default();
            if context_name.len() > MAX_CONTEXT_LEN {
                return Err(format!(
                    "SNMPv3 context name must be at most {MAX_CONTEXT_LEN} characters"
                ));
            }
            if !is_printable_ascii(&context_name) {
                return Err("SNMPv3 context name contains non-printable characters".to_string());
            }

            let level = dto
                .security_level
                .ok_or_else(|| "SNMPv3 requires a security level".to_string())?;

            let level = match level {
                SecurityLevel::NoAuthNoPriv => {
                    zeroize_opt(&mut dto.auth_password);
                    zeroize_opt(&mut dto.priv_password);
                    V3Level::NoAuthNoPriv
                }
                SecurityLevel::AuthNoPriv => {
                    zeroize_opt(&mut dto.priv_password);
                    let protocol = dto.auth_protocol.ok_or_else(|| {
                        "authNoPriv requires an authentication protocol".to_string()
                    })?;
                    let password = take_password(dto.auth_password.take(), "authentication")?;
                    V3Level::AuthNoPriv {
                        protocol: protocol.into(),
                        password,
                    }
                }
                SecurityLevel::AuthPriv => {
                    let auth_tag = dto.auth_protocol.ok_or_else(|| {
                        "authPriv requires an authentication protocol".to_string()
                    })?;
                    let priv_tag = dto
                        .priv_protocol
                        .ok_or_else(|| "authPriv requires a privacy protocol".to_string())?;
                    let auth_password = take_password(dto.auth_password.take(), "authentication")?;
                    let priv_password = take_password(dto.priv_password.take(), "privacy")?;

                    let auth_protocol: AuthProtocol = auth_tag.into();
                    let cipher: Cipher = priv_tag.into();
                    // Reeder is what Net-SNMP and Cisco use; the session layer
                    // retries with Blumenthal if the device disagrees.
                    let key_extension = cipher
                        .priv_key_needs_extension(&auth_protocol)
                        .then_some(KeyExtension::Reeder);

                    V3Level::AuthPriv {
                        auth_protocol,
                        auth_password,
                        cipher,
                        priv_password,
                        key_extension,
                    }
                }
            };

            SnmpAuth::V3 {
                username,
                context_name,
                level,
            }
        }
    };

    Ok(SnmpTarget {
        host,
        port: dto.port,
        auth,
        timeout,
        retries,
    })
}

fn zeroize_opt(slot: &mut Option<String>) {
    if let Some(s) = slot.as_mut() {
        s.zeroize();
    }
    *slot = None;
}

fn take_password(value: Option<String>, kind: &str) -> Result<Zeroizing<String>, String> {
    let password = value
        .ok_or_else(|| format!("SNMPv3 requires a {kind} password for this security level"))?;
    if password.len() < MIN_PASSWORD_LEN || password.len() > MAX_PASSWORD_LEN {
        return Err(format!(
            "SNMPv3 {kind} password must be {MIN_PASSWORD_LEN}-{MAX_PASSWORD_LEN} characters"
        ));
    }
    if !is_printable_ascii(&password) {
        return Err(format!(
            "SNMPv3 {kind} password contains non-printable characters"
        ));
    }
    Ok(Zeroizing::new(password))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v2c_dto(community: Option<&str>) -> SnmpConfigDto {
        SnmpConfigDto {
            host: "192.0.2.10".into(),
            port: 161,
            version: SnmpVersionTag::V2c,
            community: community.map(str::to_string),
            username: None,
            security_level: None,
            auth_protocol: None,
            auth_password: None,
            priv_protocol: None,
            priv_password: None,
            context_name: None,
            timeout_ms: DEFAULT_TIMEOUT_MS,
            retries: DEFAULT_RETRIES,
        }
    }

    fn v3_dto(level: SecurityLevel) -> SnmpConfigDto {
        SnmpConfigDto {
            host: "switch-01.example.com".into(),
            port: 161,
            version: SnmpVersionTag::V3,
            community: None,
            username: Some("monitor".into()),
            security_level: Some(level),
            auth_protocol: Some(AuthProtocolTag::Sha256),
            auth_password: Some("authpass123".into()),
            priv_protocol: Some(PrivProtocolTag::Aes128),
            priv_password: Some("privpass123".into()),
            context_name: None,
            timeout_ms: DEFAULT_TIMEOUT_MS,
            retries: DEFAULT_RETRIES,
        }
    }

    #[test]
    fn valid_v2c_config_parses() {
        let target = validate(v2c_dto(Some("public"))).unwrap();
        assert_eq!(target.host, "192.0.2.10");
        assert_eq!(target.port, 161);
        assert_eq!(target.auth.label(), "v2c");
    }

    #[test]
    fn valid_v3_authpriv_config_parses() {
        let target = validate(v3_dto(SecurityLevel::AuthPriv)).unwrap();
        assert_eq!(target.auth.label(), "v3/authPriv");
    }

    #[test]
    fn rejects_missing_community() {
        assert!(validate(v2c_dto(None)).is_err());
    }

    #[test]
    fn rejects_empty_community() {
        assert!(validate(v2c_dto(Some(""))).is_err());
    }

    #[test]
    fn rejects_oversized_community() {
        let long = "a".repeat(MAX_COMMUNITY_LEN + 1);
        assert!(validate(v2c_dto(Some(&long))).is_err());
    }

    #[test]
    fn rejects_non_printable_community() {
        assert!(validate(v2c_dto(Some("pub\u{7}lic"))).is_err());
    }

    #[test]
    fn rejects_port_zero() {
        let mut dto = v2c_dto(Some("public"));
        dto.port = 0;
        assert!(validate(dto).is_err());
    }

    #[test]
    fn accepts_ipv4_ipv6_and_hostname() {
        for host in [
            "192.0.2.1",
            "2001:db8::1",
            "fe80::1",
            "switch-01.example.com",
            "sw1",
        ] {
            assert!(is_valid_host(host), "{host} should be valid");
        }
    }

    #[test]
    fn rejects_bad_hosts() {
        for host in [
            "",
            "; rm -rf /",
            "host|cat",
            "host$(evil)",
            "a..b",
            "-leading.example.com",
            "[2001:db8::1]",
            &"a".repeat(MAX_HOST_LEN + 1),
        ] {
            assert!(!is_valid_host(host), "{host:?} should be rejected");
        }
    }

    #[test]
    fn rejects_v3_authnopriv_without_auth_password() {
        let mut dto = v3_dto(SecurityLevel::AuthNoPriv);
        dto.auth_password = None;
        assert!(validate(dto).is_err());
    }

    #[test]
    fn rejects_v3_authpriv_without_priv_protocol() {
        let mut dto = v3_dto(SecurityLevel::AuthPriv);
        dto.priv_protocol = None;
        assert!(validate(dto).is_err());
    }

    #[test]
    fn rejects_short_auth_password() {
        let mut dto = v3_dto(SecurityLevel::AuthNoPriv);
        dto.auth_password = Some("short7c".into()); // 7 chars — under RFC 3414's floor
        assert!(validate(dto).is_err());
    }

    #[test]
    fn rejects_username_over_32_chars() {
        let mut dto = v3_dto(SecurityLevel::NoAuthNoPriv);
        dto.username = Some("u".repeat(MAX_USERNAME_LEN + 1));
        assert!(validate(dto).is_err());
    }

    #[test]
    fn noauthnopriv_drops_supplied_passwords() {
        let dto = v3_dto(SecurityLevel::NoAuthNoPriv);
        let target = validate(dto).unwrap();
        match target.auth {
            SnmpAuth::V3 {
                level: V3Level::NoAuthNoPriv,
                ..
            } => {}
            other => panic!("expected NoAuthNoPriv, got {other:?}"),
        }
    }

    #[test]
    fn key_extension_set_for_sha1_aes256() {
        let mut dto = v3_dto(SecurityLevel::AuthPriv);
        dto.auth_protocol = Some(AuthProtocolTag::Sha1);
        dto.priv_protocol = Some(PrivProtocolTag::Aes256);
        let target = validate(dto).unwrap();
        match target.auth {
            SnmpAuth::V3 {
                level: V3Level::AuthPriv { key_extension, .. },
                ..
            } => assert_eq!(key_extension, Some(KeyExtension::Reeder)),
            other => panic!("expected AuthPriv, got {other:?}"),
        }
    }

    #[test]
    fn key_extension_none_for_sha256_aes128() {
        let target = validate(v3_dto(SecurityLevel::AuthPriv)).unwrap();
        match target.auth {
            SnmpAuth::V3 {
                level: V3Level::AuthPriv { key_extension, .. },
                ..
            } => assert_eq!(key_extension, None),
            other => panic!("expected AuthPriv, got {other:?}"),
        }
    }

    /// `Zeroizing<String>`'s derived `Debug` prints the inner string, so a stray
    /// `#[derive(Debug)]` on any of these types would leak passwords into logs.
    /// This is the regression test for that.
    #[test]
    fn debug_impls_redact_secrets() {
        let dto = v3_dto(SecurityLevel::AuthPriv);
        let dto_debug = format!("{dto:?}");
        assert!(!dto_debug.contains("authpass123"), "{dto_debug}");
        assert!(!dto_debug.contains("privpass123"), "{dto_debug}");

        let target = validate(v3_dto(SecurityLevel::AuthPriv)).unwrap();
        let target_debug = format!("{target:?}");
        assert!(!target_debug.contains("authpass123"), "{target_debug}");
        assert!(!target_debug.contains("privpass123"), "{target_debug}");

        let v2c = validate(v2c_dto(Some("s3cr3t-community"))).unwrap();
        let v2c_debug = format!("{v2c:?}");
        assert!(!v2c_debug.contains("s3cr3t-community"), "{v2c_debug}");
    }

    #[test]
    fn interval_clamped_to_min() {
        assert_eq!(clamp_interval(0), MIN_INTERVAL_MS);
        assert_eq!(clamp_interval(1_000), MIN_INTERVAL_MS);
        assert_eq!(clamp_interval(30_000), 30_000);
    }

    #[test]
    fn timeout_and_retries_clamped() {
        let mut dto = v2c_dto(Some("public"));
        dto.timeout_ms = 99_999;
        dto.retries = 200;
        let target = validate(dto).unwrap();
        assert_eq!(target.timeout, Duration::from_millis(MAX_TIMEOUT_MS));
        assert_eq!(target.retries, MAX_RETRIES);

        let mut dto = v2c_dto(Some("public"));
        dto.timeout_ms = 1;
        let target = validate(dto).unwrap();
        assert_eq!(target.timeout, Duration::from_millis(MIN_TIMEOUT_MS));
    }

    #[test]
    fn pane_id_validation_rejects_metacharacters() {
        assert!(is_valid_pane_id("if-abc123-xyz"));
        assert!(is_valid_pane_id("ai-1::tab-2"));
        assert!(!is_valid_pane_id(""));
        assert!(!is_valid_pane_id("pane id"));
        assert!(!is_valid_pane_id("pane/../id"));
        assert!(!is_valid_pane_id(&"a".repeat(MAX_PANE_ID_LEN + 1)));
    }

    #[test]
    fn unknown_enum_variants_are_rejected_by_serde() {
        let json = r#"{"host":"192.0.2.1","version":"v3","username":"u",
                       "securityLevel":"authNoPriv","authProtocol":"sha3",
                       "authPassword":"authpass123"}"#;
        assert!(serde_json::from_str::<SnmpConfigDto>(json).is_err());
    }

    #[test]
    fn version_and_level_tags_deserialize_from_camel_case() {
        let json = r#"{"host":"192.0.2.1","version":"v2c","community":"public"}"#;
        let dto: SnmpConfigDto = serde_json::from_str(json).unwrap();
        assert_eq!(dto.version, SnmpVersionTag::V2c);
        assert_eq!(dto.port, 161, "port should default to 161");

        let json = r#"{"host":"192.0.2.1","version":"v3","username":"u",
                       "securityLevel":"noAuthNoPriv"}"#;
        let dto: SnmpConfigDto = serde_json::from_str(json).unwrap();
        assert_eq!(dto.security_level, Some(SecurityLevel::NoAuthNoPriv));
    }
}
