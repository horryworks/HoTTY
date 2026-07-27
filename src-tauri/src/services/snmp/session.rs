//! SNMP transport: session construction, the retry ladder, and the walk.
//!
//! `snmp2` has **no internal timeout** — `send_and_recv` is a bare
//! `socket.recv().await`. Every await into the crate is therefore wrapped in
//! `tokio::time::timeout`, including the constructors (they resolve DNS).
//!
//! `Pdu<'a>` borrows the session's receive buffer, so nothing may hold one
//! across the next request. Every helper here drains to owned data before it
//! returns.

use std::time::Duration;

use snmp2::v3::{Auth, AuthErrorKind, Security};
use snmp2::{AsyncSession, Error as SnmpLibError, Oid, Value};

use super::config::{SnmpAuth, SnmpTarget, V3Level};
use super::oids::{if_index_from, ColumnDef, ColumnId};

/// Wraps `AsyncSession::new_*` and `init()`. Generous because it covers DNS.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// `AuthUpdated` gets its own budget — it is a protocol handshake step, not a
/// failure, so it must not consume the user's retry allowance.
const V3_AUTH_RETRY_LIMIT: u8 = 2;
/// Keep GETBULK responses inside one Ethernet frame. Fragmented UDP is dropped
/// by a depressing number of firewalls and switch control-plane policers.
pub const BULK_MAX_REPETITIONS: u32 = 15;
/// ifAlias rows can be 64 bytes each, so string columns get a smaller batch.
pub const BULK_MAX_REPETITIONS_STRING: u32 = 8;
/// Columns walked concurrently in one GETBULK.
const MAX_COLUMNS_PER_REQUEST: usize = 4;
/// Backstop against an agent that never terminates a subtree.
const MAX_WALK_ROUNDS: usize = 64;
/// Hard cap on tracked interfaces, so a misbehaving agent cannot grow the
/// payload without bound.
pub const MAX_ROWS: usize = 512;

// SNMP PDU error-status values (RFC 3416 §3).
const ERRSTATUS_TOO_BIG: u32 = 1;
const ERRSTATUS_NO_SUCH_NAME: u32 = 2;
const ERRSTATUS_NO_ACCESS: u32 = 6;
const ERRSTATUS_AUTHORIZATION_ERROR: u32 = 16;

#[derive(Debug, Clone, PartialEq)]
pub enum SnmpError {
    /// No reply within the per-request timeout.
    Timeout,
    /// Socket-level send/receive failure.
    Transport,
    /// Name resolution failed.
    Resolve(String),
    /// Could not open the UDP socket.
    Connect(String),
    /// SNMPv3 USM rejected us.
    Auth(AuthErrorKind),
    /// The engine's boots/time kept moving — the device's clock is unstable.
    AuthUpdateLoop,
    /// The device rejected the community string.
    CommunityMismatch,
    /// The agent's SNMP view does not grant access to what we asked for.
    AccessDenied,
    /// Response would not fit even at the smallest batch size.
    ResponseTooBig,
    /// Any other non-zero PDU error-status.
    Agent(u32),
    /// Malformed response.
    Protocol(String),
}

impl SnmpError {
    /// Retrying a credential rejection just spams the device and can trip
    /// account-lockout or alerting thresholds. These stop the cycle at once.
    pub fn is_fatal(&self) -> bool {
        matches!(
            self,
            SnmpError::Auth(_)
                | SnmpError::CommunityMismatch
                | SnmpError::AccessDenied
                | SnmpError::AuthUpdateLoop
                | SnmpError::ResponseTooBig
        )
    }
}

impl From<SnmpLibError> for SnmpError {
    fn from(e: SnmpLibError) -> Self {
        match e {
            SnmpLibError::Send | SnmpLibError::Receive => SnmpError::Transport,
            SnmpLibError::CommunityMismatch => SnmpError::CommunityMismatch,
            SnmpLibError::AuthFailure(kind) => SnmpError::Auth(kind),
            SnmpLibError::AuthUpdated => SnmpError::AuthUpdateLoop,
            SnmpLibError::Crypto(msg) => SnmpError::Protocol(format!("crypto: {msg}")),
            other => SnmpError::Protocol(other.to_string()),
        }
    }
}

/// Turn a transport error into something a network engineer can act on.
///
/// Single translation point, mirroring `humanize_io_error`'s policy: no category
/// prefixes, no raw OS error codes, and — asserted by a test — never any part of
/// a credential.
pub fn humanize_snmp_error(err: &SnmpError, host: &str, port: u16, timeout_ms: u64) -> String {
    humanize_snmp_error_for(err, host, port, timeout_ms, false)
}

/// As [`humanize_snmp_error`], but able to tailor the message to the SNMP
/// version in use.
///
/// This matters for one case in particular: on v2c a **wrong community string is
/// silent**. The agent simply drops the request, so it reaches us as a plain
/// timeout, indistinguishable from an unreachable host. (`CommunityMismatch`
/// only fires if a device answers with a *different* community, which real
/// agents do not do.) Saying only "no response" sends people to check
/// reachability when the credential is the far more likely cause.
pub fn humanize_snmp_error_for(
    err: &SnmpError,
    host: &str,
    port: u16,
    timeout_ms: u64,
    community_based: bool,
) -> String {
    match err {
        SnmpError::Timeout if community_based => format!(
            "No response from {host}:{port} (timed out after {timeout_ms} ms) - check the \
             community string, and that SNMP is enabled for this host"
        ),
        SnmpError::Timeout => {
            format!("No response from {host}:{port} (timed out after {timeout_ms} ms)")
        }
        SnmpError::Transport => format!("Could not reach {host}:{port}"),
        SnmpError::Resolve(_) => format!("Could not resolve {host}"),
        SnmpError::Connect(_) => format!("Could not open a UDP socket to {host}:{port}"),
        SnmpError::CommunityMismatch => "The device rejected the community string".to_string(),
        SnmpError::AccessDenied => {
            "The device denied access — its SNMP view does not include IF-MIB".to_string()
        }
        SnmpError::AuthUpdateLoop => {
            "SNMPv3 engine time keeps changing — the device's SNMP engine may be unstable"
                .to_string()
        }
        SnmpError::ResponseTooBig => {
            "The device's reply was too large even at the smallest batch size".to_string()
        }
        SnmpError::Agent(code) => format!("The device returned SNMP error status {code}"),
        SnmpError::Protocol(detail) => format!("Malformed SNMP response ({detail})"),
        SnmpError::Auth(kind) => match kind {
            AuthErrorKind::SignatureMismatch | AuthErrorKind::NotAuthenticated => {
                "SNMPv3 authentication failed — check the user name, auth protocol and auth password"
                    .to_string()
            }
            AuthErrorKind::UsernameMismatch => {
                "SNMPv3 authentication failed — the device does not know this user name".to_string()
            }
            AuthErrorKind::ReplyNotEncrypted
            | AuthErrorKind::PrivLengthMismatch
            | AuthErrorKind::KeyLengthMismatch => {
                "SNMPv3 decryption failed — check the privacy protocol and privacy password"
                    .to_string()
            }
            AuthErrorKind::KeyExtensionRequired => {
                "This auth/privacy combination needs a key-extension method the device did not accept"
                    .to_string()
            }
            AuthErrorKind::EngineIdMismatch
            | AuthErrorKind::EngineBootsMismatch
            | AuthErrorKind::EngineTimeMismatch
            | AuthErrorKind::EngineBootsNotProvided => {
                "SNMPv3 engine discovery failed — the device may have just restarted".to_string()
            }
            other => format!("SNMPv3 security error: {other}"),
        },
    }
}

/// Classification of a non-zero PDU error-status.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentStatus {
    Ok,
    /// Halve `max_repetitions` and retry.
    TooBig,
    /// This column is unsupported; drop it and keep walking the others.
    ColumnUnsupported,
    /// Never going to succeed — stop.
    Fatal,
    /// Retryable at the cycle level.
    Retryable,
}

pub fn classify_error_status(status: u32) -> AgentStatus {
    match status {
        0 => AgentStatus::Ok,
        ERRSTATUS_TOO_BIG => AgentStatus::TooBig,
        ERRSTATUS_NO_SUCH_NAME => AgentStatus::ColumnUnsupported,
        ERRSTATUS_NO_ACCESS | ERRSTATUS_AUTHORIZATION_ERROR => AgentStatus::Fatal,
        _ => AgentStatus::Retryable,
    }
}

/// Halve a batch size, never going below 1.
pub fn shrink_repetitions(current: u32) -> u32 {
    (current / 2).max(1)
}

// ---------------------------------------------------------------------------
// Owned values
// ---------------------------------------------------------------------------

/// A varbind value copied out of the borrowed `Pdu` so the session can be
/// reused. Only the subset of ASN.1 types IF-MIB actually uses.
#[derive(Debug, Clone, PartialEq)]
pub enum OwnedVal {
    Unsigned(u64),
    Signed(i64),
    Text(String),
    /// `endOfMibView` / `noSuchObject` / `noSuchInstance` — the column ended.
    EndOfColumn,
    /// A type we do not care about (the row is simply skipped).
    Other,
}

impl OwnedVal {
    pub fn as_u64(&self) -> Option<u64> {
        match self {
            OwnedVal::Unsigned(v) => Some(*v),
            OwnedVal::Signed(v) => u64::try_from(*v).ok(),
            _ => None,
        }
    }

    pub fn as_u32(&self) -> Option<u32> {
        u32::try_from(self.as_u64()?).ok()
    }

    pub fn as_u8(&self) -> Option<u8> {
        u8::try_from(self.as_u64()?).ok()
    }

    pub fn as_text(&self) -> Option<&str> {
        match self {
            OwnedVal::Text(s) => Some(s.as_str()),
            _ => None,
        }
    }

    pub fn is_end_of_column(&self) -> bool {
        matches!(self, OwnedVal::EndOfColumn)
    }
}

fn own_value(value: &Value<'_>) -> OwnedVal {
    match value {
        Value::Counter64(v) => OwnedVal::Unsigned(*v),
        Value::Counter32(v) | Value::Unsigned32(v) | Value::Timeticks(v) => {
            OwnedVal::Unsigned(u64::from(*v))
        }
        Value::Integer(v) => OwnedVal::Signed(*v),
        // Device descriptions are frequently not valid UTF-8 (latin-1 in the
        // field, and some agents pad with NULs). Lossy conversion keeps the row
        // usable instead of dropping it.
        Value::OctetString(bytes) => OwnedVal::Text(
            String::from_utf8_lossy(bytes)
                .trim_end_matches('\0')
                .trim()
                .to_string(),
        ),
        Value::EndOfMibView | Value::NoSuchObject | Value::NoSuchInstance => OwnedVal::EndOfColumn,
        _ => OwnedVal::Other,
    }
}

fn oid_to_arcs(oid: &Oid<'_>) -> Option<Vec<u64>> {
    oid.iter().map(|it| it.collect())
}

fn make_oid(arcs: &[u64]) -> Result<Oid<'static>, SnmpError> {
    Oid::from(arcs).map_err(|_| SnmpError::Protocol(format!("bad OID {arcs:?}")))
}

// ---------------------------------------------------------------------------
// Connect
// ---------------------------------------------------------------------------

/// Build and initialise a session for `target`.
///
/// For v3 this also performs engine discovery (`init`). If the auth/cipher pair
/// needs a key extension and the device rejects our first choice, we flip
/// Reeder↔Blumenthal and try once more — vendors disagree, and the failure is
/// otherwise indistinguishable from a wrong password.
pub async fn connect(target: &SnmpTarget) -> Result<AsyncSession, SnmpError> {
    let dest = (target.host.as_str(), target.port);

    match &target.auth {
        SnmpAuth::V2c { community } => {
            let session = tokio::time::timeout(
                CONNECT_TIMEOUT,
                AsyncSession::new_v2c(dest, community.as_bytes(), 0),
            )
            .await
            .map_err(|_| SnmpError::Timeout)?
            .map_err(|e| map_io(e, &target.host))?;
            Ok(session)
        }
        SnmpAuth::V3 {
            username,
            context_name,
            level,
        } => {
            let mut session = new_v3_session(dest, username, context_name, level, None).await?;

            match tokio::time::timeout(CONNECT_TIMEOUT, session.init()).await {
                Err(_) => Err(SnmpError::Timeout),
                Ok(Ok(())) => Ok(session),
                Ok(Err(e)) => {
                    // Only the key-extension pairs get a second chance; anything
                    // else is a real failure and retrying would be an auth storm.
                    let alt = alternate_key_extension(level);
                    let Some(alt) = alt else {
                        return Err(SnmpError::from(e));
                    };
                    log::info!(
                        "snmp: v3 init failed with the default key-extension method, retrying with {alt:?}"
                    );
                    let mut retry =
                        new_v3_session(dest, username, context_name, level, Some(alt)).await?;
                    tokio::time::timeout(CONNECT_TIMEOUT, retry.init())
                        .await
                        .map_err(|_| SnmpError::Timeout)?
                        .map_err(SnmpError::from)?;
                    Ok(retry)
                }
            }
        }
    }
}

async fn new_v3_session(
    dest: (&str, u16),
    username: &str,
    context_name: &str,
    level: &V3Level,
    override_extension: Option<snmp2::v3::KeyExtension>,
) -> Result<AsyncSession, SnmpError> {
    let mut security = match level {
        V3Level::NoAuthNoPriv => {
            Security::new(username.as_bytes(), b"").with_auth(Auth::NoAuthNoPriv)
        }
        V3Level::AuthNoPriv { protocol, password } => {
            Security::new(username.as_bytes(), password.as_bytes())
                .with_auth_protocol(*protocol)
                .with_auth(Auth::AuthNoPriv)
        }
        V3Level::AuthPriv {
            auth_protocol,
            auth_password,
            cipher,
            priv_password,
            key_extension,
        } => {
            let mut sec = Security::new(username.as_bytes(), auth_password.as_bytes())
                .with_auth_protocol(*auth_protocol)
                .with_auth(Auth::AuthPriv {
                    cipher: *cipher,
                    privacy_password: priv_password.as_bytes().to_vec(),
                });
            if let Some(ext) = override_extension.or(*key_extension) {
                sec = sec.with_key_extension_method(ext);
            }
            sec
        }
    };
    if !context_name.is_empty() {
        security = security.with_context_name(context_name);
    }

    tokio::time::timeout(CONNECT_TIMEOUT, AsyncSession::new_v3(dest, 0, security))
        .await
        .map_err(|_| SnmpError::Timeout)?
        .map_err(|e| map_io(e, dest.0))
}

/// The other key-extension method, but only for the AuthPriv pairs that need
/// one at all.
fn alternate_key_extension(level: &V3Level) -> Option<snmp2::v3::KeyExtension> {
    match level {
        V3Level::AuthPriv {
            key_extension: Some(current),
            ..
        } => Some(current.other()),
        _ => None,
    }
}

fn map_io(e: std::io::Error, host: &str) -> SnmpError {
    match e.kind() {
        std::io::ErrorKind::InvalidInput => SnmpError::Resolve(host.to_string()),
        _ => SnmpError::Connect(e.to_string()),
    }
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/// One GETBULK response, already copied out of the borrowed PDU.
struct BulkResponse {
    error_status: u32,
    varbinds: Vec<(Vec<u64>, OwnedVal)>,
}

/// Issue one GETBULK with the timeout/retry ladder applied.
async fn getbulk_with_retry(
    session: &mut AsyncSession,
    target: &SnmpTarget,
    oids: &[Oid<'static>],
    max_repetitions: u32,
) -> Result<BulkResponse, SnmpError> {
    let refs: Vec<&Oid<'static>> = oids.iter().collect();
    let mut transport_attempts = 0u8;
    let mut auth_updates = 0u8;

    loop {
        // `Err(Elapsed)` is a genuine timeout; an inner `Err` is a socket or
        // protocol failure. Keeping them apart matters because the humanized
        // message differs.
        let attempt =
            tokio::time::timeout(target.timeout, session.getbulk(&refs, 0, max_repetitions)).await;

        let error = match attempt {
            Ok(Ok(pdu)) => {
                let varbinds = pdu
                    .varbinds
                    .clone()
                    .filter_map(|(oid, value)| {
                        oid_to_arcs(&oid).map(|arcs| (arcs, own_value(&value)))
                    })
                    .collect();
                return Ok(BulkResponse {
                    error_status: pdu.error_status,
                    varbinds,
                });
            }
            Ok(Err(SnmpLibError::AuthUpdated)) => {
                // Not a failure: snmp2 has already refreshed engine boots/time
                // from the device's report. The contract is to repeat the exact
                // request, and it must not consume the user's retry budget.
                auth_updates += 1;
                if auth_updates > V3_AUTH_RETRY_LIMIT {
                    return Err(SnmpError::AuthUpdateLoop);
                }
                continue;
            }
            Ok(Err(e)) => SnmpError::from(e),
            Err(_) => SnmpError::Timeout,
        };

        if error.is_fatal() || transport_attempts >= target.retries {
            return Err(error);
        }
        transport_attempts += 1;
        tokio::time::sleep(Duration::from_millis(100 * u64::from(transport_attempts))).await;
    }
}

/// A single GET, used for the scalars (`sysUpTime.0`, `sysName.0`, `sysDescr.0`).
pub async fn get_scalar(
    session: &mut AsyncSession,
    target: &SnmpTarget,
    arcs: &[u64],
) -> Result<Option<OwnedVal>, SnmpError> {
    let oid = make_oid(arcs)?;
    let mut transport_attempts = 0u8;
    let mut auth_updates = 0u8;

    loop {
        let outcome = tokio::time::timeout(target.timeout, session.get(&oid)).await;
        match outcome {
            Err(_) => {
                if transport_attempts >= target.retries {
                    return Err(SnmpError::Timeout);
                }
                transport_attempts += 1;
            }
            Ok(Ok(pdu)) => {
                if classify_error_status(pdu.error_status) != AgentStatus::Ok {
                    // A scalar we cannot read is not worth failing the cycle for.
                    return Ok(None);
                }
                let value = pdu
                    .varbinds
                    .clone()
                    .next()
                    .map(|(_, v)| own_value(&v))
                    .filter(|v| !v.is_end_of_column());
                return Ok(value);
            }
            Ok(Err(SnmpLibError::AuthUpdated)) => {
                auth_updates += 1;
                if auth_updates > V3_AUTH_RETRY_LIMIT {
                    return Err(SnmpError::AuthUpdateLoop);
                }
            }
            Ok(Err(e)) => {
                let mapped = SnmpError::from(e);
                if mapped.is_fatal() || transport_attempts >= target.retries {
                    return Err(mapped);
                }
                transport_attempts += 1;
            }
        }
        tokio::time::sleep(Duration::from_millis(100 * u64::from(transport_attempts))).await;
    }
}

/// Read at most one GETBULK worth of a single column, without walking it to the
/// end.
///
/// Used for connect-time probing, where the question is "does this agent answer
/// this column with usable values?" — walking the whole table to decide that
/// would cost a round trip per interface on a large chassis.
pub async fn probe_column(
    session: &mut AsyncSession,
    target: &SnmpTarget,
    column: &ColumnDef,
    max_repetitions: u32,
) -> Result<Vec<(u32, OwnedVal)>, SnmpError> {
    let oid = make_oid(column.arcs)?;
    let response = getbulk_with_retry(session, target, &[oid], max_repetitions).await?;
    if classify_error_status(response.error_status) == AgentStatus::Fatal {
        return Err(SnmpError::AccessDenied);
    }
    Ok(response
        .varbinds
        .into_iter()
        .take_while(|(_, value)| !value.is_end_of_column())
        .filter_map(|(arcs, value)| {
            if_index_from(&arcs, column.arcs).map(|if_index| (if_index, value))
        })
        .collect())
}

/// One walked cell.
pub type WalkedValue = (ColumnId, u32, OwnedVal);

/// Walk every column in `columns` and return every `(column, ifIndex, value)`
/// cell found.
///
/// Columns are walked several at a time in one GETBULK, which is where the
/// round-trip savings come from — but ifXTable is sparse in the field (an agent
/// may implement `ifHCInOctets` for physical ports only), so each slot tracks its
/// own completion rather than assuming they all end together.
pub async fn walk_columns(
    session: &mut AsyncSession,
    target: &SnmpTarget,
    columns: &[ColumnDef],
    initial_repetitions: u32,
) -> Result<Vec<WalkedValue>, SnmpError> {
    let mut out = Vec::new();
    let mut repetitions = initial_repetitions;

    for chunk in columns.chunks(MAX_COLUMNS_PER_REQUEST) {
        walk_chunk(session, target, chunk, &mut repetitions, &mut out).await?;
    }
    Ok(out)
}

async fn walk_chunk(
    session: &mut AsyncSession,
    target: &SnmpTarget,
    chunk: &[ColumnDef],
    repetitions: &mut u32,
    out: &mut Vec<WalkedValue>,
) -> Result<(), SnmpError> {
    // (column index within `chunk`, next OID to ask from)
    let mut active: Vec<(usize, Oid<'static>)> = Vec::with_capacity(chunk.len());
    for (i, col) in chunk.iter().enumerate() {
        active.push((i, make_oid(col.arcs)?));
    }

    let mut rounds = 0usize;
    while !active.is_empty() {
        rounds += 1;
        if rounds > MAX_WALK_ROUNDS {
            log::warn!(
                "snmp: giving up on a column subtree after {MAX_WALK_ROUNDS} GETBULK rounds"
            );
            break;
        }

        let oids: Vec<Oid<'static>> = active.iter().map(|(_, oid)| oid.clone()).collect();
        let response = getbulk_with_retry(session, target, &oids, *repetitions).await?;

        match classify_error_status(response.error_status) {
            AgentStatus::Ok => {}
            AgentStatus::TooBig => {
                if *repetitions <= 1 {
                    return Err(SnmpError::ResponseTooBig);
                }
                *repetitions = shrink_repetitions(*repetitions);
                log::debug!("snmp: response too big, retrying with max-repetitions={repetitions}");
                continue;
            }
            AgentStatus::ColumnUnsupported => {
                // v1-style "no such name" for the whole request; we cannot tell
                // which column, so drop the chunk rather than loop forever.
                log::debug!("snmp: agent reported noSuchName for a column chunk; skipping it");
                return Ok(());
            }
            AgentStatus::Fatal => return Err(SnmpError::AccessDenied),
            AgentStatus::Retryable => return Err(SnmpError::Agent(response.error_status)),
        }

        if response.varbinds.is_empty() {
            break;
        }

        let slot_count = active.len();
        let mut done = vec![false; slot_count];
        let mut advanced = vec![false; slot_count];
        let mut next_oid: Vec<Option<Vec<u64>>> = vec![None; slot_count];

        // RFC 3416 returns repetitions round-major, so varbind i belongs to
        // slot i % N.
        for (i, (arcs, value)) in response.varbinds.iter().enumerate() {
            let slot = i % slot_count;
            if done[slot] {
                continue;
            }
            if value.is_end_of_column() {
                done[slot] = true;
                continue;
            }
            let column = chunk[active[slot].0].arcs;
            match if_index_from(arcs, column) {
                Some(if_index) => {
                    out.push((chunk[active[slot].0].id, if_index, value.clone()));
                    next_oid[slot] = Some(arcs.clone());
                    advanced[slot] = true;
                }
                // The walk left this column's subtree — that is the stop signal.
                None => done[slot] = true,
            }
        }

        if out.len() > MAX_ROWS * chunk.len() {
            log::warn!("snmp: interface table exceeded {MAX_ROWS} rows; truncating");
            break;
        }

        let mut still_active = Vec::new();
        for (slot, (col_idx, _)) in active.into_iter().enumerate() {
            // A slot that produced nothing this round is finished too, otherwise
            // we would re-ask the same OID forever.
            if done[slot] || !advanced[slot] {
                continue;
            }
            if let Some(arcs) = &next_oid[slot] {
                still_active.push((col_idx, make_oid(arcs)?));
            }
        }
        active = still_active;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::snmp::config::{validate, SecurityLevel, SnmpConfigDto, SnmpVersionTag};

    #[test]
    fn error_status_classification() {
        assert_eq!(classify_error_status(0), AgentStatus::Ok);
        assert_eq!(classify_error_status(1), AgentStatus::TooBig);
        assert_eq!(classify_error_status(2), AgentStatus::ColumnUnsupported);
        assert_eq!(classify_error_status(6), AgentStatus::Fatal);
        assert_eq!(classify_error_status(16), AgentStatus::Fatal);
        assert_eq!(classify_error_status(5), AgentStatus::Retryable);
    }

    #[test]
    fn shrink_repetitions_halves_with_floor_of_one() {
        assert_eq!(shrink_repetitions(15), 7);
        assert_eq!(shrink_repetitions(7), 3);
        assert_eq!(shrink_repetitions(2), 1);
        assert_eq!(shrink_repetitions(1), 1);
        assert_eq!(shrink_repetitions(0), 1);
    }

    #[test]
    fn credential_errors_are_fatal_and_transport_errors_are_not() {
        assert!(SnmpError::Auth(AuthErrorKind::SignatureMismatch).is_fatal());
        assert!(SnmpError::CommunityMismatch.is_fatal());
        assert!(SnmpError::AccessDenied.is_fatal());
        assert!(!SnmpError::Timeout.is_fatal());
        assert!(!SnmpError::Transport.is_fatal());
        assert!(!SnmpError::Agent(5).is_fatal());
    }

    #[test]
    fn humanize_timeout_mentions_host_and_duration() {
        let msg = humanize_snmp_error(&SnmpError::Timeout, "switch-01", 161, 2000);
        assert!(msg.contains("switch-01"));
        assert!(msg.contains("161"));
        assert!(msg.contains("2000"));
    }

    /// On v2c a wrong community is silent — the agent drops the request, so it
    /// arrives as a plain timeout. The message has to say so, or people go
    /// hunting for a network problem that isn't there.
    #[test]
    fn v2c_timeout_points_at_the_community_string() {
        let msg = humanize_snmp_error_for(&SnmpError::Timeout, "192.0.2.1", 161, 2000, true);
        assert!(msg.contains("community string"), "{msg}");
        assert!(msg.contains("192.0.2.1"), "{msg}");

        // v3 authenticates explicitly, so a timeout there really is a timeout.
        let msg = humanize_snmp_error_for(&SnmpError::Timeout, "192.0.2.1", 161, 2000, false);
        assert!(!msg.contains("community string"), "{msg}");
    }

    #[test]
    fn community_hint_applies_only_to_timeouts() {
        let msg = humanize_snmp_error_for(&SnmpError::AccessDenied, "192.0.2.1", 161, 2000, true);
        assert!(!msg.contains("community string"), "{msg}");
    }

    #[test]
    fn humanize_auth_failure_is_actionable() {
        let msg = humanize_snmp_error(
            &SnmpError::Auth(AuthErrorKind::SignatureMismatch),
            "switch-01",
            161,
            2000,
        );
        assert!(msg.contains("auth password"), "{msg}");
        let msg = humanize_snmp_error(
            &SnmpError::Auth(AuthErrorKind::ReplyNotEncrypted),
            "switch-01",
            161,
            2000,
        );
        assert!(msg.contains("privacy password"), "{msg}");
    }

    /// The humanized string is shown in the pane and written to the log, so it
    /// must never echo a credential back.
    #[test]
    fn humanize_never_contains_a_secret() {
        let dto = SnmpConfigDto {
            host: "192.0.2.1".into(),
            port: 161,
            version: SnmpVersionTag::V3,
            community: None,
            username: Some("monitor".into()),
            security_level: Some(SecurityLevel::AuthPriv),
            auth_protocol: Some(super::super::config::AuthProtocolTag::Sha256),
            auth_password: Some("s3cr3t-auth-pw".into()),
            priv_protocol: Some(super::super::config::PrivProtocolTag::Aes128),
            priv_password: Some("s3cr3t-priv-pw".into()),
            context_name: None,
            timeout_ms: 2000,
            retries: 1,
        };
        let target = validate(dto).unwrap();
        for err in [
            SnmpError::Timeout,
            SnmpError::Transport,
            SnmpError::CommunityMismatch,
            SnmpError::AccessDenied,
            SnmpError::AuthUpdateLoop,
            SnmpError::ResponseTooBig,
            SnmpError::Agent(5),
            SnmpError::Auth(AuthErrorKind::SignatureMismatch),
            SnmpError::Auth(AuthErrorKind::ReplyNotEncrypted),
            SnmpError::Protocol("bad".into()),
        ] {
            let msg = humanize_snmp_error(&err, &target.host, target.port, 2000);
            assert!(!msg.contains("s3cr3t"), "leaked a secret: {msg}");
        }
    }

    #[test]
    fn owned_val_conversions() {
        assert_eq!(OwnedVal::Unsigned(42).as_u64(), Some(42));
        assert_eq!(OwnedVal::Signed(7).as_u8(), Some(7));
        assert_eq!(
            OwnedVal::Signed(-1).as_u64(),
            None,
            "negative is not a counter"
        );
        assert_eq!(OwnedVal::Unsigned(u64::from(u32::MAX) + 1).as_u32(), None);
        assert_eq!(OwnedVal::Text("Gi0/1".into()).as_text(), Some("Gi0/1"));
        assert_eq!(OwnedVal::Text("x".into()).as_u64(), None);
        assert!(OwnedVal::EndOfColumn.is_end_of_column());
        assert!(!OwnedVal::Other.is_end_of_column());
    }

    #[test]
    fn own_value_maps_snmp_types() {
        assert_eq!(own_value(&Value::Counter64(9)), OwnedVal::Unsigned(9));
        assert_eq!(own_value(&Value::Counter32(9)), OwnedVal::Unsigned(9));
        // Gauge32 and Unsigned32 share an ASN.1 tag, so ifHighSpeed arrives here.
        assert_eq!(
            own_value(&Value::Unsigned32(1000)),
            OwnedVal::Unsigned(1000)
        );
        assert_eq!(own_value(&Value::Timeticks(5)), OwnedVal::Unsigned(5));
        assert_eq!(own_value(&Value::Integer(2)), OwnedVal::Signed(2));
        assert_eq!(own_value(&Value::EndOfMibView), OwnedVal::EndOfColumn);
        assert_eq!(own_value(&Value::NoSuchObject), OwnedVal::EndOfColumn);
        assert_eq!(own_value(&Value::NoSuchInstance), OwnedVal::EndOfColumn);
        assert_eq!(own_value(&Value::Null), OwnedVal::Other);
    }

    #[test]
    fn own_value_cleans_up_octet_strings() {
        // Trailing NUL padding and whitespace are common in the field.
        assert_eq!(
            own_value(&Value::OctetString(b"Gi0/1\0\0")),
            OwnedVal::Text("Gi0/1".into())
        );
        // Invalid UTF-8 must not drop the row.
        assert_eq!(
            own_value(&Value::OctetString(&[0xC3, 0x28])),
            OwnedVal::Text("\u{FFFD}(".into())
        );
    }
}
