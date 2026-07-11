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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
//
// Every command in this module is a thin async wrapper that shells out to
// gcloud (or touches managed Tauri state), so there is no AppHandle-free command
// logic to exercise directly. Instead we lock down the serde payload contracts
// these commands return to the frontend: field casing and the
// `skip_serializing_if` behavior the TypeScript types depend on.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gcloud_status_serializes_camel_case_and_skips_none_version() {
        let s = GcloudStatus {
            available: true,
            version: None,
        };
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["available"], true);
        // `version` is None → omitted from the payload entirely.
        assert!(json.get("version").is_none());

        let with_version = GcloudStatus {
            available: true,
            version: Some("500.0.0".into()),
        };
        assert_eq!(
            serde_json::to_value(&with_version).unwrap()["version"],
            "500.0.0"
        );
    }

    #[test]
    fn gcloud_status_deserializes_with_missing_version() {
        let s: GcloudStatus = serde_json::from_value(serde_json::json!({
            "available": false
        }))
        .unwrap();
        assert!(!s.available);
        assert!(s.version.is_none());
    }

    #[test]
    fn gcloud_auth_status_roundtrips() {
        let s = GcloudAuthStatus {
            authenticated: true,
            account: Some("dev@example.com".into()),
        };
        let json = serde_json::to_string(&s).unwrap();
        let back: GcloudAuthStatus = serde_json::from_str(&json).unwrap();
        assert!(back.authenticated);
        assert_eq!(back.account.as_deref(), Some("dev@example.com"));
    }

    #[test]
    fn gcp_project_roundtrips() {
        let p = GcpProject {
            id: "my-project".into(),
            name: "My Project".into(),
        };
        let json = serde_json::to_string(&p).unwrap();
        let back: GcpProject = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "my-project");
        assert_eq!(back.name, "My Project");
    }

    #[test]
    fn gce_instance_serializes_camel_case_and_omits_absent_optionals() {
        let inst = GceInstance {
            name: "vm-1".into(),
            status: "RUNNING".into(),
            zone: Some("us-central1-a".into()),
            access: None,
        };
        let json = serde_json::to_value(&inst).unwrap();
        assert_eq!(json["name"], "vm-1");
        assert_eq!(json["status"], "RUNNING");
        assert_eq!(json["zone"], "us-central1-a");
        // `access` is None → omitted so older payload consumers stay compatible.
        assert!(json.get("access").is_none());
    }

    #[test]
    fn gce_instance_deserializes_minimal_payload() {
        // Older/minimal payloads carry only name + status.
        let inst: GceInstance = serde_json::from_value(serde_json::json!({
            "name": "vm-2",
            "status": "TERMINATED"
        }))
        .unwrap();
        assert_eq!(inst.name, "vm-2");
        assert_eq!(inst.status, "TERMINATED");
        assert!(inst.zone.is_none());
        assert!(inst.access.is_none());
    }
}
