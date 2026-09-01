use std::collections::HashMap;
use std::sync::Arc;

use futures::stream::StreamExt;
use serde::Serialize;
use tauri::AppHandle;
use tauri::Emitter;
use tokio::sync::Mutex;

use crate::services::session_service::{join_or_abort, POLLER_STOP_GRACE_MS};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Minimum ping interval (1 second).
const MIN_INTERVAL_MS: u64 = 1000;

/// Kill timeout for each ping subprocess (5 seconds).
const PING_KILL_TIMEOUT_MS: u64 = 5000;

/// Maximum target hostname/IP length.
const MAX_TARGET_LEN: usize = 253;

/// How many pings may be in flight at once within a single cycle.
///
/// Each ping is its own `ping` subprocess, so this is also the ceiling on
/// concurrently spawned children per monitor. A cycle used to be strictly
/// sequential, which made its duration the *sum* of every target: roughly 32ms
/// for an instant LAN reply but about 2.6s for a silent host, so 50 targets
/// with a handful of dead ones took tens of seconds before a single row could
/// be emitted.
const MAX_CONCURRENT_PINGS: usize = 100;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingResult {
    pub target: String,
    pub status: String,
    pub rtt: Option<u32>,
    pub ttl: Option<u32>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PingDataPayload {
    session_id: String,
    results: Vec<PingResult>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PingLogFilePayload {
    session_id: String,
    file_name: String,
}

/// Shared state: maps sessionId → running PingMonitor handle.
pub struct PingMonitorState {
    pub monitors: Arc<Mutex<HashMap<String, MonitorHandle>>>,
}

impl PingMonitorState {
    pub fn new() -> Self {
        Self {
            monitors: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl Default for PingMonitorState {
    fn default() -> Self {
        Self::new()
    }
}

/// Grace period a monitor gets to wind down cooperatively before it is aborted.
/// A cycle in flight can hold the loop for up to `PING_KILL_TIMEOUT_MS` (per
/// batch of `MAX_CONCURRENT_PINGS`, since the cycle fans out), so a stop during
/// a cycle normally lands on the abort path — which is the point: teardown is
/// bounded regardless of what the loop is doing.
///
/// The value is the shared `POLLER_STOP_GRACE_MS` rather than a local number so
/// the ping monitor, the SNMP watchers and the file servers cannot drift apart.
const SHUTDOWN_GRACE_MS: u64 = POLLER_STOP_GRACE_MS;

/// Handle to a running monitor — the cancel token plus the task's `JoinHandle`.
///
/// The join handle is what makes teardown enforceable (ADR-011): the cancel
/// channel only *asks* the loop to stop, so without a handle a task that never
/// observes the token would outlive its pane. Mirrors `snmp::WatcherHandle`.
pub struct MonitorHandle {
    cancel: tokio::sync::watch::Sender<bool>,
    targets: Arc<Mutex<Vec<String>>>,
    interval_ms: Arc<Mutex<u64>>,
    join: tokio::task::JoinHandle<()>,
}

/// Signal a monitor to stop, wait briefly for the loop to wind down, then force
/// abort. A `timeout` on a `JoinHandle` only *detaches* the task, so the explicit
/// abort is what actually stops a loop that ignored cancellation — that is what
/// the shared `join_or_abort` does, and it also logs the forced abort, which a
/// hand-rolled copy silently dropped.
async fn shutdown(handle: MonitorHandle) {
    let _ = handle.cancel.send(true);
    join_or_abort(vec![handle.join], "ping monitor", SHUTDOWN_GRACE_MS).await;
}

// ---------------------------------------------------------------------------
// Target validation
// ---------------------------------------------------------------------------

/// Validate that a target is a reasonable hostname/IP (no shell metacharacters).
pub fn is_valid_ping_target(target: &str) -> bool {
    if target.is_empty() || target.len() > MAX_TARGET_LEN {
        return false;
    }

    use std::sync::OnceLock;
    static RE: OnceLock<regex_lite::Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        regex_lite::Regex::new(r"^[a-zA-Z0-9:][a-zA-Z0-9.:\-]{0,251}[a-zA-Z0-9.:]?$").unwrap()
    });
    re.is_match(target)
}

// ---------------------------------------------------------------------------
// Timestamp helpers
// ---------------------------------------------------------------------------
//
// The civil-date math these used to carry now lives in `services::timefmt` so
// the Interface Traffic Watcher can share it instead of copying it a third time.

use crate::services::timefmt::{format_file_timestamp, format_timestamp};

// ---------------------------------------------------------------------------
// Ping execution
// ---------------------------------------------------------------------------

/// Execute a single ping to a target and return the result.
async fn ping_target(target: &str) -> PingResult {
    let timestamp = format_timestamp();

    let result = tokio::time::timeout(
        std::time::Duration::from_millis(PING_KILL_TIMEOUT_MS),
        execute_ping(target),
    )
    .await;

    match result {
        Ok(pr) => PingResult {
            target: target.to_string(),
            timestamp,
            ..pr
        },
        Err(_) => PingResult {
            target: target.to_string(),
            status: "fail".to_string(),
            rtt: None,
            ttl: None,
            timestamp,
        },
    }
}

/// Ping every target with at most `MAX_CONCURRENT_PINGS` in flight, returning
/// the results **in the original target order**.
///
/// Order matters to the UI, not just to tests: the pane rebuilds its table from
/// the emitted snapshot and numbers the rows by position, so a completion-order
/// result vector would reshuffle every row on every cycle.
/// `buffer_unordered` yields by completion, hence the index tag and the sort.
///
/// Generic over the ping fn so the ordering and the concurrency cap can be
/// tested without spawning real subprocesses.
async fn ping_all<F, Fut>(targets: &[String], ping: F) -> Vec<PingResult>
where
    F: Fn(String) -> Fut,
    Fut: std::future::Future<Output = PingResult>,
{
    let mut indexed: Vec<(usize, PingResult)> =
        futures::stream::iter(targets.iter().cloned().enumerate().map(|(i, t)| {
            let fut = ping(t);
            async move { (i, fut.await) }
        }))
        .buffer_unordered(MAX_CONCURRENT_PINGS)
        .collect()
        .await;

    indexed.sort_unstable_by_key(|(i, _)| *i);
    indexed.into_iter().map(|(_, r)| r).collect()
}

/// Run the system `ping` command and parse the output.
async fn execute_ping(target: &str) -> PingResult {
    use tokio::process::Command;

    // kill_on_drop: the poll loop can be aborted mid-cycle during teardown, and
    // the `ping_target` timeout also drops this future. Without it the child
    // `ping` would be orphaned rather than reaped.
    #[cfg(windows)]
    let output = Command::new("ping")
        .args(["-n", "1", "-w", "3000", target])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .kill_on_drop(true)
        .output()
        .await;

    #[cfg(not(windows))]
    let output = Command::new("ping")
        .args(["-c", "1", "-W", "3", target])
        .kill_on_drop(true)
        .output()
        .await;

    let timestamp = format_timestamp();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let stderr = String::from_utf8_lossy(&out.stderr);
            let combined = format!("{stdout}{stderr}");

            if out.status.success() {
                let rtt = parse_rtt(&combined);
                let ttl = parse_ttl(&combined);
                PingResult {
                    target: target.to_string(),
                    status: "ok".to_string(),
                    rtt,
                    ttl,
                    timestamp,
                }
            } else {
                let is_dns = combined.to_lowercase().contains("could not find host")
                    || combined.to_lowercase().contains("getaddrinfo failed")
                    || combined
                        .to_lowercase()
                        .contains("name or service not known");
                PingResult {
                    target: target.to_string(),
                    status: if is_dns { "dns" } else { "fail" }.to_string(),
                    rtt: None,
                    ttl: None,
                    timestamp,
                }
            }
        }
        Err(_) => PingResult {
            target: target.to_string(),
            status: "fail".to_string(),
            rtt: None,
            ttl: None,
            timestamp,
        },
    }
}

/// Parse RTT from ping output (e.g., "time=45ms" or "time<1ms").
fn parse_rtt(output: &str) -> Option<u32> {
    use std::sync::OnceLock;
    static RE: OnceLock<regex_lite::Regex> = OnceLock::new();
    let re = RE.get_or_init(|| regex_lite::Regex::new(r"(?i)time[=<](\d+)\s*ms").unwrap());
    re.captures(output)
        .and_then(|cap| cap.get(1))
        .and_then(|m| m.as_str().parse().ok())
}

/// Parse TTL from ping output (e.g., "TTL=59").
fn parse_ttl(output: &str) -> Option<u32> {
    use std::sync::OnceLock;
    static RE: OnceLock<regex_lite::Regex> = OnceLock::new();
    let re = RE.get_or_init(|| regex_lite::Regex::new(r"(?i)TTL=(\d+)").unwrap());
    re.captures(output)
        .and_then(|cap| cap.get(1))
        .and_then(|m| m.as_str().parse().ok())
}

// ---------------------------------------------------------------------------
// CSV logging
// ---------------------------------------------------------------------------

/// Set up CSV logging for a ping monitor session.
/// Returns (file_name, file_handle) if successful.
fn setup_csv_logging(logging_path: &str) -> Option<(String, std::fs::File)> {
    use std::fs;
    use std::io::Write;
    use std::path::Path;

    let dir = Path::new(logging_path);
    if !dir.is_dir() {
        return None;
    }

    let ts = format_file_timestamp();
    let mut file_name = format!("{ts}-PING-MONITOR.csv");
    let mut counter = 1u32;
    while dir.join(&file_name).exists() {
        file_name = format!("{ts}-PING-MONITOR-{counter}.csv");
        counter += 1;
        if counter > 9999 {
            break;
        }
    }

    let full_path = dir.join(&file_name);
    let mut file = fs::File::create(&full_path).ok()?;
    let _ = writeln!(file, "timestamp,target,status,rtt_ms,ttl");
    Some((file_name, file))
}

/// Write a single ping result row to the CSV file.
fn write_csv_row(file: &mut std::fs::File, result: &PingResult) {
    use std::io::Write;

    let target = result.target.replace(',', "");
    let rtt = result.rtt.map(|v| v.to_string()).unwrap_or_default();
    let ttl = result.ttl.map(|v| v.to_string()).unwrap_or_default();

    let _ = writeln!(
        file,
        "{},{},{},{},{}",
        result.timestamp, target, result.status, rtt, ttl
    );
}

// ---------------------------------------------------------------------------
// Monitor lifecycle
// ---------------------------------------------------------------------------

/// Configuration for starting a ping monitor.
pub struct StartMonitorConfig {
    pub session_id: String,
    pub targets: Vec<String>,
    pub interval_ms: u64,
    pub logging_enabled: bool,
    pub logging_path: String,
}

/// Start a ping monitor for a session.
pub async fn start_monitor(
    app: AppHandle,
    monitors: &mut HashMap<String, MonitorHandle>,
    config: StartMonitorConfig,
) {
    let valid_targets: Vec<String> = config
        .targets
        .into_iter()
        .filter(|t| is_valid_ping_target(t))
        .collect();

    if valid_targets.is_empty() {
        log::warn!(
            "ping-monitor: no valid targets for session {}",
            config.session_id
        );
        return;
    }

    let session_id = config.session_id;

    // Stop existing monitor. Fully tear it down (cancel, then abort if it does
    // not stop) before starting the replacement — dropping the handle alone
    // would leave the old loop emitting under the same session id.
    if let Some(existing) = monitors.remove(&session_id) {
        shutdown(existing).await;
    }

    let interval = config.interval_ms.max(MIN_INTERVAL_MS);
    let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
    let targets_arc = Arc::new(Mutex::new(valid_targets));
    let interval_arc = Arc::new(Mutex::new(interval));

    // Cloned before the spawn: the originals move into the loop, these stay
    // behind on the handle so update_targets/update_interval can reach them.
    let targets_for_handle = Arc::clone(&targets_arc);
    let interval_for_handle = Arc::clone(&interval_arc);

    // Spawn the monitoring loop
    let sid = session_id.clone();
    let logging_enabled = config.logging_enabled;
    let logging_path = config.logging_path;
    let join = tokio::spawn(async move {
        // Set up CSV logging if enabled
        let mut csv_file = if logging_enabled && !logging_path.is_empty() {
            match setup_csv_logging(&logging_path) {
                Some((file_name, file)) => {
                    let _ = app.emit(
                        "ping-monitor-log-file",
                        PingLogFilePayload {
                            session_id: sid.clone(),
                            file_name,
                        },
                    );
                    Some(file)
                }
                None => None,
            }
        } else {
            None
        };

        let mut cancel_rx = cancel_rx;

        loop {
            // Run one ping cycle
            let current_targets = targets_arc.lock().await.clone();
            if !current_targets.is_empty() {
                // Fan the cycle out rather than awaiting each ping in turn: a
                // `Vec` of futures is inert until polled, so the old
                // collect-then-await-in-a-loop ran strictly one target at a
                // time and every slow or silent host stalled the whole cycle.
                let results =
                    ping_all(&current_targets, |t| async move { ping_target(&t).await }).await;

                // Write to CSV if logging
                if let Some(ref mut file) = csv_file {
                    for r in &results {
                        write_csv_row(file, r);
                    }
                }

                // Emit results
                let _ = app.emit(
                    "ping-monitor-data",
                    PingDataPayload {
                        session_id: sid.clone(),
                        results,
                    },
                );
            }

            // Wait for interval or cancel
            let current_interval = *interval_arc.lock().await;
            let sleep = tokio::time::sleep(std::time::Duration::from_millis(current_interval));

            tokio::select! {
                _ = sleep => {},
                _ = cancel_rx.changed() => {
                    log::info!("ping-monitor: session {sid} cancelled");
                    break;
                }
            }

            // Check if cancelled
            if *cancel_rx.borrow() {
                break;
            }
        }
    });

    monitors.insert(
        session_id.clone(),
        MonitorHandle {
            cancel: cancel_tx,
            targets: targets_for_handle,
            interval_ms: interval_for_handle,
            join,
        },
    );

    log::info!("ping-monitor: started for session {session_id}");
}

/// Stop a monitor by session id.
pub async fn stop_monitor(monitors: &mut HashMap<String, MonitorHandle>, session_id: &str) {
    if let Some(handle) = monitors.remove(session_id) {
        shutdown(handle).await;
        log::info!("ping-monitor: stopped session {session_id}");
    }
}

/// Update targets for a running monitor.
pub async fn update_targets(
    monitors: &HashMap<String, MonitorHandle>,
    session_id: &str,
    targets: Vec<String>,
) {
    if let Some(handle) = monitors.get(session_id) {
        let valid: Vec<String> = targets
            .into_iter()
            .filter(|t| is_valid_ping_target(t))
            .collect();
        *handle.targets.lock().await = valid;
    }
}

/// Update interval for a running monitor.
pub async fn update_interval(
    monitors: &HashMap<String, MonitorHandle>,
    session_id: &str,
    interval_ms: u64,
) {
    if let Some(handle) = monitors.get(session_id) {
        *handle.interval_ms.lock().await = interval_ms.max(MIN_INTERVAL_MS);
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_targets() {
        assert!(is_valid_ping_target("google.com"));
        assert!(is_valid_ping_target("192.168.1.1"));
        assert!(is_valid_ping_target("::1"));
        assert!(is_valid_ping_target("fe80::1"));
        assert!(is_valid_ping_target("server-01.example.com"));
        assert!(is_valid_ping_target("a"));
    }

    #[test]
    fn invalid_targets() {
        assert!(!is_valid_ping_target(""));
        assert!(!is_valid_ping_target(" "));
        assert!(!is_valid_ping_target("; rm -rf /"));
        assert!(!is_valid_ping_target("host | cat"));
        assert!(!is_valid_ping_target("host&cmd"));
        assert!(!is_valid_ping_target("host$(evil)"));
        assert!(!is_valid_ping_target(&"a".repeat(254)));
    }

    #[test]
    fn parse_rtt_windows_output() {
        let output = "Reply from 192.168.1.1: bytes=32 time=1ms TTL=64";
        assert_eq!(parse_rtt(output), Some(1));
    }

    #[test]
    fn parse_rtt_less_than() {
        let output = "Reply from 127.0.0.1: bytes=32 time<1ms TTL=128";
        assert_eq!(parse_rtt(output), Some(1));
    }

    #[test]
    fn parse_rtt_no_match() {
        let output = "Request timed out.";
        assert_eq!(parse_rtt(output), None);
    }

    #[test]
    fn parse_ttl_works() {
        let output = "Reply from 192.168.1.1: bytes=32 time=1ms TTL=64";
        assert_eq!(parse_ttl(output), Some(64));
    }

    #[test]
    fn parse_ttl_no_match() {
        let output = "Request timed out.";
        assert_eq!(parse_ttl(output), None);
    }

    #[test]
    fn ping_result_serializes() {
        let r = PingResult {
            target: "google.com".into(),
            status: "ok".into(),
            rtt: Some(45),
            ttl: Some(59),
            timestamp: "2024-01-01 00:00:00.000".into(),
        };
        let json = serde_json::to_value(&r).unwrap();
        assert_eq!(json["target"], "google.com");
        assert_eq!(json["status"], "ok");
        assert_eq!(json["rtt"], 45);
        assert_eq!(json["ttl"], 59);
    }

    #[test]
    fn ping_result_null_rtt_ttl() {
        let r = PingResult {
            target: "bad.host".into(),
            status: "fail".into(),
            rtt: None,
            ttl: None,
            timestamp: "2024-01-01 00:00:00.000".into(),
        };
        let json = serde_json::to_value(&r).unwrap();
        assert!(json["rtt"].is_null());
        assert!(json["ttl"].is_null());
    }

    #[test]
    fn ping_data_payload_serializes() {
        let payload = PingDataPayload {
            session_id: "s1".into(),
            results: vec![PingResult {
                target: "host".into(),
                status: "ok".into(),
                rtt: Some(10),
                ttl: Some(64),
                timestamp: "ts".into(),
            }],
        };
        let json = serde_json::to_value(&payload).unwrap();
        assert_eq!(json["sessionId"], "s1");
        assert_eq!(json["results"][0]["target"], "host");
    }

    #[test]
    fn ping_log_file_payload_serializes() {
        let payload = PingLogFilePayload {
            session_id: "s1".into(),
            file_name: "20240101-PING-MONITOR.csv".into(),
        };
        let json = serde_json::to_value(&payload).unwrap();
        assert_eq!(json["sessionId"], "s1");
        assert_eq!(json["fileName"], "20240101-PING-MONITOR.csv");
    }

    // The timestamp-format tests moved to `services::timefmt` along with the
    // functions themselves.

    #[test]
    fn csv_row_format() {
        use std::io::Read;

        let dir = std::env::temp_dir().join("hotty_test_csv_row");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let path = dir.join("test.csv");
        let mut file = std::fs::File::create(&path).unwrap();
        let result = PingResult {
            target: "google.com".into(),
            status: "ok".into(),
            rtt: Some(45),
            ttl: Some(59),
            timestamp: "2024-01-01 00:00:00.000".into(),
        };
        write_csv_row(&mut file, &result);
        drop(file);

        let mut content = String::new();
        std::fs::File::open(&path)
            .unwrap()
            .read_to_string(&mut content)
            .unwrap();
        assert!(content.contains("2024-01-01 00:00:00.000,google.com,ok,45,59"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn csv_row_strips_commas_from_target() {
        use std::io::Read;

        let dir = std::env::temp_dir().join("hotty_test_csv_comma");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let path = dir.join("test.csv");
        let mut file = std::fs::File::create(&path).unwrap();
        let result = PingResult {
            target: "host,with,commas".into(),
            status: "fail".into(),
            rtt: None,
            ttl: None,
            timestamp: "ts".into(),
        };
        write_csv_row(&mut file, &result);
        drop(file);

        let mut content = String::new();
        std::fs::File::open(&path)
            .unwrap()
            .read_to_string(&mut content)
            .unwrap();
        assert!(content.contains("hostwithcommas"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn setup_csv_logging_nonexistent_dir() {
        assert!(setup_csv_logging("/nonexistent/dir/path").is_none());
    }

    #[test]
    fn setup_csv_logging_creates_file() {
        let dir = std::env::temp_dir().join("hotty_test_csv_setup");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let result = setup_csv_logging(dir.to_str().unwrap());
        assert!(result.is_some());
        let (file_name, _) = result.unwrap();
        assert!(file_name.ends_with("-PING-MONITOR.csv"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn monitor_state_default() {
        let state = PingMonitorState::default();
        // Just verify it creates successfully
        let monitors = state.monitors.try_lock().unwrap();
        assert!(monitors.is_empty());
    }

    // -----------------------------------------------------------------------
    // Cycle fan-out — `ping_all` is generic over the ping fn precisely so these
    // can run without spawning real `ping` subprocesses.
    // -----------------------------------------------------------------------

    fn fake_ok(target: &str) -> PingResult {
        PingResult {
            target: target.to_string(),
            status: "ok".into(),
            rtt: Some(1),
            ttl: Some(64),
            timestamp: "ts".into(),
        }
    }

    /// `buffer_unordered` yields by completion, so the results must be sorted
    /// back into target order. The pane numbers its rows by position — without
    /// this the table reshuffles on every cycle.
    #[tokio::test]
    async fn ping_all_preserves_target_order() {
        let targets: Vec<String> = ["a", "b", "c", "d"].iter().map(|s| s.to_string()).collect();

        // Deliberately inverted: "a" finishes last, "d" first.
        let results = ping_all(&targets, |t| async move {
            let delay = match t.as_str() {
                "a" => 40,
                "b" => 30,
                "c" => 20,
                _ => 1,
            };
            tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
            fake_ok(&t)
        })
        .await;

        let order: Vec<&str> = results.iter().map(|r| r.target.as_str()).collect();
        assert_eq!(order, ["a", "b", "c", "d"]);
    }

    /// Repeated targets must not collapse or reorder — the index tag, not the
    /// target string, is what the sort keys on.
    #[tokio::test]
    async fn ping_all_keeps_duplicate_targets_positional() {
        let targets: Vec<String> = ["x", "y", "x"].iter().map(|s| s.to_string()).collect();
        let results = ping_all(&targets, |t| async move { fake_ok(&t) }).await;
        let order: Vec<&str> = results.iter().map(|r| r.target.as_str()).collect();
        assert_eq!(order, ["x", "y", "x"]);
    }

    #[tokio::test]
    async fn ping_all_empty_targets_yields_nothing() {
        let results = ping_all(&[], |t| async move { fake_ok(&t) }).await;
        assert!(results.is_empty());
    }

    /// The regression this whole change exists for: targets must overlap in
    /// flight rather than run one at a time.
    #[tokio::test]
    async fn ping_all_runs_targets_concurrently() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let inflight = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let targets: Vec<String> = (0..8).map(|i| format!("h{i}")).collect();

        ping_all(&targets, |t| {
            let inflight = Arc::clone(&inflight);
            let peak = Arc::clone(&peak);
            async move {
                let now = inflight.fetch_add(1, Ordering::SeqCst) + 1;
                peak.fetch_max(now, Ordering::SeqCst);
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                inflight.fetch_sub(1, Ordering::SeqCst);
                fake_ok(&t)
            }
        })
        .await;

        assert_eq!(peak.load(Ordering::SeqCst), 8);
    }

    /// …but not unboundedly: every in-flight ping is a subprocess, so the fan-out
    /// is capped at `MAX_CONCURRENT_PINGS`.
    #[tokio::test]
    async fn ping_all_caps_concurrency_at_the_limit() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let inflight = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let count = MAX_CONCURRENT_PINGS * 2 + 7;
        let targets: Vec<String> = (0..count).map(|i| format!("h{i}")).collect();

        let results = ping_all(&targets, |t| {
            let inflight = Arc::clone(&inflight);
            let peak = Arc::clone(&peak);
            async move {
                let now = inflight.fetch_add(1, Ordering::SeqCst) + 1;
                peak.fetch_max(now, Ordering::SeqCst);
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
                inflight.fetch_sub(1, Ordering::SeqCst);
                fake_ok(&t)
            }
        })
        .await;

        assert_eq!(results.len(), count);
        assert_eq!(peak.load(Ordering::SeqCst), MAX_CONCURRENT_PINGS);
    }

    // -----------------------------------------------------------------------
    // Teardown (ADR-011) — mirrors `snmp::stop_watcher`'s tests.
    // -----------------------------------------------------------------------

    /// A handle whose task parks on the cancel channel, so joining completes as
    /// soon as it is signalled.
    fn spawn_parked() -> MonitorHandle {
        let (cancel, mut rx) = tokio::sync::watch::channel(false);
        let join = tokio::spawn(async move {
            let _ = rx.changed().await;
        });
        MonitorHandle {
            cancel,
            targets: Arc::new(Mutex::new(vec!["192.168.1.1".to_string()])),
            interval_ms: Arc::new(Mutex::new(10_000)),
            join,
        }
    }

    #[tokio::test]
    async fn stop_monitor_removes_and_cancels() {
        let mut map = HashMap::new();
        map.insert("ping-1".to_string(), spawn_parked());
        stop_monitor(&mut map, "ping-1").await;
        assert!(map.is_empty());
    }

    #[tokio::test]
    async fn stop_monitor_is_noop_for_unknown_session() {
        let mut map = HashMap::new();
        map.insert("ping-1".to_string(), spawn_parked());
        stop_monitor(&mut map, "ping-nope").await;
        assert_eq!(map.len(), 1);
    }

    /// A loop that never observes the cancel channel must still be stopped.
    /// This is precisely what the `JoinHandle` on `MonitorHandle` buys: before
    /// it existed, `stop_monitor` could only *ask* the task to stop.
    #[tokio::test]
    async fn stop_monitor_aborts_a_task_that_ignores_cancellation() {
        let (cancel, _rx) = tokio::sync::watch::channel(false);
        let join = tokio::spawn(async { std::future::pending::<()>().await });
        let abort_probe = join.abort_handle();
        let mut map = HashMap::new();
        map.insert(
            "ping-stuck".to_string(),
            MonitorHandle {
                cancel,
                targets: Arc::new(Mutex::new(Vec::new())),
                interval_ms: Arc::new(Mutex::new(10_000)),
                join,
            },
        );

        // The grace period elapses, then the task is aborted.
        stop_monitor(&mut map, "ping-stuck").await;
        assert!(map.is_empty());

        // `abort()` only *requests* cancellation — the task is not marked
        // finished until the runtime gets a turn to drop it, so yield rather
        // than asserting on the very next line.
        for _ in 0..16 {
            if abort_probe.is_finished() {
                break;
            }
            tokio::task::yield_now().await;
        }
        assert!(abort_probe.is_finished());
    }
}
