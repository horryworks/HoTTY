//! In-app version switching: list this project's GitHub releases, download the
//! installer for a chosen release, verify it against GitHub's published
//! SHA-256, and hand it to NSIS.
//!
//! Why this is hand-rolled rather than `tauri-plugin-updater`: HoTTY releases
//! carry no minisign `.sig` artifacts, and the ones already published never
//! will, so the plugin's signature model cannot cover the back catalogue. The
//! plugin also only ever moves forward, so it cannot install an older version at
//! all. GitHub's per-asset `digest` field gives an equivalent integrity check
//! for every release already out there, and keeping the HTTP, the file write and
//! the process spawn on this side means the Tauri capability set and the CSP
//! stay as narrow as they are today.
//!
//! Two invariants worth stating up front, because the rest of the module is
//! shaped around them:
//!
//! 1. **The renderer never sees a download URL.** It picks a `tag`; this module
//!    resolves that tag against the release list it fetched itself. See
//!    [`resolve_asset`].
//! 2. **The installer is spawned after the app has shut down, not before.**
//!    NSIS runs `CheckIfAppIsRunning` early, and under `/P` that kills
//!    `hotty.exe` outright with no prompt (`utils.nsh` line 41: the MessageBox
//!    is skipped when `$PassiveMode = 1`). Being killed mid-shutdown could cost
//!    the Host Tree, which lives in WebView2 localStorage. So the verified path
//!    is parked in [`UpdaterState::set_pending`] and launched from
//!    `RunEvent::Exit`, by which point every window and webview is gone.

use futures::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Emitter};
use tokio_util::sync::CancellationToken;

use super::atomic_file::atomic_write;
use super::sensitive_env::is_sensitive_env_var;

/// Release list endpoint. Deliberately NOT `/releases/latest`: that endpoint
/// filters out pre-releases server-side, so a user running a `-betaN` build
/// would never be told about anything, ever.
const RELEASES_URL: &str = "https://api.github.com/repos/horryworks/HoTTY/releases?per_page=30";

/// Every installer download must start with this. A tag is resolved against the
/// fetched list rather than trusted from the renderer; this is the second fence,
/// in case a GitHub response ever carries an off-site asset URL.
const DOWNLOAD_URL_PREFIX: &str = "https://github.com/horryworks/HoTTY/releases/download/";

/// How long a fetched release list stays usable. Unauthenticated GitHub allows
/// 60 requests/hour/IP; opening the version modal repeatedly across several
/// windows would otherwise burn through that.
const CACHE_TTL: Duration = Duration::from_secs(600);

/// Subdirectory under the OS temp dir where downloaded installers live.
///
/// NOT the app data dir: `path_safety::is_sensitive_path` blocks
/// `%LOCALAPPDATA%\com.hotty.terminal`, so writing there would fight an existing
/// guard. `%LOCALAPPDATA%\Temp` is not on that block list.
const IMAGE_DIR_NAME: &str = "hotty-update";

/// Sanity cap on a download. The real installer is ~6.5 MiB; this exists so a
/// malformed or hostile `Content-Length` cannot make us buffer unboundedly.
const MAX_IMAGE_BYTES: u64 = 64 * 1024 * 1024;

/// Minimum gap between progress events, so a fast download does not flood the
/// renderer with one event per chunk.
const PROGRESS_INTERVAL: Duration = Duration::from_millis(150);

/// Redirect hops allowed while fetching an asset. GitHub bounces release
/// downloads to its object storage, so some redirection is required.
const MAX_REDIRECTS: usize = 5;

const HTTP_TIMEOUT: Duration = Duration::from_secs(15);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(600);

/// Flags handed to the NSIS installer. Order is fixed only so that an accidental
/// edit shows up as a test failure; `GetOptions` itself parses them unordered.
///
/// * `/UPDATE` — never uninstall first, in either direction. This is what makes
///   a downgrade safe: uninstalling would take the Host Tree with it, since that
///   lives in WebView2 localStorage (`installer.nsi` lines 265-270 spell this
///   out as a deliberate HoTTY change to the stock template).
/// * `/P` — passive: progress only, no pages, closes itself.
/// * `/R` — relaunch `hotty.exe` when the install finishes.
pub const INSTALLER_ARGS: [&str; 3] = ["/UPDATE", "/P", "/R"];

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum UpdaterError {
    #[error("http client: {0}")]
    Client(String),
    #[error("request failed: {0}")]
    Request(String),
    #[error("github returned status {0}")]
    Status(u16),
    #[error("github rate limit reached; try again later")]
    RateLimited,
    #[error("parse release json: {0}")]
    Parse(String),
    #[error("invalid release tag")]
    InvalidTag,
    #[error("unknown release tag: {0}")]
    UnknownTag(String),
    #[error("this release has no verifiable installer")]
    NotInstallable,
    #[error("download url not allowed")]
    UrlNotAllowed,
    #[error("download is larger than expected")]
    TooLarge,
    #[error("checksum mismatch - the download was discarded")]
    ChecksumMismatch,
    #[error("cancelled")]
    Cancelled,
    #[error("a version switch is already running")]
    Busy,
    #[error("io: {0}")]
    Io(String),
    #[error("could not start the installer: {0}")]
    Launch(String),
}

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    name: Option<String>,
    html_url: String,
    prerelease: bool,
    #[serde(default)]
    draft: bool,
    body: Option<String>,
    #[serde(default)]
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    #[serde(default)]
    size: u64,
    browser_download_url: String,
    /// `"sha256:<64 hex>"`. Present on every HoTTY release asset published so
    /// far, including the old betas, but typed optional because it is GitHub's
    /// field and not ours to guarantee.
    #[serde(default)]
    digest: Option<String>,
}

/// One release as handed to the renderer.
///
/// Note what is absent: the download URL. The renderer picks by `tag` and the
/// backend re-resolves it, so a compromised renderer has no way to point the
/// downloader at a URL of its choosing. That the type has no such field is the
/// enforcement, not a convention.
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseEntry {
    /// Git tag, e.g. `v2.0.18`.
    pub tag: String,
    /// Tag without the leading `v`, e.g. `2.0.18`.
    pub version: String,
    pub name: String,
    pub prerelease: bool,
    /// Release notes, raw markdown. Rendered by the modal.
    pub notes: String,
    pub html_url: String,
    pub asset_name: String,
    pub size: u64,
    /// How this release relates to the running one.
    pub relation: Relation,
    /// False when GitHub published no usable checksum for the asset. Such a
    /// release is still listed (its notes are worth reading) but cannot be
    /// installed: verifying nothing is worse than refusing.
    pub installable: bool,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Relation {
    Current,
    Newer,
    Older,
}

/// What the backend keeps to itself for each entry.
#[derive(Debug, Clone)]
pub struct ResolvedAsset {
    pub download_url: String,
    pub asset_name: String,
    pub size: u64,
    /// Lowercase hex SHA-256. `None` means the entry is not installable.
    pub sha256: Option<String>,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UpdaterPhase {
    Downloading,
    Verifying,
    Launching,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterProgress {
    pub tag: String,
    pub phase: UpdaterPhase,
    pub downloaded: u64,
    /// 0 when the server sent no `Content-Length`.
    pub total: u64,
}

/// Language for the native confirmation dialog.
///
/// The renderer picks the language, never the wording: the strings live in
/// [`dialog_strings`] on this side. A compromised renderer can therefore
/// mistranslate nothing — it can only choose which of our own texts is shown.
/// That keeps ADR-010 ("the renderer cannot fabricate approval") intact while
/// still letting a Japanese UI show a Japanese consent prompt.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DialogLang {
    En,
    Ja,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

struct CachedList {
    fetched_at: Instant,
    entries: Vec<(ReleaseEntry, ResolvedAsset)>,
}

/// Shared updater state. Every field uses `std::sync::Mutex` on purpose:
/// `pending_installer` has to be readable from `RunEvent::Exit`, which is a
/// synchronous context with no async runtime to block on.
#[derive(Default)]
pub struct UpdaterState {
    cache: Mutex<Option<CachedList>>,
    /// Set while a download is in flight, so two windows cannot start one at the
    /// same time. Carries the label of the window that started it, so closing
    /// that window stops the download (ADR-011).
    running: Mutex<Option<(String, CancellationToken)>>,
    /// Verified installer waiting for the app to exit.
    pending_installer: Mutex<Option<PathBuf>>,
}

impl UpdaterState {
    pub fn new() -> Self {
        Self::default()
    }

    fn cached(&self) -> Option<Vec<(ReleaseEntry, ResolvedAsset)>> {
        let guard = self.cache.lock().ok()?;
        let cached = guard.as_ref()?;
        if cached.fetched_at.elapsed() < CACHE_TTL {
            Some(cached.entries.clone())
        } else {
            None
        }
    }

    fn store(&self, entries: Vec<(ReleaseEntry, ResolvedAsset)>) {
        if let Ok(mut guard) = self.cache.lock() {
            *guard = Some(CachedList {
                fetched_at: Instant::now(),
                entries,
            });
        }
    }

    /// Claim the single install slot. Returns the token to watch, or `Busy`.
    fn begin(&self, window_label: &str) -> Result<CancellationToken, UpdaterError> {
        let mut guard = self.running.lock().map_err(|_| UpdaterError::Busy)?;
        if guard.is_some() {
            return Err(UpdaterError::Busy);
        }
        let token = CancellationToken::new();
        *guard = Some((window_label.to_string(), token.clone()));
        Ok(token)
    }

    fn end(&self) {
        if let Ok(mut guard) = self.running.lock() {
            *guard = None;
        }
    }

    /// Cancel an in-flight download, if any.
    pub fn cancel(&self) {
        if let Ok(guard) = self.running.lock() {
            if let Some((_, token)) = guard.as_ref() {
                token.cancel();
            }
        }
    }

    /// Cancel only if the download belongs to `window_label`.
    ///
    /// Called from the window teardown path. Without this, closing the window
    /// that started a switch would leave the download running, and it would
    /// then exit the whole app on the user's behalf from a window they had
    /// already dismissed.
    pub fn cancel_for_window(&self, window_label: &str) {
        if let Ok(guard) = self.running.lock() {
            if let Some((label, token)) = guard.as_ref() {
                if label == window_label {
                    token.cancel();
                }
            }
        }
    }

    fn set_pending(&self, path: PathBuf) {
        if let Ok(mut guard) = self.pending_installer.lock() {
            *guard = Some(path);
        }
    }

    /// Launch the installer parked by a completed [`prepare_install`], if any.
    ///
    /// Call this from `RunEvent::Exit` and nowhere else. At that point the
    /// windows and their webviews are gone, so NSIS killing this process costs
    /// nothing — which is exactly the race this ordering exists to avoid.
    pub fn launch_pending(&self) {
        let Ok(mut guard) = self.pending_installer.lock() else {
            return;
        };
        let Some(path) = guard.take() else {
            return;
        };
        match launch_installer(&path) {
            Ok(()) => log::info!("updater: installer started ({})", path.display()),
            Err(e) => log::error!("updater: {e}"),
        }
    }
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested without touching the network or the filesystem)
// ---------------------------------------------------------------------------

/// Strip a leading `v` / `V` from a tag like `v2.0.1` -> `2.0.1`.
pub fn strip_v_prefix(tag: &str) -> &str {
    tag.strip_prefix('v')
        .or_else(|| tag.strip_prefix('V'))
        .unwrap_or(tag)
}

/// Parse a version string into `(major, minor, patch, prerelease_tag)`.
/// Pre-release (anything after `-`) is returned as the tail string; absent
/// pre-release = `""`. Unparseable components default to 0 so a malformed input
/// is treated as the lowest version.
pub fn parse_version(v: &str) -> (u32, u32, u32, String) {
    let v = strip_v_prefix(v.trim());
    let (core, pre) = match v.split_once('-') {
        Some((c, p)) => (c, p.to_string()),
        None => (v, String::new()),
    };
    let mut parts = core.split('.');
    let major = parts
        .next()
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(0);
    let minor = parts
        .next()
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(0);
    let patch = parts
        .next()
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(0);
    (major, minor, patch, pre)
}

/// Compare two prerelease tags. Falls back to lexicographic, but when both sides
/// decompose into the same alphabetic prefix + numeric suffix the suffix is
/// compared numerically. So "beta10" > "beta9", which a plain string compare
/// would get wrong.
pub fn compare_prerelease(a: &str, b: &str) -> std::cmp::Ordering {
    fn split_alpha_num(s: &str) -> Option<(&str, u64)> {
        let digit_start = s.find(|c: char| c.is_ascii_digit())?;
        if digit_start == 0 {
            return None;
        }
        let (alpha, num_str) = s.split_at(digit_start);
        let num: u64 = num_str.parse().ok()?;
        Some((alpha, num))
    }
    match (split_alpha_num(a), split_alpha_num(b)) {
        (Some((aa, an)), Some((ba, bn))) if aa == ba => an.cmp(&bn),
        _ => a.cmp(b),
    }
}

/// Return true iff `latest` is strictly newer than `current` using semver-ish
/// comparison. A release with no pre-release suffix ranks higher than the same
/// core with a pre-release.
pub fn is_strictly_newer(current: &str, latest: &str) -> bool {
    let (ca, cb, cc, cpre) = parse_version(current);
    let (la, lb, lc, lpre) = parse_version(latest);
    match (la, lb, lc).cmp(&(ca, cb, cc)) {
        std::cmp::Ordering::Greater => true,
        std::cmp::Ordering::Less => false,
        std::cmp::Ordering::Equal => match (cpre.is_empty(), lpre.is_empty()) {
            (false, true) => true,  // current is pre, latest is stable -> newer
            (true, false) => false, // current is stable, latest is pre -> not newer
            (true, true) => false,  // identical stable
            (false, false) => compare_prerelease(&lpre, &cpre).is_gt(),
        },
    }
}

/// How `target` relates to `current`. Downgrade detection needs no new
/// comparator: it is the existing one called the other way round.
pub fn relation_of(current: &str, target: &str) -> Relation {
    if is_strictly_newer(current, target) {
        Relation::Newer
    } else if is_strictly_newer(target, current) {
        Relation::Older
    } else {
        Relation::Current
    }
}

/// Accept only tags shaped like `v2.0.18` or `2.1.0-beta1`.
///
/// This runs before a tag is used for anything at all. Everything downstream
/// (asset name, URL comparison, file name) derives from a tag that passed here,
/// which is what keeps a renderer-supplied string out of path and URL building.
pub fn is_valid_tag(tag: &str) -> bool {
    if tag.is_empty() || tag.len() > 48 {
        return false;
    }
    let s = strip_v_prefix(tag);
    let (core, pre) = match s.split_once('-') {
        Some((c, p)) => (c, Some(p)),
        None => (s, None),
    };

    let mut parts = core.split('.');
    for _ in 0..3 {
        match parts.next() {
            Some(p) if !p.is_empty() && p.len() <= 4 && p.bytes().all(|b| b.is_ascii_digit()) => {}
            _ => return false,
        }
    }
    if parts.next().is_some() {
        return false;
    }

    match pre {
        None => true,
        Some(p) => {
            let Some(digit_start) = p.find(|c: char| c.is_ascii_digit()) else {
                return false;
            };
            if digit_start == 0 || digit_start > 10 {
                return false;
            }
            let (alpha, num) = p.split_at(digit_start);
            alpha.bytes().all(|b| b.is_ascii_lowercase())
                && !num.is_empty()
                && num.len() <= 4
                && num.bytes().all(|b| b.is_ascii_digit())
        }
    }
}

/// The installer asset name the release pipeline produces for a version.
pub fn expected_asset_name(version: &str) -> String {
    format!("HoTTY_{version}_x64-setup.exe")
}

/// `"sha256:ABC..."` -> `Some("abc...")`. Anything that is not exactly 64 hex
/// digits behind a `sha256:` prefix is rejected rather than half-trusted.
pub fn parse_digest(raw: &str) -> Option<String> {
    let hex = raw.strip_prefix("sha256:")?;
    if hex.len() == 64 && hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        Some(hex.to_ascii_lowercase())
    } else {
        None
    }
}

pub fn hex_encode(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        let _ = write!(out, "{b:02x}");
    }
    out
}

/// A download URL must live under this repo's releases. Case-insensitive on the
/// scheme+host, exact on the path, matching `system.rs::is_curated_url`.
pub fn is_allowed_download_url(url: &str) -> bool {
    let split_at = url
        .find("://")
        .and_then(|i| url[i + 3..].find('/').map(|p| i + 3 + p))
        .unwrap_or(url.len());
    let (authority, rest) = url.split_at(split_at);
    let normalized = format!("{}{}", authority.to_ascii_lowercase(), rest);
    normalized.starts_with(DOWNLOAD_URL_PREFIX)
}

/// Hosts a release download may be redirected to. GitHub bounces asset requests
/// to its object storage, so following blindly would mean following anywhere;
/// this pins the set instead.
pub fn is_allowed_redirect(scheme: &str, host: Option<&str>) -> bool {
    if !scheme.eq_ignore_ascii_case("https") {
        return false;
    }
    let Some(host) = host else {
        return false;
    };
    let host = host.to_ascii_lowercase();
    host == "github.com"
        || host == "githubusercontent.com"
        || host.ends_with(".githubusercontent.com")
}

/// A finished installer image we may keep.
pub fn is_update_image_name(name: &str) -> bool {
    name.starts_with("HoTTY_") && name.ends_with("_x64-setup.exe")
}

/// Leftover from an interrupted atomic write (`atomic_file` names its temp
/// `<dest>.tmpN`). Always disposable.
pub fn is_stale_temp_name(name: &str) -> bool {
    name.starts_with("HoTTY_") && name.contains("_x64-setup.exe.tmp")
}

/// Given `(file name, modified time)` pairs, return the names to delete so only
/// the newest image survives. Temps always go.
///
/// Pure on purpose: the retention rule is the part worth testing, and testing it
/// should not need a filesystem.
pub fn images_to_prune(entries: &[(String, SystemTime)]) -> Vec<String> {
    let mut doomed: Vec<String> = entries
        .iter()
        .filter(|(name, _)| is_stale_temp_name(name))
        .map(|(name, _)| name.clone())
        .collect();

    let mut images: Vec<&(String, SystemTime)> = entries
        .iter()
        .filter(|(name, _)| is_update_image_name(name))
        .collect();
    // Newest first; name breaks ties so the result is deterministic.
    images.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    doomed.extend(images.into_iter().skip(1).map(|(name, _)| name.clone()));
    doomed
}

/// Pick the release to advertise in the update toast.
///
/// The channel rule needs no new setting: a pre-release build sees both
/// channels, a stable build sees only stable. That is what fixes the standing
/// bug where a `-betaN` user was never told about anything, because
/// `/releases/latest` omits pre-releases server-side.
pub fn select_latest<'a>(entries: &'a [ReleaseEntry], current: &str) -> Option<&'a ReleaseEntry> {
    let on_prerelease = !parse_version(current).3.is_empty();
    entries
        .iter()
        .filter(|e| e.installable)
        .filter(|e| on_prerelease || !e.prerelease)
        .filter(|e| is_strictly_newer(current, &e.version))
        .max_by(|a, b| {
            if is_strictly_newer(&a.version, &b.version) {
                std::cmp::Ordering::Less
            } else if is_strictly_newer(&b.version, &a.version) {
                std::cmp::Ordering::Greater
            } else {
                std::cmp::Ordering::Equal
            }
        })
}

/// Native confirmation dialog text: (title, body).
///
/// Lives here rather than in the renderer's i18n catalogue on purpose. This is
/// the one prompt the renderer must not be able to word, because it is the point
/// where consent is actually taken (ADR-010).
pub fn dialog_strings(
    lang: DialogLang,
    entry: &ReleaseEntry,
    current: &str,
    sessions: usize,
) -> (String, String) {
    let target = &entry.version;
    match lang {
        DialogLang::Ja => {
            let head = match entry.relation {
                Relation::Older => format!(
                    "HoTTY を v{current} から v{target} に戻します。\n\n\
                     ・ホスト一覧・テーマ・保存した認証情報はそのまま残ります\n\
                     ・v{current} で増えた設定項目は無視されます（消えません）",
                ),
                Relation::Newer => {
                    format!("HoTTY を v{current} から v{target} に更新します。")
                }
                Relation::Current => format!("HoTTY v{target} を入れ直します。"),
            };
            let tail = if sessions > 0 {
                format!(
                    "\n\n開いている接続 {sessions} 本が切断され、すべてのウィンドウが閉じます。\n\
                     完了するとアプリが自動で再起動します。"
                )
            } else {
                "\n\nすべてのウィンドウが閉じます。完了するとアプリが自動で再起動します。"
                    .to_string()
            };
            ("バージョンの切り替え".to_string(), format!("{head}{tail}"))
        }
        DialogLang::En => {
            let head = match entry.relation {
                Relation::Older => format!(
                    "Go back from HoTTY v{current} to v{target}.\n\n\
                     - Your hosts, themes and saved credentials are kept\n\
                     - Settings added in v{current} are ignored, not deleted",
                ),
                Relation::Newer => format!("Update HoTTY from v{current} to v{target}."),
                Relation::Current => format!("Reinstall HoTTY v{target}."),
            };
            let tail = if sessions > 0 {
                format!(
                    "\n\n{sessions} open connection(s) will be disconnected and every window \
                     will close.\nThe app restarts automatically when it is done."
                )
            } else {
                "\n\nEvery window will close. The app restarts automatically when it is done."
                    .to_string()
            };
            ("Switch version".to_string(), format!("{head}{tail}"))
        }
    }
}

// ---------------------------------------------------------------------------
// Release listing
// ---------------------------------------------------------------------------

/// Turn the GitHub payload into (renderer-visible entry, private asset) pairs.
///
/// Drafts, malformed tags and releases with no matching installer asset are
/// dropped: there is nothing to install for those, so listing them would be a
/// dead end. A release whose asset has no usable digest IS kept, marked
/// `installable: false` — its notes are still worth reading.
fn to_entries(
    releases: Vec<GithubRelease>,
    current_version: &str,
) -> Vec<(ReleaseEntry, ResolvedAsset)> {
    releases
        .into_iter()
        .filter(|r| !r.draft && is_valid_tag(&r.tag_name))
        .filter_map(|r| {
            let version = strip_v_prefix(&r.tag_name).to_string();
            let wanted = expected_asset_name(&version);
            let asset = r.assets.into_iter().find(|a| a.name == wanted)?;
            if !is_allowed_download_url(&asset.browser_download_url) {
                return None;
            }
            let sha256 = asset.digest.as_deref().and_then(parse_digest);
            let entry = ReleaseEntry {
                relation: relation_of(current_version, &version),
                tag: r.tag_name.clone(),
                version,
                name: r.name.unwrap_or_else(|| r.tag_name.clone()),
                prerelease: r.prerelease,
                notes: r.body.unwrap_or_default(),
                html_url: r.html_url,
                asset_name: asset.name.clone(),
                size: asset.size,
                installable: sha256.is_some(),
            };
            let resolved = ResolvedAsset {
                download_url: asset.browser_download_url,
                asset_name: asset.name,
                size: asset.size,
                sha256,
            };
            Some((entry, resolved))
        })
        .collect()
}

fn list_client(current_version: &str) -> Result<reqwest::Client, UpdaterError> {
    reqwest::Client::builder()
        .user_agent(format!("HoTTY/{current_version}"))
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(|e| UpdaterError::Client(e.to_string()))
}

/// Fetch (or reuse) the release list. Newest first, as GitHub returns it.
pub async fn fetch_releases(
    state: &UpdaterState,
    current_version: &str,
    force: bool,
) -> Result<Vec<(ReleaseEntry, ResolvedAsset)>, UpdaterError> {
    if !force {
        if let Some(cached) = state.cached() {
            return Ok(cached);
        }
    }

    let client = list_client(current_version)?;
    let resp = client
        .get(RELEASES_URL)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| UpdaterError::Request(e.to_string()))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        // An exhausted quota needs its own message: waiting fixes it, and
        // nothing else will.
        let exhausted = resp
            .headers()
            .get("x-ratelimit-remaining")
            .and_then(|v| v.to_str().ok())
            .map(|v| v.trim() == "0")
            .unwrap_or(false);
        if exhausted || status == 429 {
            return Err(UpdaterError::RateLimited);
        }
        return Err(UpdaterError::Status(status));
    }

    let releases: Vec<GithubRelease> = resp
        .json()
        .await
        .map_err(|e| UpdaterError::Parse(e.to_string()))?;

    let entries = to_entries(releases, current_version);
    state.store(entries.clone());
    Ok(entries)
}

/// Resolve a renderer-supplied tag to the asset the backend fetched for it.
///
/// This is the fence that keeps the renderer from choosing a URL: it hands over
/// a tag, and only a tag that is both well-formed and present in the list this
/// process fetched resolves to anything at all.
pub async fn resolve_asset(
    state: &UpdaterState,
    current_version: &str,
    tag: &str,
) -> Result<(ReleaseEntry, ResolvedAsset), UpdaterError> {
    if !is_valid_tag(tag) {
        return Err(UpdaterError::InvalidTag);
    }
    let entries = fetch_releases(state, current_version, false).await?;
    let found = entries
        .into_iter()
        .find(|(entry, _)| entry.tag == tag)
        .ok_or_else(|| UpdaterError::UnknownTag(tag.to_string()))?;
    if !found.0.installable || found.1.sha256.is_none() {
        return Err(UpdaterError::NotInstallable);
    }
    Ok(found)
}

// ---------------------------------------------------------------------------
// Image directory
// ---------------------------------------------------------------------------

pub fn image_dir() -> PathBuf {
    std::env::temp_dir().join(IMAGE_DIR_NAME)
}

/// Delete every downloaded installer except the newest, plus any leftover temp
/// files. Called on app start and right after a successful download, so at most
/// one ~6.5 MiB image is ever parked on disk.
///
/// Not called after launching an installer: Windows will not delete a running
/// executable, so that image is cleared by the next start instead.
pub fn prune_images() {
    let dir = image_dir();
    let Ok(read) = std::fs::read_dir(&dir) else {
        return;
    };
    let entries: Vec<(String, SystemTime)> = read
        .filter_map(|e| e.ok())
        .map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let modified = e
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            (name, modified)
        })
        .collect();

    for name in images_to_prune(&entries) {
        let _ = std::fs::remove_file(dir.join(name));
    }
}

// ---------------------------------------------------------------------------
// Download + verify
// ---------------------------------------------------------------------------

fn emit_progress(app: &AppHandle, tag: &str, phase: UpdaterPhase, downloaded: u64, total: u64) {
    let _ = app.emit(
        "updater-progress",
        UpdaterProgress {
            tag: tag.to_string(),
            phase,
            downloaded,
            total,
        },
    );
}

fn download_client(current_version: &str) -> Result<reqwest::Client, UpdaterError> {
    let policy = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= MAX_REDIRECTS {
            return attempt.stop();
        }
        let url = attempt.url();
        if is_allowed_redirect(url.scheme(), url.host_str()) {
            attempt.follow()
        } else {
            // Stop rather than follow: the 3xx surfaces as a non-success status
            // and the download fails, instead of quietly fetching elsewhere.
            attempt.stop()
        }
    });
    reqwest::Client::builder()
        .user_agent(format!("HoTTY/{current_version}"))
        .timeout(DOWNLOAD_TIMEOUT)
        .redirect(policy)
        .build()
        .map_err(|e| UpdaterError::Client(e.to_string()))
}

/// Download the installer, hashing as the bytes arrive, and write it out only
/// once the hash matches what GitHub published.
///
/// Nothing is installed if any of this fails: the caller only ever receives a
/// path to a fully verified file.
pub async fn download_image(
    app: &AppHandle,
    current_version: &str,
    tag: &str,
    asset: &ResolvedAsset,
    cancel: &CancellationToken,
) -> Result<PathBuf, UpdaterError> {
    if !is_allowed_download_url(&asset.download_url) {
        return Err(UpdaterError::UrlNotAllowed);
    }
    let expected = asset.sha256.as_ref().ok_or(UpdaterError::NotInstallable)?;

    // The asset name comes from GitHub. Take only its final component and
    // require our own naming shape, so a name containing separators can never
    // escape the image directory.
    let file_name = Path::new(&asset.asset_name)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .filter(|n| is_update_image_name(n))
        .ok_or(UpdaterError::UrlNotAllowed)?;

    let client = download_client(current_version)?;
    let resp = client
        .get(&asset.download_url)
        .send()
        .await
        .map_err(|e| UpdaterError::Request(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(UpdaterError::Status(resp.status().as_u16()));
    }

    let total = resp.content_length().unwrap_or(asset.size);
    if total > MAX_IMAGE_BYTES {
        return Err(UpdaterError::TooLarge);
    }

    let mut hasher = Sha256::new();
    let mut buf: Vec<u8> = Vec::with_capacity(total.min(MAX_IMAGE_BYTES) as usize);
    let mut downloaded: u64 = 0;
    let mut last_emit = Instant::now();
    emit_progress(app, tag, UpdaterPhase::Downloading, 0, total);

    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if cancel.is_cancelled() {
            return Err(UpdaterError::Cancelled);
        }
        let chunk = chunk.map_err(|e| UpdaterError::Request(e.to_string()))?;
        downloaded += chunk.len() as u64;
        if downloaded > MAX_IMAGE_BYTES {
            return Err(UpdaterError::TooLarge);
        }
        hasher.update(&chunk);
        buf.extend_from_slice(&chunk);

        if last_emit.elapsed() >= PROGRESS_INTERVAL {
            emit_progress(app, tag, UpdaterPhase::Downloading, downloaded, total);
            last_emit = Instant::now();
        }
    }
    emit_progress(app, tag, UpdaterPhase::Downloading, downloaded, total);

    if cancel.is_cancelled() {
        return Err(UpdaterError::Cancelled);
    }

    emit_progress(app, tag, UpdaterPhase::Verifying, downloaded, total);
    let actual = hex_encode(&hasher.finalize());
    if &actual != expected {
        log::error!(
            "updater: checksum mismatch for {tag} (expected {}..., got {}...)",
            &expected[..8],
            &actual[..8]
        );
        return Err(UpdaterError::ChecksumMismatch);
    }

    let path = image_dir().join(&file_name);
    atomic_write(&path, &buf).map_err(|e| UpdaterError::Io(e.to_string()))?;
    prune_images();
    Ok(path)
}

// ---------------------------------------------------------------------------
// Installer handoff
// ---------------------------------------------------------------------------

/// Start the NSIS installer and return immediately.
///
/// Only [`UpdaterState::launch_pending`] should call this, from `RunEvent::Exit`
/// — see the module docs for why the ordering matters.
#[cfg(windows)]
pub fn launch_installer(path: &Path) -> Result<(), UpdaterError> {
    use std::process::Stdio;

    if !path.is_file() {
        return Err(UpdaterError::Launch("installer is missing".into()));
    }
    // Absolute, resolved path passed straight to CreateProcess. No shell is
    // involved, so there is no argument string for anything in the path to
    // break out of.
    let path = path
        .canonicalize()
        .map_err(|e| UpdaterError::Launch(e.to_string()))?;

    let mut cmd = std::process::Command::new(&path);
    cmd.args(INSTALLER_ARGS)
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    // Do not hand the installer our credential-bearing environment (the
    // "credential inheritance leak" item in the threat model). TMP/TEMP and the
    // rest stay, because NSIS resolves $TEMP through them.
    let sensitive: Vec<String> = std::env::vars()
        .map(|(k, _)| k)
        .filter(|k| is_sensitive_env_var(k))
        .collect();
    for key in sensitive {
        cmd.env_remove(key);
    }

    // Deliberately no CREATE_NO_WINDOW: unlike the helper processes elsewhere in
    // the app, this one is meant to be seen. /P shows a progress window, and
    // once we exit that is the only feedback the user gets.
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| UpdaterError::Launch(e.to_string()))
}

#[cfg(not(windows))]
pub fn launch_installer(_path: &Path) -> Result<(), UpdaterError> {
    Err(UpdaterError::Launch(
        "in-app version switching is Windows-only".into(),
    ))
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/// Download and verify the installer for `tag`, then park it for launch at exit.
///
/// On success the caller should exit the app; `RunEvent::Exit` picks the
/// installer up from there. On any failure nothing has been installed and the
/// app keeps running.
pub async fn prepare_install(
    app: &AppHandle,
    state: &UpdaterState,
    current_version: &str,
    tag: &str,
    asset: &ResolvedAsset,
    window_label: &str,
) -> Result<(), UpdaterError> {
    let cancel = state.begin(window_label)?;
    let result = download_image(app, current_version, tag, asset, &cancel).await;
    state.end();

    let path = result?;
    emit_progress(app, tag, UpdaterPhase::Launching, asset.size, asset.size);
    state.set_pending(path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(secs: u64) -> SystemTime {
        SystemTime::UNIX_EPOCH + Duration::from_secs(secs)
    }

    fn entry(version: &str, prerelease: bool, installable: bool) -> ReleaseEntry {
        ReleaseEntry {
            tag: format!("v{version}"),
            version: version.to_string(),
            name: format!("v{version}"),
            prerelease,
            notes: String::new(),
            html_url: String::new(),
            asset_name: expected_asset_name(version),
            size: 0,
            relation: Relation::Newer,
            installable,
        }
    }

    // -- version comparison (moved from commands/updater.rs, unchanged) ------

    #[test]
    fn strip_v_prefix_trims_leading_v() {
        assert_eq!(strip_v_prefix("v1.2.3"), "1.2.3");
        assert_eq!(strip_v_prefix("V1.2.3"), "1.2.3");
        assert_eq!(strip_v_prefix("1.2.3"), "1.2.3");
    }

    #[test]
    fn parse_version_splits_core_and_pre() {
        assert_eq!(parse_version("2.0.0"), (2, 0, 0, String::new()));
        assert_eq!(parse_version("v2.0.1-beta3"), (2, 0, 1, "beta3".into()));
        assert_eq!(parse_version("garbage"), (0, 0, 0, String::new()));
    }

    #[test]
    fn newer_when_core_is_higher() {
        assert!(is_strictly_newer("2.0.0", "2.0.1"));
        assert!(is_strictly_newer("2.0.0", "2.1.0"));
        assert!(is_strictly_newer("2.0.0", "3.0.0"));
        assert!(!is_strictly_newer("2.0.1", "2.0.0"));
    }

    #[test]
    fn stable_is_newer_than_its_own_prerelease() {
        assert!(is_strictly_newer("2.0.0-beta3", "2.0.0"));
        assert!(!is_strictly_newer("2.0.0", "2.0.0-beta3"));
    }

    #[test]
    fn same_version_is_not_newer() {
        assert!(!is_strictly_newer("2.0.0", "2.0.0"));
        assert!(!is_strictly_newer("2.0.0-beta3", "2.0.0-beta3"));
    }

    #[test]
    fn later_prerelease_tag_is_newer() {
        assert!(is_strictly_newer("2.0.0-beta3", "2.0.0-beta4"));
        assert!(!is_strictly_newer("2.0.0-beta4", "2.0.0-beta3"));
    }

    #[test]
    fn double_digit_prerelease_compares_numerically() {
        // Lexicographic compare would say "beta10" < "beta9"; numeric-aware
        // compare must say "beta10" > "beta9".
        assert!(is_strictly_newer("2.0.0-beta9", "2.0.0-beta10"));
        assert!(!is_strictly_newer("2.0.0-beta10", "2.0.0-beta9"));
        assert!(is_strictly_newer("2.0.0-beta9", "2.0.0-beta11"));
    }

    // -- downgrade direction ------------------------------------------------

    #[test]
    fn relation_detects_both_directions() {
        assert_eq!(relation_of("2.1.0-beta1", "2.0.16"), Relation::Older);
        assert_eq!(relation_of("2.0.16", "2.1.0-beta1"), Relation::Newer);
        assert_eq!(relation_of("2.1.0-beta1", "2.1.0-beta1"), Relation::Current);
    }

    #[test]
    fn relation_handles_prerelease_edges() {
        // Going from a stable build back to its own pre-release is a downgrade.
        assert_eq!(relation_of("2.0.0", "2.0.0-beta3"), Relation::Older);
        // And double-digit pre-release ordering holds in reverse too.
        assert_eq!(relation_of("2.0.0-beta10", "2.0.0-beta9"), Relation::Older);
    }

    // -- tag validation -----------------------------------------------------

    #[test]
    fn valid_tags_are_accepted() {
        assert!(is_valid_tag("v2.0.18"));
        assert!(is_valid_tag("2.0.18"));
        assert!(is_valid_tag("v2.1.0-beta1"));
        assert!(is_valid_tag("2.1.0-beta10"));
    }

    #[test]
    fn malformed_tags_are_rejected() {
        assert!(!is_valid_tag(""));
        assert!(!is_valid_tag("2.0"));
        assert!(!is_valid_tag("2.0.1.4"));
        assert!(!is_valid_tag("2.0.x"));
        assert!(!is_valid_tag("2.0.1-"));
        assert!(!is_valid_tag("2.0.1-beta"));
        assert!(!is_valid_tag("2.0.1-1beta"));
        assert!(!is_valid_tag("2.0.1-BETA1"));
        assert!(!is_valid_tag("99999.0.0"));
        assert!(!is_valid_tag(&"9".repeat(60)));
    }

    #[test]
    fn tag_validation_rejects_path_and_url_injection() {
        // The whole point of the check: none of these reach a path join, a URL
        // comparison or a log line.
        assert!(!is_valid_tag("../../etc/passwd"));
        assert!(!is_valid_tag("2.0.18/../../evil"));
        assert!(!is_valid_tag("2.0.18 && calc"));
        assert!(!is_valid_tag("https://evil.example/x"));
        assert!(!is_valid_tag("2.0.18\\..\\evil"));
        assert!(!is_valid_tag("2.0.18\n"));
        assert!(!is_valid_tag("2.0.18-beta1_x64-setup.exe"));
    }

    // -- asset matching and digests -----------------------------------------

    #[test]
    fn asset_name_matches_the_release_pipeline() {
        assert_eq!(expected_asset_name("2.0.18"), "HoTTY_2.0.18_x64-setup.exe");
        assert_eq!(
            expected_asset_name("2.1.0-beta1"),
            "HoTTY_2.1.0-beta1_x64-setup.exe"
        );
    }

    #[test]
    fn digest_parses_only_well_formed_sha256() {
        let hex = "ca5c537575ec5d190e456a41338ecb07d0313b47f85ac6d5fefa3ef64bbe7cb5";
        assert_eq!(
            parse_digest(&format!("sha256:{hex}")),
            Some(hex.to_string())
        );
        assert_eq!(
            parse_digest(&format!("sha256:{}", hex.to_uppercase())),
            Some(hex.to_string())
        );
        assert_eq!(parse_digest("sha512:abc"), None);
        assert_eq!(parse_digest("sha256:short"), None);
        assert_eq!(parse_digest("sha256:"), None);
        assert_eq!(parse_digest(&format!("sha256:{}z", &hex[..63])), None);
        assert_eq!(parse_digest(hex), None);
    }

    #[test]
    fn hex_encode_pads_each_byte() {
        assert_eq!(hex_encode(&[0x00, 0x0f, 0xff]), "000fff");
    }

    #[test]
    fn sha256_matches_a_known_vector() {
        // Guards the hashing wiring itself: "abc" has a well-known digest, and
        // feeding it in pieces must produce the same value as feeding it whole.
        let want = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        let mut whole = Sha256::new();
        whole.update(b"abc");
        assert_eq!(hex_encode(&whole.finalize()), want);

        let mut split = Sha256::new();
        split.update(b"a");
        split.update(b"b");
        split.update(b"c");
        assert_eq!(hex_encode(&split.finalize()), want);
    }

    // -- URL fencing --------------------------------------------------------

    #[test]
    fn only_this_repo_release_downloads_are_allowed() {
        assert!(is_allowed_download_url(
            "https://github.com/horryworks/HoTTY/releases/download/v2.0.18/HoTTY_2.0.18_x64-setup.exe"
        ));
        assert!(is_allowed_download_url(
            "HTTPS://GitHub.com/horryworks/HoTTY/releases/download/v2.0.18/x.exe"
        ));
        assert!(!is_allowed_download_url(
            "https://evil.example/horryworks/HoTTY/releases/download/v2.0.18/x.exe"
        ));
        assert!(!is_allowed_download_url(
            "https://github.com/someone/else/releases/download/v1/x.exe"
        ));
        assert!(!is_allowed_download_url(
            "http://github.com/horryworks/HoTTY/releases/download/v2.0.18/x.exe"
        ));
        // A prefix lookalike host must not pass.
        assert!(!is_allowed_download_url(
            "https://github.com.evil.test/horryworks/HoTTY/releases/download/v1/x.exe"
        ));
        // Path stays case-sensitive: different repo casing is a different repo.
        assert!(!is_allowed_download_url(
            "https://github.com/HORRYWORKS/HoTTY/releases/download/v2.0.18/x.exe"
        ));
    }

    #[test]
    fn redirects_are_pinned_to_github_hosts() {
        assert!(is_allowed_redirect("https", Some("github.com")));
        assert!(is_allowed_redirect(
            "https",
            Some("objects.githubusercontent.com")
        ));
        assert!(is_allowed_redirect("HTTPS", Some("GitHub.com")));
        assert!(!is_allowed_redirect("http", Some("github.com")));
        assert!(!is_allowed_redirect("https", Some("evil.example")));
        assert!(!is_allowed_redirect("https", None));
        // Suffix matching must not accept a lookalike parent domain.
        assert!(!is_allowed_redirect(
            "https",
            Some("evilgithubusercontent.com")
        ));
    }

    // -- image retention ----------------------------------------------------

    #[test]
    fn image_names_are_recognised() {
        assert!(is_update_image_name("HoTTY_2.0.18_x64-setup.exe"));
        assert!(!is_update_image_name("HoTTY_2.0.18_x64-setup.exe.tmp3"));
        assert!(!is_update_image_name("something-else.exe"));
        assert!(is_stale_temp_name("HoTTY_2.0.18_x64-setup.exe.tmp3"));
        assert!(!is_stale_temp_name("HoTTY_2.0.18_x64-setup.exe"));
    }

    #[test]
    fn prune_keeps_only_the_newest_image() {
        let entries = vec![
            ("HoTTY_2.0.16_x64-setup.exe".to_string(), t(100)),
            ("HoTTY_2.0.18_x64-setup.exe".to_string(), t(300)),
            ("HoTTY_2.0.17_x64-setup.exe".to_string(), t(200)),
        ];
        let doomed = images_to_prune(&entries);
        assert_eq!(doomed.len(), 2);
        assert!(doomed.contains(&"HoTTY_2.0.16_x64-setup.exe".to_string()));
        assert!(doomed.contains(&"HoTTY_2.0.17_x64-setup.exe".to_string()));
        assert!(!doomed.contains(&"HoTTY_2.0.18_x64-setup.exe".to_string()));
    }

    #[test]
    fn prune_always_drops_temps_and_ignores_strangers() {
        let entries = vec![
            ("HoTTY_2.0.18_x64-setup.exe".to_string(), t(300)),
            ("HoTTY_2.0.18_x64-setup.exe.tmp0".to_string(), t(400)),
            ("unrelated.txt".to_string(), t(500)),
        ];
        let doomed = images_to_prune(&entries);
        // The temp goes even though it is the newest thing there, the one real
        // image stays, and a file we did not put there is left alone.
        assert_eq!(doomed, vec!["HoTTY_2.0.18_x64-setup.exe.tmp0".to_string()]);
    }

    #[test]
    fn prune_on_a_single_image_deletes_nothing() {
        let entries = vec![("HoTTY_2.0.18_x64-setup.exe".to_string(), t(300))];
        assert!(images_to_prune(&entries).is_empty());
    }

    #[test]
    fn image_dir_is_not_a_guarded_location() {
        // Writing under the app data dir would collide with path_safety's block
        // list, which is exactly why the temp dir is used instead.
        let dir = image_dir();
        assert!(!super::super::path_safety::is_sensitive_path(&dir));
        assert!(!super::super::path_safety::is_unc_path(
            &dir.to_string_lossy()
        ));
    }

    // -- toast channel selection (the /releases/latest bug) ------------------

    #[test]
    fn prerelease_user_is_offered_the_next_prerelease() {
        // This is the standing bug: /releases/latest omits pre-releases, so a
        // beta user was never told about beta2.
        let entries = vec![
            entry("2.1.0-beta2", true, true),
            entry("2.0.18", false, true),
        ];
        let picked = select_latest(&entries, "2.1.0-beta1").unwrap();
        assert_eq!(picked.version, "2.1.0-beta2");
    }

    #[test]
    fn prerelease_user_is_also_offered_the_stable_that_supersedes_it() {
        let entries = vec![entry("2.1.0", false, true)];
        let picked = select_latest(&entries, "2.1.0-beta1").unwrap();
        assert_eq!(picked.version, "2.1.0");
    }

    #[test]
    fn stable_user_is_never_nudged_onto_a_prerelease() {
        let entries = vec![entry("2.2.0-beta1", true, true)];
        assert!(select_latest(&entries, "2.1.0").is_none());
    }

    #[test]
    fn older_and_unverifiable_releases_are_not_offered() {
        let entries = vec![
            entry("2.0.1", false, true),  // older
            entry("9.0.0", false, false), // newer but not verifiable
        ];
        assert!(select_latest(&entries, "2.1.0").is_none());
    }

    // -- consent dialog wording ---------------------------------------------

    #[test]
    fn downgrade_dialog_says_what_survives() {
        let mut e = entry("2.0.18", false, true);
        e.relation = Relation::Older;
        let (_, body) = dialog_strings(DialogLang::Ja, &e, "2.1.0-beta1", 2);
        assert!(body.contains("2.0.18"));
        assert!(body.contains("残ります"));
        assert!(body.contains("2"), "session count must be shown");

        let (_, body_en) = dialog_strings(DialogLang::En, &e, "2.1.0-beta1", 0);
        assert!(body_en.contains("kept"));
        assert!(
            !body_en.contains("connection(s)"),
            "no sessions, no warning"
        );
    }

    #[test]
    fn upgrade_and_reinstall_dialogs_differ_from_downgrade() {
        let mut e = entry("2.2.0", false, true);
        e.relation = Relation::Newer;
        let (_, up) = dialog_strings(DialogLang::En, &e, "2.1.0", 0);
        assert!(up.contains("Update HoTTY"));

        e.relation = Relation::Current;
        let (_, again) = dialog_strings(DialogLang::En, &e, "2.2.0", 0);
        assert!(again.contains("Reinstall"));
    }

    // -- installer contract -------------------------------------------------

    #[test]
    fn installer_args_are_stable() {
        // /P is what suppresses the "close the app?" prompt (utils.nsh line 41);
        // /UPDATE is what stops NSIS uninstalling first and taking the Host Tree
        // with it. Dropping either silently changes user-visible behaviour, so
        // pin them.
        assert_eq!(INSTALLER_ARGS, ["/UPDATE", "/P", "/R"]);
    }

    // -- catalogue construction ---------------------------------------------

    const FIXTURE: &str = r#"[
      {"tag_name":"v9.9.9","name":"draft","html_url":"h","prerelease":false,"draft":true,
       "body":"","assets":[]},
      {"tag_name":"v2.1.0-beta1","name":"beta","html_url":"h","prerelease":true,"draft":false,
       "body":"notes","assets":[{"name":"HoTTY_2.1.0-beta1_x64-setup.exe","size":10,
       "browser_download_url":"https://github.com/horryworks/HoTTY/releases/download/v2.1.0-beta1/HoTTY_2.1.0-beta1_x64-setup.exe",
       "digest":"sha256:ca5c537575ec5d190e456a41338ecb07d0313b47f85ac6d5fefa3ef64bbe7cb5"}]},
      {"tag_name":"v2.0.18","name":"stable","html_url":"h","prerelease":false,"draft":false,
       "body":"","assets":[{"name":"HoTTY_2.0.18_x64-setup.exe","size":20,
       "browser_download_url":"https://github.com/horryworks/HoTTY/releases/download/v2.0.18/HoTTY_2.0.18_x64-setup.exe",
       "digest":null}]},
      {"tag_name":"v2.0.17","name":"no asset","html_url":"h","prerelease":false,"draft":false,
       "body":"","assets":[]},
      {"tag_name":"v2.0.16","name":"offsite","html_url":"h","prerelease":false,"draft":false,
       "body":"","assets":[{"name":"HoTTY_2.0.16_x64-setup.exe","size":30,
       "browser_download_url":"https://evil.example/HoTTY_2.0.16_x64-setup.exe",
       "digest":"sha256:ca5c537575ec5d190e456a41338ecb07d0313b47f85ac6d5fefa3ef64bbe7cb5"}]}
    ]"#;

    fn fixture_entries(current: &str) -> Vec<(ReleaseEntry, ResolvedAsset)> {
        let releases: Vec<GithubRelease> = serde_json::from_str(FIXTURE).unwrap();
        to_entries(releases, current)
    }

    #[test]
    fn catalogue_drops_drafts_assetless_and_offsite_releases() {
        let entries = fixture_entries("2.1.0-beta1");
        let tags: Vec<&str> = entries.iter().map(|(e, _)| e.tag.as_str()).collect();
        assert_eq!(tags, vec!["v2.1.0-beta1", "v2.0.18"]);
    }

    #[test]
    fn catalogue_keeps_undigested_releases_but_marks_them_uninstallable() {
        let entries = fixture_entries("2.1.0-beta1");
        let (stable, asset) = entries.iter().find(|(e, _)| e.tag == "v2.0.18").unwrap();
        // Listed so its notes stay readable...
        assert!(!stable.installable);
        // ...but with nothing to verify against, so it can never be downloaded.
        assert!(asset.sha256.is_none());
    }

    #[test]
    fn catalogue_marks_the_running_version_and_the_rest() {
        let entries = fixture_entries("2.1.0-beta1");
        let beta = &entries[0].0;
        let stable = &entries[1].0;
        assert_eq!(beta.relation, Relation::Current);
        assert_eq!(stable.relation, Relation::Older);
        assert!(beta.prerelease);
        assert_eq!(beta.notes, "notes");
    }

    #[test]
    fn entries_never_carry_a_download_url() {
        // The renderer-facing type has no URL field at all; this asserts the
        // serialised payload agrees, so the invariant cannot rot silently.
        let entries = fixture_entries("2.1.0-beta1");
        let json = serde_json::to_string(&entries[0].0).unwrap();
        assert!(!json.contains("http"));
        assert!(!json.contains("download"));
    }
}
