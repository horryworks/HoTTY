//! The NetBox HTTP client: read-only, paged, and pinned to one validated host.

use std::collections::BTreeMap;

use futures::StreamExt;
use reqwest::header::{ACCEPT, AUTHORIZATION};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::services::ai::errors::{describe_http_error, describe_transport_error};

use super::site_id::{CustomFieldDef, SiteIdField};
use super::url::relative_target;
use super::NetboxError;

/// NetBox's maximum page size.
const PAGE_LIMIT: u32 = 250;
/// 250 x 40 = 10,000 objects. HoTTY is a terminal client; a NetBox with more
/// sites than that is out of scope, and a low cap is a cheap runaway guard.
const MAX_PAGES: u32 = 40;
const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
const MAX_TOKEN_LEN: usize = 512;

const STATUS_PATH: &str = "/api/status/";
const REGIONS_PATH: &str = "/api/dcim/regions/";
const SITES_PATH: &str = "/api/dcim/sites/";
const CUSTOM_FIELDS_PATH: &str = "/api/extras/custom-fields/";

/// Shown when a transport failure looks like a certificate problem. HoTTY has
/// no "skip verification" option and will not grow one; the fix is to trust the
/// CA at the machine level, where every other app benefits too.
const CERT_HINT: &str = "Could not establish a secure connection to NetBox. HoTTY trusts \
certificates from the Windows certificate store. If your NetBox uses a certificate issued by \
your organisation's internal CA, install that CA certificate into Trusted Root Certification \
Authorities for this machine, then try again. HoTTY does not offer an option to skip \
certificate verification.";

// ---------------------------------------------------------------------------
// Raw NetBox shapes
// ---------------------------------------------------------------------------

/// NetBox serializes a foreign key as a nested object; only the id matters here.
#[derive(Debug, Clone, Deserialize)]
pub struct NestedRef {
    pub id: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawRegion {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub parent: Option<NestedRef>,
    /// NetBox's own MPTT depth. Used to insert parents before children.
    #[serde(default, rename = "_depth")]
    pub depth: i32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawSite {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub region: Option<NestedRef>,
    #[serde(default, deserialize_with = "null_as_empty")]
    pub slug: String,
    #[serde(default, deserialize_with = "null_as_empty")]
    pub facility: String,
    #[serde(default, deserialize_with = "null_as_empty")]
    pub description: String,
    #[serde(default)]
    pub custom_fields: BTreeMap<String, serde_json::Value>,
}

/// NetBox sends `null` (not an absent key) for an unset text field, which a
/// bare `String` cannot take.
fn null_as_empty<'de, D>(d: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Option::<String>::deserialize(d)?.unwrap_or_default())
}

#[derive(Debug, Deserialize)]
struct Page<T> {
    #[serde(default)]
    next: Option<String>,
    #[serde(default = "Vec::new")]
    results: Vec<T>,
}

// ---------------------------------------------------------------------------
// Wire types (frontend-facing)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteIdCustomField {
    /// Stored verbatim as the setting, e.g. `cf:site_code`.
    pub value: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteIdFieldChoices {
    /// 🚨 `false` means the token MAY NOT READ the custom-field definitions.
    /// It does NOT mean "there are none" — collapsing the two would tell a user
    /// their NetBox defines no custom fields, and they would never look for the
    /// type-it-in box.
    pub custom_fields_readable: bool,
    pub custom_fields: Vec<SiteIdCustomField>,
    pub built_ins: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetboxProbeResult {
    pub reachable: bool,
    pub authenticated: bool,
    pub api_version: Option<String>,
    pub netbox_version: Option<String>,
    pub http_status: Option<u16>,
    pub site_id_fields: Option<SiteIdFieldChoices>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetboxRegionDto {
    pub id: i64,
    pub name: String,
    pub parent_id: Option<i64>,
    pub depth: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetboxSiteDto {
    pub id: i64,
    pub name: String,
    pub region_id: Option<i64>,
    pub site_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetboxSnapshot {
    pub server_key: String,
    /// Echoed back so the reconcile reports "no Site ID" only when one was
    /// actually asked for.
    pub site_id_field: Option<String>,
    pub regions: Vec<NetboxRegionDto>,
    pub sites: Vec<NetboxSiteDto>,
}

/// What `/api/status/` told us.
#[derive(Debug, Clone)]
pub struct Probe {
    pub reachable: bool,
    pub authenticated: bool,
    pub api_version: Option<String>,
    pub netbox_version: Option<String>,
    pub http_status: Option<u16>,
}

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

/// Trim and check a pasted API token.
///
/// **The only place a token is trimmed.** Yagra had three call sites that
/// disagreed: a token pasted with a trailing newline was sealed with the
/// newline, and every later sync failed with "NetBox refused the API token" —
/// a message that sends the user to check a token that looks, and is, correct.
/// Whatever this returns is both what we probe with and what we save.
pub fn validate_token(raw: &str) -> Result<Zeroizing<String>, NetboxError> {
    let t = raw.trim();
    if t.is_empty() {
        return Err(NetboxError::TokenEmpty);
    }
    if t.len() > MAX_TOKEN_LEN {
        return Err(NetboxError::TokenTooLong);
    }
    // A control character cannot go into a header value. Refusing it here gives
    // a clear message instead of an opaque request-build failure — and instead
    // of "a token is required", which would send the user to look at a box that
    // is not empty.
    if t.chars().any(|c| c.is_ascii_control() || !c.is_ascii()) {
        return Err(NetboxError::TokenInvalidChars);
    }
    Ok(Zeroizing::new(t.to_string()))
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/// No `#[derive(Debug)]`: it holds the API token.
pub struct NetboxClient<'a> {
    http: &'a reqwest::Client,
    base: String,
    token: Zeroizing<String>,
}

/// The first page of a listing. Split out so a test can assert what we ask for.
pub fn first_page_target(path: &str) -> String {
    // 🚨 Never `?brief=1`. The brief serializer drops `parent`, `custom_fields`
    // and `scope` while KEEPING `_depth` — so the ordering still looks right
    // while every folder silently lands at the root.
    format!("{path}?limit={PAGE_LIMIT}")
}

impl<'a> NetboxClient<'a> {
    /// `base` must already have been through `url::validate_base_url`.
    pub fn new(http: &'a reqwest::Client, base: String, token: Zeroizing<String>) -> Self {
        Self { http, base, token }
    }

    /// The only request builder in this module, so "read-only" is one line
    /// rather than a convention.
    fn get(&self, path_and_query: &str) -> reqwest::RequestBuilder {
        self.http
            .get(format!("{}{}", self.base, path_and_query))
            // ⚠️ NetBox's scheme is `Token <t>`, NOT `Bearer <t>`.
            .header(AUTHORIZATION, format!("Token {}", &*self.token))
            .header(ACCEPT, "application/json")
            .timeout(REQUEST_TIMEOUT)
    }

    /// Ask `/api/status/` who is there.
    ///
    /// Reads the `API-Version` **response header**, which NetBox sends on every
    /// API response including the unauthenticated 403. That is what separates
    /// "wrong address / not a NetBox" from "right address, wrong token"; a bare
    /// 403 cannot tell them apart, and guessing sends the user to edit the
    /// field that was already correct.
    pub async fn probe(&self) -> Result<Probe, NetboxError> {
        let resp = self.get(STATUS_PATH).send().await.map_err(transport_error)?;
        let status = resp.status();
        // Read the header before the body is consumed.
        let api_version = resp
            .headers()
            .get("API-Version")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        if status.as_u16() == 401 || status.as_u16() == 403 {
            return Ok(Probe {
                reachable: api_version.is_some(),
                authenticated: false,
                api_version,
                netbox_version: None,
                http_status: Some(status.as_u16()),
            });
        }
        if !status.is_success() {
            let body = read_capped_text(resp).await;
            return Err(NetboxError::Http(describe_http_error(
                "NetBox",
                status.as_u16(),
                &body,
            )));
        }

        let bytes = read_capped(resp).await?;
        let value: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(|_| NetboxError::Decode)?;
        let netbox_version = value
            .get("netbox-version")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        Ok(Probe {
            reachable: true,
            authenticated: true,
            api_version,
            netbox_version,
            http_status: Some(status.as_u16()),
        })
    }

    /// Regions, sorted by (depth, id) so a parent always precedes its children.
    pub async fn regions(&self) -> Result<Vec<RawRegion>, NetboxError> {
        let mut rows: Vec<RawRegion> = self.fetch_all(REGIONS_PATH).await?;
        rows.sort_by(|a, b| a.depth.cmp(&b.depth).then_with(|| a.id.cmp(&b.id)));
        Ok(rows)
    }

    pub async fn sites(&self) -> Result<Vec<RawSite>, NetboxError> {
        self.fetch_all(SITES_PATH).await
    }

    /// Custom-field **definitions** that could hold a site code.
    ///
    /// Fetched **unfiltered on purpose**: NetBox 4.x narrows by
    /// `?object_type=dcim.site` and 3.x by `?content_types=…`, and passing the
    /// wrong one is not an error — it is silently *no filter at all*. Fetch
    /// everything and narrow here, where both spellings can be read.
    ///
    /// `Ok(None)` = the token may not read them. `Ok(Some(vec![]))` = there
    /// genuinely are none. These must stay distinguishable.
    pub async fn site_custom_fields(&self) -> Result<Option<Vec<CustomFieldDef>>, NetboxError> {
        let Some(rows) = self
            .fetch_pages::<CustomFieldDef>(CUSTOM_FIELDS_PATH, true)
            .await?
        else {
            return Ok(None);
        };
        Ok(Some(
            rows.into_iter()
                .filter(|d| d.applies_to_site() && d.is_scalar())
                .collect(),
        ))
    }

    /// Everything one sync needs, flattened for the frontend reconcile.
    pub async fn snapshot(
        &self,
        server_key: &str,
        field: Option<&SiteIdField>,
    ) -> Result<NetboxSnapshot, NetboxError> {
        let regions = self.regions().await?;
        let sites = self.sites().await?;
        Ok(NetboxSnapshot {
            server_key: server_key.to_string(),
            site_id_field: field.map(|f| f.as_stored()),
            regions: regions
                .into_iter()
                .map(|r| NetboxRegionDto {
                    id: r.id,
                    name: r.name,
                    parent_id: r.parent.map(|p| p.id),
                    depth: r.depth,
                })
                .collect(),
            sites: sites
                .into_iter()
                .map(|s| NetboxSiteDto {
                    id: s.id,
                    region_id: s.region.as_ref().map(|r| r.id),
                    site_id: field.and_then(|f| f.value_of(&s)),
                    name: s.name,
                })
                .collect(),
        })
    }

    async fn fetch_all<T: DeserializeOwned>(&self, path: &str) -> Result<Vec<T>, NetboxError> {
        Ok(self.fetch_pages(path, false).await?.unwrap_or_default())
    }

    /// Walk a paginated listing.
    ///
    /// With `tolerate_denied`, a 403/404 on the first page is an answer rather
    /// than an error — a missing object permission must not kill the whole sync.
    async fn fetch_pages<T: DeserializeOwned>(
        &self,
        path: &str,
        tolerate_denied: bool,
    ) -> Result<Option<Vec<T>>, NetboxError> {
        let mut target = first_page_target(path);
        let mut out: Vec<T> = Vec::new();
        for page in 0..MAX_PAGES {
            let resp = self.get(&target).send().await.map_err(transport_error)?;
            let status = resp.status();
            if !status.is_success() {
                if tolerate_denied
                    && page == 0
                    && matches!(status.as_u16(), 401 | 403 | 404)
                {
                    return Ok(None);
                }
                let body = read_capped_text(resp).await;
                return Err(NetboxError::Http(describe_http_error(
                    "NetBox",
                    status.as_u16(),
                    &body,
                )));
            }
            let bytes = read_capped(resp).await?;
            let parsed: Page<T> =
                serde_json::from_slice(&bytes).map_err(|_| NetboxError::Decode)?;
            out.extend(parsed.results);
            match parsed.next.as_deref().map(str::trim) {
                Some(next) if !next.is_empty() => {
                    // Strip the host NetBox put on the link — see `relative_target`.
                    target = relative_target(next)?;
                }
                _ => return Ok(Some(out)),
            }
        }
        Err(NetboxError::TooManyPages(MAX_PAGES))
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Read a response body with a hard size cap. `resp.json()` would buffer an
/// unbounded body; this refuses one instead.
async fn read_capped(resp: reqwest::Response) -> Result<Vec<u8>, NetboxError> {
    if let Some(len) = resp.content_length() {
        if len > MAX_RESPONSE_BYTES as u64 {
            return Err(NetboxError::TooLarge);
        }
    }
    let mut out: Vec<u8> = Vec::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| NetboxError::Decode)?;
        if out.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err(NetboxError::TooLarge);
        }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}

/// An error body, for `describe_http_error` to sanitize and cap further.
async fn read_capped_text(resp: reqwest::Response) -> String {
    match read_capped(resp).await {
        Ok(bytes) => String::from_utf8_lossy(&bytes).chars().take(2000).collect(),
        Err(_) => String::new(),
    }
}

/// Classify a transport failure. A certificate problem gets a specific,
/// actionable message; everything else falls back to the generic one. A false
/// negative costs a less specific message and never a wrong one.
fn transport_error(e: reqwest::Error) -> NetboxError {
    if looks_like_certificate_error(&e) {
        NetboxError::Transport(CERT_HINT.to_string())
    } else {
        NetboxError::Transport(describe_transport_error("NetBox"))
    }
}

fn looks_like_certificate_error(e: &reqwest::Error) -> bool {
    let mut text = String::new();
    let mut source: Option<&(dyn std::error::Error + 'static)> = Some(e);
    while let Some(err) = source {
        text.push_str(&err.to_string().to_ascii_lowercase());
        text.push(' ');
        source = err.source();
    }
    const MARKERS: [&str; 7] = [
        "certificate",
        "cert_",
        "unknown ca",
        "self signed",
        "self-signed",
        "untrusted",
        // SEC_E_UNTRUSTED_ROOT, as SChannel reports it.
        "-2146893019",
    ];
    MARKERS.iter().any(|m| text.contains(m))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_listing_asks_for_full_objects_never_brief() {
        // `brief` would drop `parent` and `custom_fields` while keeping
        // `_depth` — the tree would look correctly ordered and be entirely flat.
        for path in [REGIONS_PATH, SITES_PATH, CUSTOM_FIELDS_PATH, STATUS_PATH] {
            let target = first_page_target(path);
            assert!(!target.contains("brief"), "brief leaked into {target}");
        }
    }

    #[test]
    fn a_listing_asks_for_the_maximum_page_size() {
        assert_eq!(
            first_page_target(SITES_PATH),
            "/api/dcim/sites/?limit=250"
        );
    }

    #[test]
    fn the_endpoints_are_the_ones_netbox_serves() {
        assert_eq!(REGIONS_PATH, "/api/dcim/regions/");
        assert_eq!(SITES_PATH, "/api/dcim/sites/");
        assert_eq!(CUSTOM_FIELDS_PATH, "/api/extras/custom-fields/");
        assert_eq!(STATUS_PATH, "/api/status/");
    }

    #[test]
    fn a_page_deserializes_with_a_null_next() {
        let json = r#"{"count":1,"next":null,"previous":null,
                       "results":[{"id":1,"name":"Asia","_depth":0}]}"#;
        let page: Page<RawRegion> = serde_json::from_str(json).unwrap();
        assert!(page.next.is_none());
        assert_eq!(page.results.len(), 1);
        assert_eq!(page.results[0].depth, 0);
    }

    #[test]
    fn a_page_deserializes_with_a_next_link() {
        let json = r#"{"count":300,
                       "next":"https://netbox.example.com/api/dcim/sites/?limit=250&offset=250",
                       "results":[]}"#;
        let page: Page<RawSite> = serde_json::from_str(json).unwrap();
        assert_eq!(
            relative_target(page.next.as_deref().unwrap()).unwrap(),
            "/api/dcim/sites/?limit=250&offset=250"
        );
    }

    #[test]
    fn a_region_reads_its_parent_and_depth() {
        let json = r#"{"id":2,"name":"Japan","parent":{"id":1,"name":"Asia"},"_depth":1}"#;
        let r: RawRegion = serde_json::from_str(json).unwrap();
        assert_eq!(r.parent.unwrap().id, 1);
        assert_eq!(r.depth, 1);
    }

    #[test]
    fn a_site_survives_null_text_fields() {
        // NetBox sends null, not an absent key, for an unset text field.
        let json = r#"{"id":10,"name":"Example Site","region":null,
                       "slug":"site-01","facility":null,"description":null}"#;
        let s: RawSite = serde_json::from_str(json).unwrap();
        assert_eq!(s.slug, "site-01");
        assert_eq!(s.facility, "");
        assert_eq!(s.description, "");
        assert!(s.region.is_none());
        assert!(s.custom_fields.is_empty());
    }

    #[test]
    fn a_site_keeps_custom_fields_verbatim() {
        let json = r#"{"id":10,"name":"Example Site",
                       "custom_fields":{"site_code":"SITE-01","other":null}}"#;
        let s: RawSite = serde_json::from_str(json).unwrap();
        assert_eq!(
            s.custom_fields.get("site_code").unwrap().as_str().unwrap(),
            "SITE-01"
        );
    }

    #[test]
    fn regions_are_ordered_parents_before_children() {
        let mut rows = [
            RawRegion { id: 3, name: "Kanto".into(), parent: None, depth: 2 },
            RawRegion { id: 1, name: "Asia".into(), parent: None, depth: 0 },
            RawRegion { id: 5, name: "Japan".into(), parent: None, depth: 1 },
            RawRegion { id: 2, name: "Europe".into(), parent: None, depth: 0 },
        ];
        rows.sort_by(|a, b| a.depth.cmp(&b.depth).then_with(|| a.id.cmp(&b.id)));
        let ids: Vec<i64> = rows.iter().map(|r| r.id).collect();
        assert_eq!(ids, vec![1, 2, 5, 3]);
    }

    #[test]
    fn the_probed_token_is_the_saved_token() {
        // Pins Yagra's newline bug: whatever `validate_token` returns is both
        // what we authenticate with and what we seal to disk.
        let pasted = "  0123456789abcdef0123456789abcdef01234567\n";
        let probed = validate_token(pasted).unwrap();
        let saved = validate_token(pasted).unwrap();
        assert_eq!(&*probed, &*saved);
        assert_eq!(&*probed, "0123456789abcdef0123456789abcdef01234567");
        assert!(!probed.contains('\n'));
    }

    #[test]
    fn rejects_an_empty_or_over_long_token() {
        assert!(matches!(validate_token(""), Err(NetboxError::TokenEmpty)));
        assert!(matches!(validate_token("   \n"), Err(NetboxError::TokenEmpty)));
        let long = "a".repeat(MAX_TOKEN_LEN + 1);
        assert!(matches!(validate_token(&long), Err(NetboxError::TokenTooLong)));
    }

    #[test]
    fn rejects_a_token_with_characters_a_header_cannot_carry() {
        // Not TokenEmpty: the box is not empty, and saying it is would send
        // the user to look at the wrong thing.
        assert!(matches!(
            validate_token("abc\rdef"),
            Err(NetboxError::TokenInvalidChars)
        ));
        assert!(matches!(
            validate_token("abc\u{00e9}def"),
            Err(NetboxError::TokenInvalidChars)
        ));
    }

    #[test]
    fn the_certificate_hint_never_suggests_skipping_verification() {
        assert!(CERT_HINT.contains("Trusted Root"));
        assert!(CERT_HINT.contains("does not offer an option to skip"));
    }
}
