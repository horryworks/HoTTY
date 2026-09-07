//! Tauri commands for the NetBox integration.
//!
//! Every command validates its parameters **at the edge**, before any I/O: a
//! bad value that only fails during the next sync fails in a place the user is
//! not looking.

use tauri::State;

use crate::services::netbox::client::{
    validate_token, NetboxClient, NetboxProbeResult, NetboxSnapshot, SiteIdCustomField,
    SiteIdFieldChoices,
};
use crate::services::netbox::site_id::SiteIdField;
use crate::services::netbox::url::validate_base_url;
use crate::services::netbox::{NetboxError, NetboxState, DEFAULT_SERVER_KEY};

/// Validate the two inputs a sync needs, in one place, before anything is sent.
fn validated_inputs(
    base_url: &str,
    site_id_field: Option<&str>,
) -> Result<(String, Option<SiteIdField>), NetboxError> {
    let base = validate_base_url(base_url)?;
    let field = match site_id_field {
        Some(raw) => SiteIdField::parse(raw)?,
        None => None,
    };
    Ok((base, field))
}

/// Probe, and — only when the token was accepted — list the custom fields that
/// could hold a site code.
///
/// The listing is attempted only once authenticated: a 403 on the definitions
/// has two meanings, and asking after a refused token would make "not readable"
/// the answer for a server whose real problem is the token.
async fn probe_and_list(client: &NetboxClient<'_>) -> Result<NetboxProbeResult, NetboxError> {
    let probe = client.probe().await?;
    let site_id_fields = if probe.authenticated {
        let defs = client.site_custom_fields().await?;
        Some(SiteIdFieldChoices {
            custom_fields_readable: defs.is_some(),
            custom_fields: defs
                .unwrap_or_default()
                .into_iter()
                .map(|d| SiteIdCustomField {
                    value: d.stored_value(),
                    label: d.display_label(),
                })
                .collect(),
            built_ins: SiteIdField::BUILT_INS
                .iter()
                .map(|s| s.to_string())
                .collect(),
        })
    } else {
        None
    };
    Ok(NetboxProbeResult {
        reachable: probe.reachable,
        authenticated: probe.authenticated,
        api_version: probe.api_version,
        netbox_version: probe.netbox_version,
        http_status: probe.http_status,
        site_id_fields,
    })
}

/// Validate, probe, and save the token only if NetBox accepted it.
///
/// One button, one call: separating "test" from "save" invites a state where
/// the user tested one token and saved another. A refused token is a normal
/// result here, not an error — the caller needs to see *which* field is wrong.
#[tauri::command]
pub async fn netbox_connect(
    state: State<'_, NetboxState>,
    base_url: String,
    token: String,
) -> Result<NetboxProbeResult, String> {
    let base = validate_base_url(&base_url).map_err(|e| e.to_string())?;
    // The single trim: what we probe with is exactly what we save.
    let token = validate_token(&token).map_err(|e| e.to_string())?;

    let client = NetboxClient::new(state.http(), base.clone(), token.clone());
    let result = probe_and_list(&client).await.map_err(|e| e.to_string())?;

    if result.authenticated {
        // The URL is saved with the token: a token issued by one NetBox must
        // never be sent to another, and `base_url` arrives as a parameter on
        // every later call. See `NetboxState::token_for`.
        if let Err(e) = state.save_credentials(&base, &token) {
            // Mirrors the AI providers: the connection is good for this
            // session; only persistence failed, and saying so is more useful
            // than refusing a working connection.
            log::error!(
                "[netbox] Failed to persist the API token: {e} — the connection works for this \
                 session but the token will not survive a restart"
            );
        }
    }
    Ok(result)
}

/// Re-probe using the **saved** token — for reopening Settings after a restart,
/// and for "Refresh field list". The renderer never holds the token, so this is
/// the only way to re-ask.
#[tauri::command]
pub async fn netbox_probe(
    state: State<'_, NetboxState>,
    base_url: String,
) -> Result<NetboxProbeResult, String> {
    let base = validate_base_url(&base_url).map_err(|e| e.to_string())?;
    // Not `state.token()`: the saved token is released only for the address it
    // was issued for, so a caller cannot name a host and be handed the token.
    let token = state.token_for(&base).map_err(|e| e.to_string())?;
    let client = NetboxClient::new(state.http(), base, token);
    probe_and_list(&client).await.map_err(|e| e.to_string())
}

/// Forget the token.
///
/// The folders it created **stay**: disconnecting an integration must never
/// restructure the user's tree. They simply stop being updated.
#[tauri::command]
pub async fn netbox_disconnect(state: State<'_, NetboxState>) -> Result<(), String> {
    state.clear_token();
    Ok(())
}

/// Whether a token is saved, so Settings can show "Connected" after a restart
/// without re-asking. Never returns the token itself.
#[tauri::command]
pub async fn netbox_has_token(state: State<'_, NetboxState>) -> Result<bool, String> {
    Ok(state.has_token())
}

/// Fetch the Regions and Sites one sync needs.
#[tauri::command]
pub async fn netbox_fetch_snapshot(
    state: State<'_, NetboxState>,
    base_url: String,
    site_id_field: Option<String>,
) -> Result<NetboxSnapshot, String> {
    let (base, field) =
        validated_inputs(&base_url, site_id_field.as_deref()).map_err(|e| e.to_string())?;
    let token = state.token_for(&base).map_err(|e| e.to_string())?;
    let client = NetboxClient::new(state.http(), base, token);
    client
        .snapshot(DEFAULT_SERVER_KEY, field.as_ref())
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_malformed_url_is_refused_before_anything_is_sent() {
        assert!(matches!(
            validated_inputs("not a url", None),
            Err(NetboxError::UrlMalformed)
        ));
        assert!(matches!(
            validated_inputs("ftp://netbox.example.com", None),
            Err(NetboxError::UrlScheme)
        ));
        assert!(matches!(
            validated_inputs("", None),
            Err(NetboxError::UrlEmpty)
        ));
    }

    #[test]
    fn a_bad_site_id_field_is_refused_at_the_edge() {
        // Not an hour later, in a sync the user is not watching.
        assert!(matches!(
            validated_inputs("https://netbox.example.com", Some("cf:bad-key")),
            Err(NetboxError::SiteIdField)
        ));
    }

    #[test]
    fn the_url_is_normalized_and_the_field_parsed_together() {
        let (base, field) = validated_inputs(
            "https://netbox.example.com/dcim/sites/?q=x",
            Some("cf:site_code"),
        )
        .unwrap();
        assert_eq!(base, "https://netbox.example.com");
        assert_eq!(field.unwrap().as_stored(), "cf:site_code");
    }

    #[test]
    fn an_absent_or_empty_site_id_field_means_no_prefix() {
        assert!(validated_inputs("https://netbox.example.com", None)
            .unwrap()
            .1
            .is_none());
        assert!(validated_inputs("https://netbox.example.com", Some(""))
            .unwrap()
            .1
            .is_none());
    }

    #[test]
    fn no_error_message_can_carry_the_token() {
        // Every variant's text is a fixed string or an already-sanitized
        // message; none of them formats a credential.
        for e in [
            NetboxError::UrlEmpty,
            NetboxError::UrlTooLong,
            NetboxError::UrlMalformed,
            NetboxError::UrlScheme,
            NetboxError::UrlNoHost,
            NetboxError::TokenEmpty,
            NetboxError::TokenTooLong,
            NetboxError::SiteIdField,
            NetboxError::NoToken,
            NetboxError::Decode,
            NetboxError::TooManyPages(40),
            NetboxError::TooLarge,
        ] {
            let msg = e.to_string();
            assert!(!msg.is_empty());
            assert!(!msg.to_lowercase().contains("authorization"));
        }
    }
}
