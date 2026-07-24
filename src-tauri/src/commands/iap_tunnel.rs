use std::sync::Arc;

use crate::services::gcloud_iap;
use crate::services::iap_tunnel::{
    self, GceInstance, GcloudAuthStatus, GcloudCacheSnapshot, GcloudCacheState, GcloudStatus,
    GcpProject, VmAction, VmActionState,
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

/// Launch `gcloud auth login` (browser OAuth) so the user can refresh expired
/// credentials without leaving the app. Fire-and-forget; the user clicks ↻ after.
#[tauri::command]
pub async fn gce_iap_run_auth_login() -> Result<(), String> {
    iap_tunnel::run_auth_login().await
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

/// Start a stopped GCE instance, tracked to completion in the backend.
///
/// Returns as soon as the action is registered — it does NOT block on gcloud.
/// Every status transition, the final resting status, and any failure arrive as
/// `gcp-vm-action` events, and each transition is written into the discovery
/// cache and persisted. Because the tracker outlives the pane, a Start survives
/// the New Session dialog being closed. An `Err` here means the action was never
/// registered (invalid identifiers, or one already in flight for this VM).
#[tauri::command]
pub async fn gce_iap_start_instance(
    state: tauri::State<'_, Arc<GcloudCacheState>>,
    app: tauri::AppHandle,
    project: String,
    zone: String,
    instance: String,
) -> Result<(), String> {
    state
        .inner()
        .clone()
        .run_vm_action(app, project, zone, instance, VmAction::Starting)
        .await
}

/// Stop a running GCE instance. Same tracking contract as
/// [`gce_iap_start_instance`].
#[tauri::command]
pub async fn gce_iap_stop_instance(
    state: tauri::State<'_, Arc<GcloudCacheState>>,
    app: tauri::AppHandle,
    project: String,
    zone: String,
    instance: String,
) -> Result<(), String> {
    state
        .inner()
        .clone()
        .run_vm_action(app, project, zone, instance, VmAction::Stopping)
        .await
}

/// Every Start/Stop currently in flight. The GCP pane calls this on mount to
/// rehydrate actions that were started before it was mounted — without it, a
/// Start issued and then "abandoned" by closing the dialog would render as a
/// stale idle row until the tracker's final event happened to land.
#[tauri::command]
pub fn gce_iap_list_vm_actions(
    state: tauri::State<'_, Arc<GcloudCacheState>>,
) -> Result<Vec<VmActionState>, String> {
    Ok(state.vm_actions())
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
    fn vm_action_state_serializes_camel_case_with_lowercase_action() {
        let s = VmActionState {
            project: "proj-a".into(),
            zone: "us-central1-a".into(),
            instance: "vm-1".into(),
            action: Some(VmAction::Starting),
            status: "PROVISIONING".into(),
            error: None,
        };
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["project"], "proj-a");
        assert_eq!(json["instance"], "vm-1");
        assert_eq!(json["status"], "PROVISIONING");
        // The frontend discriminates on this exact lowercase spelling.
        assert_eq!(json["action"], "starting");
        // `error` is None → omitted, so the TS `error?: string` stays accurate.
        assert!(json.get("error").is_none());
    }

    #[test]
    fn vm_action_state_final_event_carries_null_action_and_error() {
        let s = VmActionState {
            project: "proj-a".into(),
            zone: "us-central1-a".into(),
            instance: "vm-1".into(),
            // The settled event: the frontend keys "action finished" off this
            // being explicitly null, so it must serialize rather than vanish.
            action: None,
            status: "TERMINATED".into(),
            error: Some("permission denied".into()),
        };
        let json = serde_json::to_value(&s).unwrap();
        assert!(json["action"].is_null());
        assert_eq!(json["status"], "TERMINATED");
        assert_eq!(json["error"], "permission denied");
    }

    #[test]
    fn vm_action_stopping_serializes_lowercase() {
        assert_eq!(
            serde_json::to_value(VmAction::Stopping).unwrap(),
            serde_json::json!("stopping")
        );
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
