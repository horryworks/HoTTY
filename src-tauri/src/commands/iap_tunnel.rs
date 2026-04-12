use crate::services::iap_tunnel::{
    self, GceInstance, GcloudAuthStatus, GcloudStatus, GcpProject,
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
