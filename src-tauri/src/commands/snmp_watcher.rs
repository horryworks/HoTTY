//! Tauri commands for the Interface Traffic Watcher pane.
//!
//! Thin by design: validation lives in `services::snmp::config` and the work
//! lives in `services::snmp::poller`, both of which are unit-testable without a
//! Tauri runtime.

use std::collections::HashMap;
use std::sync::Arc;

use tauri::{AppHandle, State, Window};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::services::snmp::{
    clamp_interval, is_valid_pane_id, poller, stop_watcher, validate, SnmpConfigDto, SnmpDiscovery,
    SnmpWatcherState, WatcherHandle,
};

/// Retune a running watcher's poll interval in place.
///
/// Split out of [`snmp_watcher_update_interval`] so the part that is not just
/// Tauri plumbing can be tested without a runtime. Returns whether a watcher was
/// actually retuned, so an unknown pane is an observable no-op rather than a
/// silent one. The clamp is applied here, not at the call site: the renderer's
/// interval picker is not the only possible caller and ADR-013 relies on the
/// floor holding for every path that can change the interval.
async fn retune_interval(
    map: &HashMap<String, WatcherHandle>,
    pane_id: &str,
    interval_ms: u64,
) -> bool {
    match map.get(pane_id) {
        Some(handle) => {
            *handle.interval_ms.lock().await = clamp_interval(interval_ms);
            true
        }
        None => false,
    }
}

/// Start (or restart) polling for a pane.
///
/// Starting again for the same pane replaces the existing watcher — that is also
/// how "change the target device" works, so there is exactly one code path that
/// builds a session.
///
/// Connecting happens inside the spawned task rather than here: DNS plus SNMPv3
/// engine discovery can take seconds, and blocking the invoke (while holding the
/// watcher map lock) for that long would freeze the UI.
#[tauri::command]
pub async fn snmp_watcher_start(
    app: AppHandle,
    window: Window,
    state: State<'_, SnmpWatcherState>,
    pane_id: String,
    config: SnmpConfigDto,
    interval_ms: u64,
) -> Result<(), String> {
    if !is_valid_pane_id(&pane_id) {
        return Err("Invalid pane id".to_string());
    }
    let target = validate(config)?;
    let interval = clamp_interval(interval_ms);

    let mut watchers = state.watchers.lock().await;
    stop_watcher(&mut watchers, &pane_id).await;

    let cancel = CancellationToken::new();
    let interval_ms = Arc::new(Mutex::new(interval));

    // `tokio::spawn`, not `tauri::async_runtime::spawn`: the handle needs
    // `abort_handle()` for the graceful-join-then-abort teardown, which tauri's
    // wrapper type does not expose. Same choice as `file_server`.
    let join = tokio::spawn(poller::run(
        app,
        pane_id.clone(),
        target,
        interval_ms.clone(),
        cancel.clone(),
    ));

    watchers.insert(
        pane_id,
        WatcherHandle {
            cancel,
            join,
            interval_ms,
            window_label: window.label().to_string(),
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn snmp_watcher_stop(
    state: State<'_, SnmpWatcherState>,
    pane_id: String,
) -> Result<(), String> {
    let mut watchers = state.watchers.lock().await;
    stop_watcher(&mut watchers, &pane_id).await;
    Ok(())
}

/// Change the poll interval of a running watcher without reconnecting.
#[tauri::command]
pub async fn snmp_watcher_update_interval(
    state: State<'_, SnmpWatcherState>,
    pane_id: String,
    interval_ms: u64,
) -> Result<(), String> {
    let watchers = state.watchers.lock().await;
    retune_interval(&watchers, &pane_id, interval_ms).await;
    Ok(())
}

/// One-shot connection test and interface listing. Spawns nothing and is bounded
/// by its own budget, so it needs no lifecycle management.
#[tauri::command]
pub async fn snmp_list_interfaces(config: SnmpConfigDto) -> Result<SnmpDiscovery, String> {
    let target = validate(config)?;
    poller::discover(target).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A handle whose task parks until cancelled — enough to stand in for a
    /// running watcher without opening an SNMP session.
    fn parked_watcher(interval_ms: u64) -> WatcherHandle {
        let cancel = CancellationToken::new();
        let child = cancel.clone();
        WatcherHandle {
            cancel,
            join: tokio::spawn(async move { child.cancelled().await }),
            interval_ms: Arc::new(Mutex::new(interval_ms)),
            window_label: "main".to_string(),
        }
    }

    #[tokio::test]
    async fn retune_interval_updates_a_running_watcher_in_place() {
        // The point of retuning rather than restarting: the poll loop re-reads
        // this value each cycle, so the SNMP session and the rate baseline
        // survive an interval change.
        let mut map = HashMap::new();
        map.insert("if-1".to_string(), parked_watcher(60_000));

        assert!(retune_interval(&map, "if-1", 30_000).await);
        assert_eq!(*map["if-1"].interval_ms.lock().await, 30_000);
    }

    #[tokio::test]
    async fn retune_interval_clamps_below_the_floor() {
        // A caller asking for 1 s must not get 1 s: a MIB walk runs on the
        // device's control-plane CPU (ADR-013).
        let mut map = HashMap::new();
        map.insert("if-1".to_string(), parked_watcher(60_000));

        assert!(retune_interval(&map, "if-1", 1_000).await);
        let applied = *map["if-1"].interval_ms.lock().await;
        assert_eq!(applied, clamp_interval(1_000));
        assert!(applied > 1_000, "the floor was not applied");
    }

    #[tokio::test]
    async fn retune_interval_is_a_no_op_for_an_unknown_pane() {
        // A stale renderer can send an interval for a pane that has already been
        // stopped; that must not create or resurrect a watcher.
        let mut map = HashMap::new();
        map.insert("if-1".to_string(), parked_watcher(60_000));

        assert!(!retune_interval(&map, "if-gone", 30_000).await);
        assert_eq!(map.len(), 1);
        assert_eq!(*map["if-1"].interval_ms.lock().await, 60_000);
    }

    /// The `start` command gates on this before touching the watcher map; the
    /// ids the renderer actually sends must pass and traversal-ish ones must not.
    #[test]
    fn start_rejects_pane_ids_it_should_not_accept() {
        assert!(is_valid_pane_id("if-1"));
        assert!(!is_valid_pane_id(""));
        assert!(!is_valid_pane_id("if-1/../if-2"));
    }
}
