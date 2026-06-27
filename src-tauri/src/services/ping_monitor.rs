use std::collections::HashMap;
use std::sync::Arc;

use serde::Serialize;
use tauri::AppHandle;
use tauri::Emitter;
use tokio::sync::Mutex;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Minimum ping interval (1 second).
const MIN_INTERVAL_MS: u64 = 1000;

/// Kill timeout for each ping subprocess (5 seconds).
const PING_KILL_TIMEOUT_MS: u64 = 5000;

/// Maximum target hostname/IP length.
const MAX_TARGET_LEN: usize = 253;

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

/// Handle to a running monitor — holds the cancel token.
pub struct MonitorHandle {
    cancel: tokio::sync::watch::Sender<bool>,
    targets: Arc<Mutex<Vec<String>>>,
    interval_ms: Arc<Mutex<u64>>,
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

fn format_timestamp() -> String {
    use std::time::SystemTime;

    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let millis = now.subsec_millis();

    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    let (year, month, day) = days_to_ymd(days);

    format!("{year:04}-{month:02}-{day:02} {hours:02}:{minutes:02}:{seconds:02}.{millis:03}")
}

fn format_file_timestamp() -> String {
    use std::time::SystemTime;

    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();

    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    let (year, month, day) = days_to_ymd(days);

    format!("{year:04}{month:02}{day:02}{hours:02}{minutes:02}{seconds:02}")
}

fn days_to_ymd(mut days: u64) -> (u64, u64, u64) {
    days += 719_468;
    let era = days / 146_097;
    let doe = days % 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

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

/// Run the system `ping` command and parse the output.
async fn execute_ping(target: &str) -> PingResult {
    use tokio::process::Command;

    #[cfg(windows)]
    let output = Command::new("ping")
        .args(["-n", "1", "-w", "3000", target])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output()
        .await;

    #[cfg(not(windows))]
    let output = Command::new("ping")
        .args(["-c", "1", "-W", "3", target])
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
pub fn start_monitor(
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

    // Stop existing monitor
    if let Some(existing) = monitors.remove(&session_id) {
        let _ = existing.cancel.send(true);
    }

    let interval = config.interval_ms.max(MIN_INTERVAL_MS);
    let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
    let targets_arc = Arc::new(Mutex::new(valid_targets));
    let interval_arc = Arc::new(Mutex::new(interval));

    let handle = MonitorHandle {
        cancel: cancel_tx,
        targets: Arc::clone(&targets_arc),
        interval_ms: Arc::clone(&interval_arc),
    };

    monitors.insert(session_id.clone(), handle);

    // Spawn the monitoring loop
    let sid = session_id.clone();
    let logging_enabled = config.logging_enabled;
    let logging_path = config.logging_path;
    tokio::spawn(async move {
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
                let mut results = Vec::with_capacity(current_targets.len());
                let futures: Vec<_> = current_targets.iter().map(|t| ping_target(t)).collect();
                for future in futures {
                    results.push(future.await);
                }

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

    log::info!("ping-monitor: started for session {session_id}");
}

/// Stop a monitor by session id.
pub fn stop_monitor(monitors: &mut HashMap<String, MonitorHandle>, session_id: &str) {
    if let Some(handle) = monitors.remove(session_id) {
        let _ = handle.cancel.send(true);
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

    #[test]
    fn format_timestamp_length() {
        let ts = format_timestamp();
        // YYYY-MM-DD HH:MM:SS.mmm = 23 chars
        assert_eq!(ts.len(), 23);
    }

    #[test]
    fn format_file_timestamp_length() {
        let ts = format_file_timestamp();
        // YYYYMMDDHHMMSS = 14 chars
        assert_eq!(ts.len(), 14);
    }

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
}
