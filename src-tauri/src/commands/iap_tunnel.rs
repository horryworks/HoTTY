use std::sync::Arc;

use crate::services::gcloud_iap;
use crate::services::iap_tunnel::{
    self, GceInstance, GcloudAuthStatus, GcloudCacheSnapshot, GcloudCacheState, GcloudStatus,
    GcpProject,
};

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Check if gcloud CLI is installed and return version info.
#[tauri::command]
pub async fn gce_iap_check_gcloud() -> Result<GcloudStatus, String> {
    Ok(iap_tunnel::check_gcloud().await)
}

/// Check if gcloud is authenticated and return the active account.
#[tauri::command]
pub async fn gce_iap_check_auth() -> Result<GcloudAuthStatus, String> {
    Ok(iap_tunnel::check_auth().await)
}

/// List GCP projects accessible to the authenticated user.
#[tauri::command]
pub async fn gce_iap_list_projects() -> Result<Vec<GcpProject>, String> {
    Ok(iap_tunnel::list_projects().await)
}

/// List zones that have compute instances for a given project.
#[tauri::command]
pub async fn gce_iap_list_zones(project: String) -> Result<Vec<String>, String> {
    Ok(iap_tunnel::list_zones(&project).await)
}

/// List compute instances in a given project and zone.
#[tauri::command]
pub async fn gce_iap_list_instances(
    project: String,
    zone: String,
) -> Result<Vec<GceInstance>, String> {
    Ok(iap_tunnel::list_instances(&project, &zone).await)
}

/// Deliver the user's response to an `iap-vm-start-prompt` event. The backend's
/// pre-flight `ensure_vm_running` is awaiting a oneshot keyed by `session_id`;
/// this command unblocks it.
#[tauri::command]
pub fn gce_iap_respond_vm_start(session_id: String, approved: bool) -> Result<(), String> {
    gcloud_iap::respond_vm_start(&session_id, approved)
}

// ---------------------------------------------------------------------------
// GCP cache (powers the "GCP" sidebar tab — lazy refresh on first open)
// ---------------------------------------------------------------------------

/// Return the current GCP cache snapshot. Cheap, never triggers a fetch.
#[tauri::command]
pub fn gce_iap_get_cache(
    state: tauri::State<'_, Arc<GcloudCacheState>>,
) -> Result<GcloudCacheSnapshot, String> {
    Ok(state.snapshot())
}

/// Run a full refresh: gcloud → auth → projects → instances per project. Emits
/// `gcp-refresh-progress` events during the run and `gcp-cache-updated` on
/// completion. Returns the final snapshot. If a refresh is already in flight,
/// this becomes a no-op (the in-flight run owns the events).
#[tauri::command]
pub async fn gce_iap_refresh_cache(
    state: tauri::State<'_, Arc<GcloudCacheState>>,
    app: tauri::AppHandle,
) -> Result<GcloudCacheSnapshot, String> {
    let s = state.inner().clone();
    s.refresh_all(app).await;
    Ok(s.snapshot())
}

/// Start a stopped GCE instance. Blocks until gcloud returns (up to the
/// service-level timeout). The frontend should optimistically render the VM
/// as transitioning while this is running.
#[tauri::command]
pub async fn gce_iap_start_instance(
    project: String,
    zone: String,
    instance: String,
) -> Result<(), String> {
    iap_tunnel::start_instance(&project, &zone, &instance).await
}

/// Stop a running GCE instance.
#[tauri::command]
pub async fn gce_iap_stop_instance(
    project: String,
    zone: String,
    instance: String,
) -> Result<(), String> {
    iap_tunnel::stop_instance(&project, &zone, &instance).await
}

/// Lightweight per-VM status check (single `gcloud compute instances describe`).
/// Returns the raw status string (e.g. "RUNNING", "PROVISIONING", "STAGING",
/// "STOPPING", "TERMINATED"). Used by the GCP tab to poll an in-flight
/// start/stop so the UI can move beyond the optimistic "STARTING"/"STOPPING"
/// placeholder as soon as gcloud reports a real transition.
#[tauri::command]
pub async fn gce_iap_get_instance_status(
    project: String,
    zone: String,
    instance: String,
) -> Result<String, String> {
    iap_tunnel::get_instance_status(&project, &zone, &instance)
        .await
        .map(|s| s.as_str().to_string())
}
