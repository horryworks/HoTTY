//! The polling loop: one cycle of walks, rate derivation, row assembly, emit.

use std::collections::{BTreeMap, HashMap};
use std::time::{Duration, Instant};

use snmp2::AsyncSession;
use tauri::{AppHandle, Emitter};
use tokio_util::sync::CancellationToken;

use crate::services::timefmt::format_timestamp;

use super::config::{SnmpAuth, SnmpTarget};
use super::oids::{
    ColumnId, DISCONTINUITY_COLUMN, HC_COUNTER_COLUMNS, LEGACY_COUNTER_COLUMNS,
    LEGACY_SLOW_COLUMNS, SLOW_COLUMNS, STATUS_COLUMNS, SYS_DESCR_OID, SYS_NAME_OID, SYS_UPTIME_OID,
};
use super::payload::{IfRow, SnmpDataPayload, SnmpDiscovery, SnmpInterfaceInfo, SnmpStatusPayload};
use super::rates::{CounterWidth, IfCounters, SampleStore};
use super::session::{
    connect, get_scalar, humanize_snmp_error_for, probe_column, walk_columns, OwnedVal, SnmpError,
    WalkedValue, BULK_MAX_REPETITIONS, BULK_MAX_REPETITIONS_STRING, MAX_ROWS,
};

/// Human-readable form of a transport error for `target`, with the v2c-specific
/// "check the community string" hint applied where it belongs.
fn describe(err: &SnmpError, target: &SnmpTarget) -> String {
    humanize_snmp_error_for(
        err,
        &target.host,
        target.port,
        target.timeout.as_millis() as u64,
        matches!(target.auth, SnmpAuth::V2c { .. }),
    )
}

pub const DATA_EVENT: &str = "snmp-watcher-data";
pub const STATUS_EVENT: &str = "snmp-watcher-status";

/// Refresh the descriptive columns (names, aliases, speeds) every N cycles.
const SLOW_EVERY_N: u32 = 10;
/// A dead device is not worth polling at full rate; back off up to this multiple
/// of the configured interval.
const MAX_BACKOFF_MULT: u32 = 6;
/// Whole-cycle ceiling, so one wedged device cannot stall the loop forever.
const MIN_CYCLE_BUDGET: Duration = Duration::from_secs(10);
const MAX_CYCLE_BUDGET: Duration = Duration::from_secs(120);
/// Upper bound on the one-shot discovery command.
const DISCOVERY_BUDGET: Duration = Duration::from_secs(20);
/// Batch size for the connect-time counter-width probe. One GETBULK is enough to
/// tell a populated column from an empty one.
const PROBE_REPETITIONS: u32 = 10;
/// Consecutive unchanged polls before we tell the user the agent is the limit,
/// not the tool. Three in a row is well past normal jitter.
const SLOW_AGENT_STREAK: u32 = 3;

/// Descriptive fields, refreshed on the slow cadence and re-sent every cycle.
#[derive(Debug, Clone, Default)]
struct IfStatic {
    name: Option<String>,
    descr: Option<String>,
    alias: Option<String>,
    speed_mbps: Option<u32>,
}

/// Everything that survives between cycles.
struct WatcherRuntime {
    samples: SampleStore,
    statics: HashMap<u32, IfStatic>,
    last_rows: Vec<IfRow>,
    last_ok: Option<Instant>,
    consecutive_failures: u32,
    cycle: u32,
    sys_name: Option<String>,
    /// ifSpeed (legacy) is bit/s; ifHighSpeed is Mbit/s.
    speed_in_bits_per_second: bool,
    /// Set once we have told the user their poll interval outruns the agent.
    slow_agent_reported: bool,
}

impl WatcherRuntime {
    fn new(width: CounterWidth) -> Self {
        Self {
            samples: SampleStore::new(width),
            statics: HashMap::new(),
            last_rows: Vec::new(),
            last_ok: None,
            consecutive_failures: 0,
            cycle: 0,
            sys_name: None,
            speed_in_bits_per_second: width == CounterWidth::Bits32,
            slow_agent_reported: false,
        }
    }
}

/// Run the watcher until cancelled. Owns the session for its whole lifetime, so
/// the UDP socket and the target's zeroizing secrets are released together when
/// the task ends.
pub async fn run(
    app: AppHandle,
    pane_id: String,
    target: SnmpTarget,
    interval_ms: std::sync::Arc<tokio::sync::Mutex<u64>>,
    cancel: CancellationToken,
) {
    emit_status(&app, &pane_id, "connecting", None);
    log::info!(
        "snmp: pane {pane_id} connecting to {}:{} ({})",
        target.host,
        target.port,
        target.auth.label()
    );

    let mut session = tokio::select! {
        biased;
        _ = cancel.cancelled() => return,
        result = connect(&target) => match result {
            Ok(s) => s,
            Err(e) => {
                let msg = describe(&e, &target);
                log::warn!("snmp: pane {pane_id} could not connect: {msg}");
                emit_status(&app, &pane_id, "error", Some(msg));
                return;
            }
        },
    };

    let width = match decide_counter_width(&mut session, &target).await {
        Ok(w) => w,
        Err(e) => {
            let msg = describe(&e, &target);
            log::warn!("snmp: pane {pane_id} probe failed: {msg}");
            emit_status(&app, &pane_id, "error", Some(msg));
            return;
        }
    };
    if width == CounterWidth::Bits32 {
        // The reason (absent vs present-but-unpopulated) is logged by
        // `decide_counter_width`; this line just ties it to the pane.
        log::info!("snmp: pane {pane_id} is using 32-bit ifTable counters");
    }

    let mut runtime = WatcherRuntime::new(width);
    emit_status(&app, &pane_id, "running", None);

    loop {
        let base_interval = *interval_ms.lock().await;
        let budget = Duration::from_millis(base_interval.saturating_mul(2))
            .clamp(MIN_CYCLE_BUDGET, MAX_CYCLE_BUDGET);

        let started = Instant::now();
        let cycle_result = tokio::select! {
            biased;
            _ = cancel.cancelled() => break,
            r = tokio::time::timeout(budget, run_cycle(&mut session, &target, &mut runtime)) => r,
        };

        let poll_ms = started.elapsed().as_millis() as u64;
        let outcome = match cycle_result {
            Ok(inner) => inner,
            Err(_) => Err(SnmpError::Timeout),
        };

        // `emit_cycle` folds this cycle's result into the failure counter and
        // returns the interval that follows from it, so a credential rejection
        // backs off immediately rather than one cycle late.
        let effective_interval = emit_cycle(
            &app,
            &pane_id,
            &target,
            &mut runtime,
            outcome,
            poll_ms,
            base_interval,
        );

        let sleep_for = Duration::from_millis(effective_interval);
        tokio::select! {
            biased;
            _ = cancel.cancelled() => break,
            _ = tokio::time::sleep(sleep_for) => {}
        }
    }

    log::info!("snmp: pane {pane_id} watcher stopped");
    emit_status(&app, &pane_id, "stopped", None);
}

/// What one cycle produced. `partial` means some columns answered and others
/// timed out — the rows are still worth showing.
struct CycleOutput {
    rows: Vec<IfRow>,
    partial: bool,
    truncated: bool,
    sys_uptime_secs: Option<u64>,
}

async fn run_cycle(
    session: &mut AsyncSession,
    target: &SnmpTarget,
    runtime: &mut WatcherRuntime,
) -> Result<CycleOutput, SnmpError> {
    let sys_uptime_ticks = get_scalar(session, target, SYS_UPTIME_OID)
        .await?
        .and_then(|v| v.as_u32());
    let rebooted = runtime.samples.observe_sys_uptime(sys_uptime_ticks);
    if rebooted {
        log::info!("snmp: device restarted (sysUpTime went backwards); counters reset");
    }

    // Descriptive columns on the first cycle and every SLOW_EVERY_N after.
    if runtime.cycle.is_multiple_of(SLOW_EVERY_N) {
        let slow_columns = if runtime.samples.width() == CounterWidth::Bits64 {
            SLOW_COLUMNS
        } else {
            LEGACY_SLOW_COLUMNS
        };
        let walked =
            walk_columns(session, target, slow_columns, BULK_MAX_REPETITIONS_STRING).await?;
        apply_statics(
            &mut runtime.statics,
            &walked,
            runtime.speed_in_bits_per_second,
        );

        if runtime.sys_name.is_none() {
            runtime.sys_name = get_scalar(session, target, SYS_NAME_OID)
                .await
                .ok()
                .flatten()
                .and_then(|v| v.as_text().map(str::to_string));
        }
    }
    runtime.cycle = runtime.cycle.wrapping_add(1);

    // Counter + status columns every cycle.
    let counter_columns = if runtime.samples.width() == CounterWidth::Bits64 {
        HC_COUNTER_COLUMNS
    } else {
        LEGACY_COUNTER_COLUMNS
    };

    let mut walked = walk_columns(session, target, counter_columns, BULK_MAX_REPETITIONS).await?;
    walked.extend(walk_columns(session, target, STATUS_COLUMNS, BULK_MAX_REPETITIONS).await?);

    // ifCounterDiscontinuityTime is ifXTable-only; a device without it just
    // relies on the sysUpTime check and the plausibility gate.
    let mut partial = false;
    if runtime.samples.width() == CounterWidth::Bits64 {
        match walk_columns(session, target, DISCONTINUITY_COLUMN, BULK_MAX_REPETITIONS).await {
            Ok(values) => walked.extend(values),
            Err(e) if !e.is_fatal() => partial = true,
            Err(e) => return Err(e),
        }
    }

    log_raw_counter_sample(&walked, runtime.samples.width());

    let (rows, truncated) = assemble_rows(&walked, runtime, rebooted);

    let present: Vec<u32> = rows.iter().map(|r| r.if_index).collect();
    runtime.samples.retain_indexes(&present);
    runtime.statics.retain(|ix, _| present.contains(ix));

    Ok(CycleOutput {
        rows,
        partial,
        truncated,
        sys_uptime_secs: sys_uptime_ticks.map(|t| u64::from(t) / 100),
    })
}

/// How many interfaces the raw-counter diagnostic prints per cycle.
const RAW_LOG_SAMPLE: usize = 8;

/// Log the octet counters exactly as the device reported them.
///
/// Diagnostic for "the table shows 0 bps": a rate of zero can mean either the
/// interface is genuinely idle or the agent is answering the HC (ifXTable)
/// counters with a constant 0 — several vendors implement ifXTable but leave the
/// 64-bit counters unpopulated on VLAN/sub/management interfaces, which reads as
/// permanent zero traffic. Comparing these raw values across two cycles tells the
/// two apart immediately; a rate computed after the fact cannot.
fn log_raw_counter_sample(walked: &[WalkedValue], width: CounterWidth) {
    if !log::log_enabled!(log::Level::Debug) {
        return;
    }
    let mut all: BTreeMap<u32, (Option<u64>, Option<u64>)> = BTreeMap::new();
    for (column, if_index, value) in walked {
        let slot = match column {
            ColumnId::InOctets => 0,
            ColumnId::OutOctets => 1,
            _ => continue,
        };
        let entry = all.entry(*if_index).or_default();
        let raw = value.as_u64();
        if slot == 0 {
            entry.0 = raw;
        } else {
            entry.1 = raw;
        }
    }
    if all.is_empty() {
        log::debug!(
            "snmp raw[{}]: the walk returned no octet counters at all",
            width.as_str()
        );
        return;
    }

    // Prefer interfaces that actually carry traffic. Printing the first N by
    // index once filled this log with a router's unused ports (NULL0, loopbacks,
    // empty switch ports) and made a perfectly healthy device look broken.
    let mut sample: BTreeMap<u32, (Option<u64>, Option<u64>)> = all
        .iter()
        .filter(|(_, (i, o))| i.unwrap_or(0) > 0 || o.unwrap_or(0) > 0)
        .take(RAW_LOG_SAMPLE)
        .map(|(k, v)| (*k, *v))
        .collect();
    let busy = sample.len();
    for (ix, v) in all.iter().take(RAW_LOG_SAMPLE) {
        if sample.len() >= RAW_LOG_SAMPLE {
            break;
        }
        sample.entry(*ix).or_insert(*v);
    }

    let rendered: Vec<String> = sample
        .iter()
        .map(|(ix, (in_o, out_o))| {
            format!(
                "if{ix}: in={} out={}",
                in_o.map_or_else(|| "-".to_string(), |v| v.to_string()),
                out_o.map_or_else(|| "-".to_string(), |v| v.to_string())
            )
        })
        .collect();
    log::debug!(
        "snmp raw[{}] ({busy} of {} interfaces carrying traffic): {}",
        width.as_str(),
        all.len(),
        rendered.join("  ")
    );
    // No warning about all-zero counters here: on a router most ports are
    // legitimately unused, and whether the agent's HC counters are trustworthy
    // is already decided (against the 32-bit column) in `decide_counter_width`.
}

/// Fold walked descriptive cells into the static cache.
fn apply_statics(
    statics: &mut HashMap<u32, IfStatic>,
    walked: &[WalkedValue],
    speed_in_bits_per_second: bool,
) {
    for (column, if_index, value) in walked {
        let entry = statics.entry(*if_index).or_default();
        match column {
            ColumnId::IfName => entry.name = value.as_text().map(str::to_string),
            ColumnId::IfDescr => entry.descr = value.as_text().map(str::to_string),
            ColumnId::IfAlias => {
                entry.alias = value
                    .as_text()
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
            }
            ColumnId::HighSpeed => {
                entry.speed_mbps = normalize_speed(value, speed_in_bits_per_second)
            }
            _ => {}
        }
    }
}

/// ifHighSpeed is already Mbit/s; ifSpeed is bit/s and uses 2^32-1 as the
/// "too fast to express, look at ifHighSpeed" sentinel (RFC 2863).
fn normalize_speed(value: &OwnedVal, in_bits_per_second: bool) -> Option<u32> {
    let raw = value.as_u64()?;
    if !in_bits_per_second {
        return u32::try_from(raw).ok();
    }
    if raw >= u64::from(u32::MAX) {
        return None;
    }
    u32::try_from(raw / 1_000_000).ok()
}

/// Build the table from this cycle's walked cells.
///
/// Rows are keyed by the **union** of ifIndexes seen across all columns: a
/// sparse ifXTable means the columns genuinely disagree about which interfaces
/// exist, and dropping the difference would silently hide ports.
fn assemble_rows(
    walked: &[WalkedValue],
    runtime: &mut WatcherRuntime,
    rebooted: bool,
) -> (Vec<IfRow>, bool) {
    let mut counters: BTreeMap<u32, IfCounters> = BTreeMap::new();
    let mut admin: HashMap<u32, u8> = HashMap::new();
    let mut oper: HashMap<u32, u8> = HashMap::new();

    for (column, if_index, value) in walked {
        match column {
            ColumnId::AdminStatus => {
                if let Some(v) = value.as_u8() {
                    admin.insert(*if_index, v);
                }
                counters.entry(*if_index).or_default();
                continue;
            }
            ColumnId::OperStatus => {
                if let Some(v) = value.as_u8() {
                    oper.insert(*if_index, v);
                }
                counters.entry(*if_index).or_default();
                continue;
            }
            ColumnId::IfName | ColumnId::IfDescr | ColumnId::IfAlias | ColumnId::HighSpeed => {
                continue
            }
            _ => {}
        }

        let entry = counters.entry(*if_index).or_default();
        let Some(raw) = value.as_u64() else { continue };
        match column {
            ColumnId::InOctets => entry.in_octets = Some(raw),
            ColumnId::OutOctets => entry.out_octets = Some(raw),
            ColumnId::InUcastPkts => entry.in_ucast = Some(raw),
            ColumnId::InMulticastPkts => entry.in_mcast = Some(raw),
            ColumnId::InBroadcastPkts => entry.in_bcast = Some(raw),
            ColumnId::OutUcastPkts => entry.out_ucast = Some(raw),
            ColumnId::OutMulticastPkts => entry.out_mcast = Some(raw),
            ColumnId::OutBroadcastPkts => entry.out_bcast = Some(raw),
            ColumnId::InErrors => entry.in_errors = Some(raw),
            ColumnId::OutErrors => entry.out_errors = Some(raw),
            ColumnId::InDiscards => entry.in_discards = Some(raw),
            ColumnId::OutDiscards => entry.out_discards = Some(raw),
            ColumnId::CounterDiscontinuityTime => {
                entry.discontinuity_time = u32::try_from(raw).ok()
            }
            _ => {}
        }
    }

    let truncated = counters.len() > MAX_ROWS;
    if truncated {
        log::warn!(
            "snmp: device reported {} interfaces; showing the first {MAX_ROWS}",
            counters.len()
        );
    }

    let now = Instant::now();
    let mut rows = Vec::with_capacity(counters.len().min(MAX_ROWS));
    for (if_index, counter) in counters.into_iter().take(MAX_ROWS) {
        let stat = runtime.statics.get(&if_index).cloned().unwrap_or_default();
        let rates =
            runtime
                .samples
                .update(if_index, counter.clone(), stat.speed_mbps, now, rebooted);

        rows.push(IfRow {
            if_index,
            name: stat.name,
            descr: stat.descr,
            alias: stat.alias,
            admin_status: admin.get(&if_index).copied(),
            oper_status: oper.get(&if_index).copied(),
            speed_mbps: stat.speed_mbps,
            bps_in: rates.bps_in,
            bps_out: rates.bps_out,
            pps_in: rates.pps_in,
            pps_out: rates.pps_out,
            util_in_pct: rates.util_in_pct,
            util_out_pct: rates.util_out_pct,
            in_errors: counter.in_errors,
            out_errors: counter.out_errors,
            in_discards: counter.in_discards,
            out_discards: counter.out_discards,
            in_errors_delta: rates.in_errors_delta,
            out_errors_delta: rates.out_errors_delta,
            in_discards_delta: rates.in_discards_delta,
            out_discards_delta: rates.out_discards_delta,
            discontinuity: rates.discontinuity,
        });
    }

    (rows, truncated)
}

/// Decide once per run which octet counters to trust.
///
/// "Does the column exist?" is not a sufficient test, and neither is "does *any*
/// interface report a non-zero HC counter". RFC 2863 says an agent without HC
/// support should answer `noSuchObject`, but real devices are messier: the
/// router this was first reproduced against populates `ifHCInOctets` on some
/// interfaces and pins it to a constant 0 on the rest. Selecting HC mode there
/// leaves those interfaces reading exactly 0 bps forever, which looks like a
/// broken tool rather than a broken agent.
///
/// So the test is per-interface: if *any* interface reports 0 on HC while its
/// 32-bit counterpart shows traffic, the agent's HC support is untrustworthy and
/// the whole run drops to the 32-bit columns — those are implemented
/// consistently, and their wrap-around is already handled.
async fn decide_counter_width(
    session: &mut AsyncSession,
    target: &SnmpTarget,
) -> Result<CounterWidth, SnmpError> {
    let hc = probe_column(session, target, &HC_COUNTER_COLUMNS[0], PROBE_REPETITIONS).await?;
    if hc.is_empty() {
        log::info!("snmp: agent does not implement ifHCInOctets; using 32-bit ifTable counters");
        return Ok(CounterWidth::Bits32);
    }

    let legacy: HashMap<u32, u64> = probe_column(
        session,
        target,
        &LEGACY_COUNTER_COLUMNS[0],
        PROBE_REPETITIONS,
    )
    .await?
    .into_iter()
    .filter_map(|(ix, v)| v.as_u64().map(|n| (ix, n)))
    .collect();

    log_width_probe(&hc, &legacy);

    let unpopulated = unpopulated_hc_interfaces(&hc, &legacy);
    if !unpopulated.is_empty() {
        log::warn!(
            "snmp: agent reports 0 for ifHCInOctets on interface(s) {unpopulated:?} while the \
             32-bit ifInOctets shows traffic there - its 64-bit counters are unreliable, so this \
             run uses 32-bit counters (they wrap in ~34s on a saturated 1 Gbps link)"
        );
        return Ok(CounterWidth::Bits32);
    }

    Ok(CounterWidth::Bits64)
}

/// Interfaces whose 64-bit counter sits at 0 while the 32-bit one shows traffic.
///
/// A non-empty result means the agent's HC support cannot be trusted: those
/// interfaces would read 0 bps forever. An interface that is simply idle has 0 in
/// both and is not reported here.
fn unpopulated_hc_interfaces(hc: &[(u32, OwnedVal)], legacy: &HashMap<u32, u64>) -> Vec<u32> {
    hc.iter()
        .filter(|(ix, v)| v.as_u64().unwrap_or(0) == 0 && legacy.get(ix).copied().unwrap_or(0) > 0)
        .map(|(ix, _)| *ix)
        .collect()
}

/// Side-by-side dump of the two octet counters at connect time — the evidence
/// for the width decision, and the fastest way to see which interfaces an agent
/// leaves unpopulated.
fn log_width_probe(hc: &[(u32, OwnedVal)], legacy: &HashMap<u32, u64>) {
    if !log::log_enabled!(log::Level::Debug) {
        return;
    }
    let rendered: Vec<String> = hc
        .iter()
        .map(|(ix, v)| {
            format!(
                "if{ix}: hc={} legacy={}",
                v.as_u64()
                    .map_or_else(|| "-".to_string(), |n| n.to_string()),
                legacy
                    .get(ix)
                    .map_or_else(|| "-".to_string(), |n| n.to_string())
            )
        })
        .collect();
    log::debug!("snmp width probe (ifInOctets): {}", rendered.join("  "));
}

/// Fold a cycle's result into the runtime, emit the snapshot, and return the
/// interval to sleep for before the next cycle (base interval, scaled by the
/// consecutive-failure backoff).
fn emit_cycle(
    app: &AppHandle,
    pane_id: &str,
    target: &SnmpTarget,
    runtime: &mut WatcherRuntime,
    outcome: Result<CycleOutput, SnmpError>,
    poll_ms: u64,
    base_interval_ms: u64,
) -> u64 {
    let width = runtime.samples.width().as_str();

    let mut payload = match outcome {
        Ok(cycle) => {
            runtime.consecutive_failures = 0;
            runtime.last_ok = Some(Instant::now());
            runtime.last_rows = cycle.rows.clone();

            // An agent that publishes its counters far more slowly than we poll
            // cannot be measured at this interval, no matter how the rates are
            // computed. Say so once, rather than letting the table look erratic.
            let stale_streak = runtime.samples.max_stale_streak;
            let slow_agent = stale_streak >= SLOW_AGENT_STREAK && !runtime.slow_agent_reported;
            if slow_agent {
                runtime.slow_agent_reported = true;
                log::warn!(
                    "snmp: this device left its counters unchanged for {stale_streak} consecutive \
                     polls - it publishes interface statistics more slowly than the current \
                     interval, so rates are averaged over the gaps. Increase the poll interval."
                );
            }

            let (status, error) = if cycle.truncated {
                (
                    "degraded",
                    Some(format!("Only the first {MAX_ROWS} interfaces are shown")),
                )
            } else if cycle.partial {
                (
                    "degraded",
                    Some("Some counters did not respond in time".to_string()),
                )
            } else if slow_agent {
                (
                    "degraded",
                    Some(format!(
                        "This device updates its interface counters slowly (unchanged across \
                         {stale_streak} polls). Rates are averaged over the gaps - increase the \
                         poll interval for steadier readings."
                    )),
                )
            } else {
                ("ok", None)
            };

            SnmpDataPayload {
                pane_id: pane_id.to_string(),
                timestamp: format_timestamp(),
                status,
                error,
                sys_name: runtime.sys_name.clone(),
                sys_uptime_secs: cycle.sys_uptime_secs,
                counter_width: width,
                poll_ms,
                // Overwritten below, once the failure counter is up to date.
                interval_ms: base_interval_ms,
                stale_for_ms: None,
                interfaces: cycle.rows,
            }
        }
        Err(err) => {
            runtime.consecutive_failures = runtime.consecutive_failures.saturating_add(1);
            if err.is_fatal() {
                // Do not hammer a device that is rejecting our credentials.
                runtime.consecutive_failures = runtime.consecutive_failures.max(MAX_BACKOFF_MULT);
            }
            let message = describe(&err, target);
            // Log the first failure and then every backoff step, not every cycle.
            if runtime.consecutive_failures == 1 || runtime.consecutive_failures.is_multiple_of(5) {
                log::warn!(
                    "snmp: pane {pane_id} poll failed ({} consecutive): {message}",
                    runtime.consecutive_failures
                );
            }

            SnmpDataPayload {
                pane_id: pane_id.to_string(),
                timestamp: format_timestamp(),
                status: "error",
                error: Some(message),
                sys_name: runtime.sys_name.clone(),
                sys_uptime_secs: None,
                counter_width: width,
                poll_ms,
                interval_ms: base_interval_ms,
                // Rows are deliberately kept: a device that stops answering
                // should grey out, not vanish.
                stale_for_ms: runtime.last_ok.map(|t| t.elapsed().as_millis() as u64),
                interfaces: runtime.last_rows.clone(),
            }
        }
    };

    // Whichever arm ran above has updated the failure counter, so the backoff
    // computed here already reflects the cycle that just finished.
    let effective_interval =
        base_interval_ms * u64::from(runtime.consecutive_failures.clamp(1, MAX_BACKOFF_MULT));
    payload.interval_ms = effective_interval;

    if let Err(e) = app.emit(DATA_EVENT, payload) {
        log::warn!("snmp: failed to emit {DATA_EVENT}: {e}");
    }
    effective_interval
}

fn emit_status(app: &AppHandle, pane_id: &str, state: &'static str, message: Option<String>) {
    let payload = SnmpStatusPayload {
        pane_id: pane_id.to_string(),
        state,
        message,
        timestamp: format_timestamp(),
    };
    if let Err(e) = app.emit(STATUS_EVENT, payload) {
        log::warn!("snmp: failed to emit {STATUS_EVENT}: {e}");
    }
}

/// One-shot connection test + interface listing, used by the pane's
/// "list interfaces" button. Spawns nothing and holds no state.
pub async fn discover(target: SnmpTarget) -> Result<SnmpDiscovery, String> {
    let humanize = |e: &SnmpError| {
        let message = describe(e, &target);
        // Discovery used to fail silently as far as the log was concerned, which
        // left a failed "List interfaces" with no trace to diagnose from.
        log::warn!(
            "snmp: listing interfaces on {}:{} ({}) failed: {message}",
            target.host,
            target.port,
            target.auth.label()
        );
        message
    };

    log::info!(
        "snmp: listing interfaces on {}:{} ({})",
        target.host,
        target.port,
        target.auth.label()
    );

    tokio::time::timeout(DISCOVERY_BUDGET, async {
        let mut session = connect(&target).await.map_err(|e| humanize(&e))?;
        let width = decide_counter_width(&mut session, &target)
            .await
            .map_err(|e| humanize(&e))?;

        let sys_name = get_scalar(&mut session, &target, SYS_NAME_OID)
            .await
            .ok()
            .flatten()
            .and_then(|v| v.as_text().map(str::to_string));
        let sys_descr = get_scalar(&mut session, &target, SYS_DESCR_OID)
            .await
            .ok()
            .flatten()
            .and_then(|v| v.as_text().map(str::to_string));
        let sys_uptime_secs = get_scalar(&mut session, &target, SYS_UPTIME_OID)
            .await
            .ok()
            .flatten()
            .and_then(|v| v.as_u32())
            .map(|t| u64::from(t) / 100);

        let slow_columns = if width == CounterWidth::Bits64 {
            SLOW_COLUMNS
        } else {
            LEGACY_SLOW_COLUMNS
        };
        let mut statics = HashMap::new();
        let walked = walk_columns(
            &mut session,
            &target,
            slow_columns,
            BULK_MAX_REPETITIONS_STRING,
        )
        .await
        .map_err(|e| humanize(&e))?;
        apply_statics(&mut statics, &walked, width == CounterWidth::Bits32);

        let oper_walk = walk_columns(
            &mut session,
            &target,
            &STATUS_COLUMNS[5..6], // ifOperStatus
            BULK_MAX_REPETITIONS,
        )
        .await
        .unwrap_or_default();
        let oper: HashMap<u32, u8> = oper_walk
            .into_iter()
            .filter_map(|(_, ix, v)| v.as_u8().map(|s| (ix, s)))
            .collect();

        let mut indexes: Vec<u32> = statics.keys().copied().collect();
        indexes.sort_unstable();
        let interfaces = indexes
            .into_iter()
            .take(MAX_ROWS)
            .map(|if_index| {
                let stat = statics.get(&if_index).cloned().unwrap_or_default();
                SnmpInterfaceInfo {
                    if_index,
                    name: stat.name,
                    descr: stat.descr,
                    alias: stat.alias,
                    speed_mbps: stat.speed_mbps,
                    oper_status: oper.get(&if_index).copied(),
                }
            })
            .collect();

        Ok::<SnmpDiscovery, String>(SnmpDiscovery {
            sys_name,
            sys_descr,
            sys_uptime_secs,
            counter_width: width.as_str(),
            interfaces,
        })
    })
    .await
    .map_err(|_| {
        format!(
            "Listing interfaces on {}:{} took too long",
            target.host, target.port
        )
    })?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::snmp::oids::ColumnId;

    fn runtime_with(width: CounterWidth) -> WatcherRuntime {
        WatcherRuntime::new(width)
    }

    #[test]
    fn assemble_rows_unions_indexes_across_columns() {
        // A sparse agent: ifHCInOctets only for index 1, but oper status for both.
        let walked: Vec<WalkedValue> = vec![
            (ColumnId::InOctets, 1, OwnedVal::Unsigned(100)),
            (ColumnId::OperStatus, 1, OwnedVal::Signed(1)),
            (ColumnId::OperStatus, 2, OwnedVal::Signed(2)),
        ];
        let mut runtime = runtime_with(CounterWidth::Bits64);
        let (rows, truncated) = assemble_rows(&walked, &mut runtime, false);
        assert!(!truncated);
        assert_eq!(rows.len(), 2, "index 2 must not be dropped");
        assert_eq!(rows[0].if_index, 1);
        assert_eq!(rows[1].if_index, 2);
        assert_eq!(rows[1].oper_status, Some(2));
    }

    #[test]
    fn assemble_rows_sorts_by_if_index() {
        let walked: Vec<WalkedValue> = vec![
            (ColumnId::InOctets, 10, OwnedVal::Unsigned(1)),
            (ColumnId::InOctets, 2, OwnedVal::Unsigned(1)),
            (ColumnId::InOctets, 7, OwnedVal::Unsigned(1)),
        ];
        let mut runtime = runtime_with(CounterWidth::Bits64);
        let (rows, _) = assemble_rows(&walked, &mut runtime, false);
        let order: Vec<u32> = rows.iter().map(|r| r.if_index).collect();
        assert_eq!(order, vec![2, 7, 10]);
    }

    #[test]
    fn assemble_rows_first_cycle_has_counters_but_no_rates() {
        let walked: Vec<WalkedValue> = vec![
            (ColumnId::InOctets, 1, OwnedVal::Unsigned(5_000)),
            (ColumnId::InErrors, 1, OwnedVal::Unsigned(3)),
        ];
        let mut runtime = runtime_with(CounterWidth::Bits64);
        let (rows, _) = assemble_rows(&walked, &mut runtime, false);
        assert_eq!(rows[0].in_errors, Some(3), "cumulative shown immediately");
        assert_eq!(rows[0].bps_in, None, "no rate from a single sample");
    }

    #[test]
    fn assemble_rows_truncates_above_max_rows() {
        let walked: Vec<WalkedValue> = (1..=(MAX_ROWS as u32 + 5))
            .map(|ix| (ColumnId::InOctets, ix, OwnedVal::Unsigned(1)))
            .collect();
        let mut runtime = runtime_with(CounterWidth::Bits64);
        let (rows, truncated) = assemble_rows(&walked, &mut runtime, false);
        assert!(truncated);
        assert_eq!(rows.len(), MAX_ROWS);
    }

    #[test]
    fn apply_statics_populates_names_and_speed() {
        let mut statics = HashMap::new();
        let walked: Vec<WalkedValue> = vec![
            (ColumnId::IfName, 1, OwnedVal::Text("Gi0/1".into())),
            (
                ColumnId::IfDescr,
                1,
                OwnedVal::Text("GigabitEthernet0/1".into()),
            ),
            (ColumnId::IfAlias, 1, OwnedVal::Text("uplink".into())),
            (ColumnId::HighSpeed, 1, OwnedVal::Unsigned(1000)),
        ];
        apply_statics(&mut statics, &walked, false);
        let stat = &statics[&1];
        assert_eq!(stat.name.as_deref(), Some("Gi0/1"));
        assert_eq!(stat.alias.as_deref(), Some("uplink"));
        assert_eq!(stat.speed_mbps, Some(1000));
    }

    #[test]
    fn apply_statics_treats_empty_alias_as_absent() {
        let mut statics = HashMap::new();
        let walked: Vec<WalkedValue> = vec![(ColumnId::IfAlias, 1, OwnedVal::Text(String::new()))];
        apply_statics(&mut statics, &walked, false);
        assert_eq!(statics[&1].alias, None);
    }

    #[test]
    fn normalize_speed_converts_legacy_bits_to_megabits() {
        // ifSpeed is bit/s.
        assert_eq!(
            normalize_speed(&OwnedVal::Unsigned(1_000_000_000), true),
            Some(1000)
        );
        // ifHighSpeed is already Mbit/s.
        assert_eq!(
            normalize_speed(&OwnedVal::Unsigned(1000), false),
            Some(1000)
        );
    }

    #[test]
    fn normalize_speed_rejects_the_rfc2863_sentinel() {
        // 2^32-1 in ifSpeed means "too fast to express here".
        assert_eq!(
            normalize_speed(&OwnedVal::Unsigned(u64::from(u32::MAX)), true),
            None
        );
    }

    #[test]
    fn normalize_speed_ignores_non_numeric() {
        assert_eq!(normalize_speed(&OwnedVal::Text("x".into()), false), None);
        assert_eq!(normalize_speed(&OwnedVal::EndOfColumn, true), None);
    }

    // The bug this guards: the router under test populates ifHCInOctets on some
    // interfaces and pins it to 0 on the rest. Deciding on "any interface has a
    // non-zero HC counter" left the pinned ones reading 0 bps forever.
    #[test]
    fn unpopulated_hc_interfaces_flags_only_the_inconsistent_ones() {
        let hc = vec![
            (1, OwnedVal::Unsigned(0)),       // pinned at 0, but 32-bit has traffic
            (2, OwnedVal::Unsigned(500_000)), // populated
            (3, OwnedVal::Unsigned(0)),       // genuinely idle: 0 in both
        ];
        let legacy: HashMap<u32, u64> = [(1, 900_000), (2, 500_000), (3, 0)].into_iter().collect();

        assert_eq!(unpopulated_hc_interfaces(&hc, &legacy), vec![1]);
    }

    #[test]
    fn a_fully_consistent_agent_reports_nothing_unpopulated() {
        let hc = vec![(1, OwnedVal::Unsigned(10)), (2, OwnedVal::Unsigned(0))];
        let legacy: HashMap<u32, u64> = [(1, 10), (2, 0)].into_iter().collect();
        assert!(unpopulated_hc_interfaces(&hc, &legacy).is_empty());
    }

    #[test]
    fn missing_legacy_reading_is_not_treated_as_evidence() {
        // No 32-bit value to compare against — we cannot call HC broken.
        let hc = vec![(1, OwnedVal::Unsigned(0))];
        assert!(unpopulated_hc_interfaces(&hc, &HashMap::new()).is_empty());
    }

    #[test]
    fn legacy_probe_column_is_if_in_octets() {
        // decide_counter_width probes LEGACY_COUNTER_COLUMNS[0] against
        // HC_COUNTER_COLUMNS[0]; both must be the *input octet* column or the
        // comparison is meaningless.
        assert_eq!(HC_COUNTER_COLUMNS[0].id, ColumnId::InOctets);
        assert_eq!(LEGACY_COUNTER_COLUMNS[0].id, ColumnId::InOctets);
        assert_eq!(
            LEGACY_COUNTER_COLUMNS[0].arcs,
            &[1, 3, 6, 1, 2, 1, 2, 2, 1, 10]
        );
    }

    #[test]
    fn status_columns_index_five_is_oper_status() {
        // `discover` slices STATUS_COLUMNS[5..6] to walk just ifOperStatus.
        // If the table is ever reordered this test fails instead of the pane
        // silently showing admin status in the oper column.
        assert_eq!(STATUS_COLUMNS[5].id, ColumnId::OperStatus);
    }
}
