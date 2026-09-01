//! Interface Traffic Watcher — SNMP polling of IF-MIB counters.
//!
//! Layout:
//!   * `config`  — wire DTO, validated target, secret handling
//!   * `oids`    — IF-MIB column tables and instance extraction
//!   * `rates`   — counter differencing and rate derivation
//!   * `payload` — the structs emitted to the renderer
//!   * `session` — transport, retry ladder, GETBULK walk
//!   * `poller`  — the cycle loop and row assembly
//!
//! Lifecycle note: unlike `ping_monitor`, a watcher handle carries both a
//! `JoinHandle` and the label of the window that started it, so closing a window
//! with the pane still open tears the poll loop down instead of leaking it. That
//! mirrors `file_server::ServerHandle`.

pub mod config;
pub mod oids;
pub mod payload;
pub mod poller;
pub mod rates;
pub mod session;

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::services::session_service::{join_or_abort, POLLER_STOP_GRACE_MS};

pub use config::{clamp_interval, is_valid_pane_id, validate, SnmpConfigDto, SnmpTarget};
pub use payload::SnmpDiscovery;

/// A running watcher.
pub struct WatcherHandle {
    pub cancel: CancellationToken,
    pub join: tokio::task::JoinHandle<()>,
    /// Re-read by the poll loop every cycle, so the interval can change without
    /// restarting the session.
    pub interval_ms: Arc<Mutex<u64>>,
    /// Label of the window that started this watcher, so it can be torn down
    /// when that window closes (mirrors `SessionOwners` for sessions).
    pub window_label: String,
}

/// Shared Tauri state: running watchers keyed by the owning pane's id.
pub struct SnmpWatcherState {
    pub watchers: Arc<Mutex<HashMap<String, WatcherHandle>>>,
}

impl SnmpWatcherState {
    pub fn new() -> Self {
        Self {
            watchers: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl Default for SnmpWatcherState {
    fn default() -> Self {
        Self::new()
    }
}

/// Signal a watcher to stop, wait briefly for the task to wind down, then force
/// abort. A `timeout` on a `JoinHandle` only *detaches* the task, so the explicit
/// abort is what actually stops a loop that ignored cancellation — that is what
/// the shared `join_or_abort` does, and it also logs the forced abort, which a
/// hand-rolled copy silently dropped.
pub async fn stop_watcher(map: &mut HashMap<String, WatcherHandle>, pane_id: &str) {
    if let Some(handle) = map.remove(pane_id) {
        handle.cancel.cancel();
        join_or_abort(vec![handle.join], "snmp watcher", POLLER_STOP_GRACE_MS).await;
        log::info!("snmp: stopped watcher for pane {pane_id}");
    }
}

/// Stop every watcher started by the window labelled `label`. Called when that
/// window is destroyed so a pane closed together with its window does not leave
/// a poll loop running in the shared process.
pub async fn stop_watchers_for_window(
    watchers: &Arc<Mutex<HashMap<String, WatcherHandle>>>,
    label: &str,
) {
    let mut guard = watchers.lock().await;
    let ids: Vec<String> = guard
        .iter()
        .filter(|(_, h)| h.window_label == label)
        .map(|(id, _)| id.clone())
        .collect();
    for id in ids {
        stop_watcher(&mut guard, &id).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A handle whose task parks on cancellation, so joining completes as soon
    /// as it is cancelled.
    fn spawn_parked(window_label: &str) -> WatcherHandle {
        let cancel = CancellationToken::new();
        let child = cancel.clone();
        let join = tokio::spawn(async move { child.cancelled().await });
        WatcherHandle {
            cancel,
            join,
            interval_ms: Arc::new(Mutex::new(10_000)),
            window_label: window_label.to_string(),
        }
    }

    #[tokio::test]
    async fn watcher_state_default_is_empty() {
        let state = SnmpWatcherState::new();
        assert!(state.watchers.lock().await.is_empty());
    }

    #[tokio::test]
    async fn stop_watcher_removes_and_cancels() {
        let mut map = HashMap::new();
        map.insert("if-1".to_string(), spawn_parked("main"));
        stop_watcher(&mut map, "if-1").await;
        assert!(map.is_empty());
    }

    #[tokio::test]
    async fn stop_watcher_is_noop_for_unknown_pane() {
        let mut map = HashMap::new();
        map.insert("if-1".to_string(), spawn_parked("main"));
        stop_watcher(&mut map, "if-nope").await;
        assert_eq!(map.len(), 1);
    }

    #[tokio::test]
    async fn stop_watchers_for_window_stops_only_that_windows_watchers() {
        let watchers: Arc<Mutex<HashMap<String, WatcherHandle>>> =
            Arc::new(Mutex::new(HashMap::new()));
        {
            let mut guard = watchers.lock().await;
            guard.insert("if-main".to_string(), spawn_parked("main"));
            guard.insert("if-second".to_string(), spawn_parked("win-2"));
        }

        stop_watchers_for_window(&watchers, "win-2").await;

        let guard = watchers.lock().await;
        assert_eq!(guard.len(), 1);
        assert!(guard.contains_key("if-main"));
    }

    /// A task that ignores cancellation must still be stopped by the abort path.
    #[tokio::test]
    async fn stop_watcher_aborts_a_task_that_ignores_cancellation() {
        let cancel = CancellationToken::new();
        let join = tokio::spawn(async { std::future::pending::<()>().await });
        let abort_probe = join.abort_handle();
        let mut map = HashMap::new();
        map.insert(
            "if-stuck".to_string(),
            WatcherHandle {
                cancel,
                join,
                interval_ms: Arc::new(Mutex::new(10_000)),
                window_label: "main".to_string(),
            },
        );

        // The 2 s grace elapses, then the task is aborted.
        stop_watcher(&mut map, "if-stuck").await;
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
        assert!(abort_probe.is_finished(), "the stuck task was not aborted");
    }
}
