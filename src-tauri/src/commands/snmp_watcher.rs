//! Tauri commands for the Interface Traffic Watcher pane.
//!
//! Thin by design: validation lives in `services::snmp::config` and the work
//! lives in `services::snmp::poller`, both of which are unit-testable without a
//! Tauri runtime.

use std::sync::Arc;

use tauri::{AppHandle, State, Window};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::services::snmp::{
    clamp_interval, is_valid_pane_id, poller, stop_watcher, validate, SnmpConfigDto, SnmpDiscovery,
    SnmpWatcherState, WatcherHandle,
};

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
    if let Some(handle) = watchers.get(&pane_id) {
        *handle.interval_ms.lock().await = clamp_interval(interval_ms);
    }
    Ok(())
}

/// One-shot connection test and interface listing. Spawns nothing and is bounded
/// by its own budget, so it needs no lifecycle management.
#[tauri::command]
pub async fn snmp_list_interfaces(config: SnmpConfigDto) -> Result<SnmpDiscovery, String> {
    let target = validate(config)?;
    poller::discover(target).await
}
