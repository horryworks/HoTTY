export type ProtocolId = 'ssh' | 'telnet' | 'serial' | 'wsl' | 'cmd' | 'powershell' | 'git-bash' | 'gcloud-iap';
export type FeatureId = 'ai-chat' | 'log-viewer' | 'ping-monitor' | 'text-editor' | 'file-explorer' | 'file-server' | 'web-browser';

export type Encoding = 'utf8' | 'shift_jis' | 'euc-jp';

export type LayoutMode = '1x1' | '1x2' | '2x1' | '2x2' | '2x3' | '3x2';

export type SessionStatus = 'connected' | 'disconnected';

export type SessionRecordStatus = SessionStatus | 'connecting' | 'error';

interface BaseConnectionConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  encoding: Encoding;
  keepaliveIntervalSecs: number;
  connectTimeoutSecs: number;
  /**
   * Pin the terminal grid to the width sent in the initial pty-req/NAWS instead
   * of reflowing on window resize. For devices that latch the terminal width at
   * connect and ignore later window-change (e.g. Huawei USG/VRP), reflowing
   * desyncs wrapped-line editing. `undefined` = follow the global policy
   * (`fixedTerminalSizeMode`, whose 'auto' fingerprints the device from the SSH
   * ident). SSH/Telnet only. The backend ignores this field (it drives frontend
   * rendering, not the pty request).
   */
  fixedTerminalSize?: boolean;
}

export interface SshConnectionConfig extends BaseConnectionConfig {
  username: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
}

export type TelnetConnectionConfig = BaseConnectionConfig;

export interface GcloudIapConnectionConfig {
  project: string;
  zone: string;
  instance: string;
  encoding: Encoding;
  /** Auto-start the VM if it is stopped instead of prompting the user. */
  autoStart?: boolean;
  /** Explicit SSH login name. Omitted/blank lets the backend auto-detect it
   *  (gcloud `--dry-run`, then metadata/org-policy). Set this only when the
   *  VM provisions an account neither of those finds. */
  username?: string;
}

export interface IapVmStartPromptPayload {
  sessionId: string;
  project: string;
  zone: string;
  instance: string;
  currentStatus: string;
}

export interface SessionDataPayload {
  sessionId: string;
  data: string;
}

export interface SessionStatusPayload {
  sessionId: string;
  status: SessionStatus;
}

/**
 * The terminal size actually baked into the initial pty allocation (SSH pty-req /
 * Telnet initial NAWS), reported once per connect. A fixed-size session pins its
 * grid to this width — the device latched it and ignores later window-change.
 */
export interface SessionPtySizePayload {
  sessionId: string;
  cols: number;
  rows: number;
  /** True when the remote SSH ident names a device family known to latch the pty
   *  width and ignore later window-change (drives the global "auto" mode).
   *  Always false for Telnet, which has no ident to fingerprint. */
  deviceLatchesWidth: boolean;
}

/** A live session as seen across all windows (from `list_all_sessions`). */
export interface SessionInfo {
  sessionId: string;
  host: string;
  protocol: string;
  ownerLabel: string | null;
}

/**
 * A session offered in the AI Chat link picker — either local to this window or
 * owned by another window (cross-window AI linking). `isLocal` drives grouping;
 * `status` is 'connected' for remote sessions (they come from `list_all_sessions`,
 * which only returns live sessions).
 */
export interface LinkableSession {
  sessionId: string;
  displayName: string;
  ownerLabel: string;
  isLocal: boolean;
  status: string;
}

export interface SessionErrorPayload {
  sessionId: string;
  error: string;
}

/** Pane body rectangle reported to the backend (physical pixels, window-relative). */
export interface WebBrowserRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Which categories of browsing data to clear (see the Clear Browsing Data
 *  modal). Mirrors `ClearDataOptions` on the backend. localStorage is never an
 *  option: the embedded browser shares its WebView2 profile with HoTTY's own UI,
 *  whose settings/bookmarks live in localStorage, so it is always preserved. */
export interface WebBrowserClearDataOptions {
  /** Cookies + other site storage (IndexedDB, service workers, etc.), excluding
   *  localStorage. Clearing this logs the user out of sites. */
  cookiesAndSiteData: boolean;
  /** Cached images and files (HTTP disk cache). */
  cache: boolean;
  /** Browsing + download history. */
  history: boolean;
  /** Passwords saved by WebView2's autosave. */
  passwords: boolean;
  /** General autofill form data. */
  autofill: boolean;
}

/** Navigation state pushed from the embedded webview (address-bar sync). */
export interface WebBrowserNavState {
  paneId: string;
  url: string;
  loading: boolean;
}

/** Back/forward availability pushed from the embedded webview (WebView2
 *  HistoryChanged). Separate from nav-state so it never disturbs the loading
 *  spinner. Windows-only; on other platforms the buttons stay disabled. */
export interface WebBrowserHistoryState {
  paneId: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

/** A browser action triggered by an accelerator key pressed while the native
 *  webview (not the HTML chrome) had focus — bridged from WebView2's
 *  AcceleratorKeyPressed so shortcuts work over the page too. */
export interface WebBrowserAccel {
  paneId: string;
  action: 'back' | 'forward' | 'reload' | 'focus-address';
}

/** Current zoom level (percent) pushed from the embedded webview whenever it
 *  changes — via the toolbar stepper or WebView2's built-in Ctrl+± / Ctrl+wheel
 *  (WebView2 ZoomFactorChanged). Keeps the `%` display and per-pane store in sync.
 *  Windows-only; on other platforms zoom is a no-op and no events arrive. */
export interface WebBrowserZoomState {
  paneId: string;
  zoom: number;
}

/** Pushed when the native webview gains focus (WebView2 GotFocus) — i.e. the
 *  user clicked or tabbed into the page. Page clicks never reach the DOM, so
 *  this is the renderer's only signal to move pane focus to the browser pane. */
export interface WebBrowserFocus {
  paneId: string;
}

export interface SshHostKeyPromptPayload {
  sessionId: string;
  host: string;
  port: number;
  keyType: string;
  fingerprint: string;
  kind: 'new' | 'changed';
}

export interface PromptPattern {
  id: string;
  name: string;
  pattern: string;
}

export type ThemeId = string;
export type BuiltInThemeId = 'dark' | 'medium' | 'light';

/** UI display language (i18n). Distinct from the AI response language. */
export type LanguageId = 'en' | 'ja' | 'zh-CN' | 'zh-TW' | 'ko' | 'ru' | 'es' | 'fr';

export interface ThemeTerminalColors {
  foreground: string;
  background: string;
  backgroundInactive: string;
  paneBackground: string;
}

export interface Theme {
  name: string;
  variables: Record<string, string>;
  terminal: ThemeTerminalColors;
}

export interface SerialPortInfo {
  path: string;
  displayName: string;
}

export interface FontInfo {
  family: string;
}

export interface SerialConnectionConfig {
  path: string;
  baudRate: number;
  dataBits: string;
  parity: string;
  stopBits: string;
  flowControl: string;
  encoding: Encoding;
}

export interface WslConnectionConfig {
  distribution?: string;
  encoding: Encoding;
}

export interface LocalConnectionConfig {
  shellType: 'cmd' | 'powershell' | 'git-bash';
  shellPath?: string;
  encoding: Encoding;
}

export interface ContextMenuItem {
  id: string;
  label: string;
  enabled?: boolean;
}

interface AlgorithmEntry {
  name: string;
  enabled: boolean;
}

export type SshAlgorithms = Record<string, AlgorithmEntry[]>;

export interface SaveThemeResult {
  success: boolean;
  error?: string;
}

/** One bundled third-party dependency in the attribution manifest. */
interface LicenseEntry {
  name: string;
  version: string;
  /** "npm" | "rust" */
  ecosystem: string;
  /** SPDX expression or best-effort license name. */
  license: string;
  repository?: string;
  licenseText?: string;
}

export interface ThirdPartyLicenses {
  generatedAt?: string;
  counts?: { npm: number; rust: number; total: number };
  packages: LicenseEntry[];
}

export interface LogFile {
  name: string;
  path: string;
  mtime: number;
  size: number;
}

export interface ListLogFilesResult {
  files?: LogFile[];
  error?: string;
}

export interface ReadLogFileResult {
  content?: string;
  error?: string;
}

export interface ExportHtreeResult {
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Text Editor
// ---------------------------------------------------------------------------

export interface ReadFileResult {
  content: string;
  lineEnding: string;
}

export interface TextEditorTab {
  id: string;
  filePath: string | null;
  content: string;
  savedContent: string;
  encoding: string;
  lineEnding: 'LF' | 'CRLF';
}

// ---------------------------------------------------------------------------
// File Explorer
// ---------------------------------------------------------------------------

export interface DirEntry {
  name: string;
  isDirectory: boolean;
  size: number;
  mtime: number;
  isHidden: boolean;
}

export interface ListDirectoryResult {
  entries?: DirEntry[];
  error?: string;
}

export interface GetDrivesResult {
  drives: string[];
  homedir: string;
}

// ---------------------------------------------------------------------------
// Ping Monitor
// ---------------------------------------------------------------------------

export interface PingResult {
  target: string;
  status: string;
  rtt: number | null;
  ttl: number | null;
  timestamp: string;
}

export interface PingDataPayload {
  sessionId: string;
  results: PingResult[];
}

export interface PingLogFilePayload {
  sessionId: string;
  fileName: string;
}

// ---------------------------------------------------------------------------
// File Server (TFTP / SFTP)
// ---------------------------------------------------------------------------

export type FileServerProtocol = 'tftp' | 'sftp';

/** Mirrors the Rust `FirewallStatus` enum (serde camelCase). */
export type FirewallStatus = 'allowed' | 'blocked' | 'unknown' | 'notApplicable';

/** Mirrors the Rust `FirewallReason` enum — why the status is what it is. */
export type FirewallReason =
  | 'blockRule'
  | 'otherExeRule'
  | 'profileMismatch'
  | 'noRule'
  | 'fwOff'
  | 'thirdPartyFw'
  | 'queryFailed';

/** Mirrors the Rust `FirewallReport` struct (serde camelCase). */
export interface FirewallReport {
  status: FirewallStatus;
  reason?: FirewallReason;
  /** Set with reason `otherExeRule`: the program that rule targets. */
  otherExePath?: string;
}

/** Persisted File Server pane configuration (password is never persisted). */
export interface FileServerConfig {
  rootDir: string;
  bindAddr: string;
  tftpPort: number;
  tftpAllowWrite: boolean;
  sftpPort: number;
  sftpUsername: string;
  sftpAllowWrite: boolean;
}

/** Mirrors the Rust `FileServerEvent` payload (`file-server-event`). */
export interface FileServerEvent {
  serverId: string;
  protocol: FileServerProtocol;
  kind: 'status' | 'transfer' | 'error';
  /** For kind=status: running | stopped | client-connected. */
  status?: string;
  message?: string;
  client?: string;
  filename?: string;
  direction?: 'download' | 'upload';
  bytes?: number;
  /** ms since the Unix epoch. */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// GCE IAP Tunnel
// ---------------------------------------------------------------------------

export interface GcloudStatus {
  available: boolean;
  version?: string;
}

export interface GcloudAuthStatus {
  authenticated: boolean;
  account?: string;
}

export interface GcpProject {
  id: string;
  name: string;
}

/**
 * Result of probing an IAM permission. `unknown` means the probe itself failed
 * (network blip, project deleted mid-list, etc.); the UI defaults to showing
 * such items rather than hiding accessible VMs.
 */
export type AccessState = 'granted' | 'denied' | 'unknown';

/**
 * Project-level IAM probe result. `iapTunnel` is the gate for IAP-tunneled
 * SSH (the only connection path supported by this pane). `osLogin` is shown
 * as a warning only — it's not used to filter because instances may still
 * accept SSH via metadata-based keys.
 */
export interface ProjectAccess {
  iapTunnel: AccessState;
  osLogin: AccessState;
}

/**
 * Per-instance IAM probe result. Populated by the refresh task only when a
 * resource-level fallback probe ran (because project-level IAP was denied).
 */
interface InstanceAccess {
  iapTunnel: AccessState;
  osLogin: AccessState;
}

export interface GceInstance {
  name: string;
  status: string;
  zone?: string;
  /** Resource-level IAM probe result. Absent → inherit project-level. */
  access?: InstanceAccess;
}

export interface GcloudCacheSnapshot {
  gcloud?: GcloudStatus;
  auth?: GcloudAuthStatus;
  projects: GcpProject[];
  /** Map of project ID → list of instances (includes zone). */
  instancesByProject: Record<string, GceInstance[]>;
  /** Map of project ID → error message for projects whose `instances list` failed. */
  projectErrors: Record<string, string>;
  /** Map of project ID → IAM probe result. Missing entries are treated as `unknown`. */
  projectAccess?: Record<string, ProjectAccess>;
  /** Milliseconds since the Unix epoch of the last successful full refresh. */
  lastRefreshedMs?: number;
  refreshInProgress: boolean;
  /**
   * Human-readable reason the last refresh could not retrieve projects (e.g.
   * expired credentials). Absent when the last refresh succeeded. Authoritative
   * "can we actually use the token" signal — `auth.authenticated` only reflects
   * that `gcloud auth list` shows an ACTIVE account.
   */
  refreshError?: string | null;
  /** True when `refreshError` is fixable by re-running `gcloud auth login`. */
  needsReauth?: boolean;
}

export interface GcpRefreshProgress {
  stage: 'gcloud' | 'auth' | 'projects' | 'instances' | 'done';
  currentProject?: string;
  done: number;
  total: number;
}

/** Which direction an in-flight VM action is heading. */
export type GcpVmAction = 'starting' | 'stopping';

/**
 * One `gcp-vm-action` event — the backend's running commentary on a tracked VM
 * Start/Stop. The backend owns the poll loop (it outlives this pane, which
 * unmounts whenever the session dialog closes), writes each transition into the
 * GCP cache, and broadcasts to every window.
 */
export interface GcpVmActionEvent {
  project: string;
  zone: string;
  instance: string;
  /** `null` → the action has settled and `status` is final. */
  action: GcpVmAction | null;
  /**
   * `STARTING` / `STOPPING` until a poll shows forward progress, then the
   * status gcloud actually reported.
   */
  status: string;
  /** Present when the underlying gcloud command failed. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Host Tree
// ---------------------------------------------------------------------------

interface IapTunnelEntry {
  project: string;
  zone: string;
  instance: string;
  /** Auto-start the VM if it is stopped (persisted per-host preference). */
  autoStart?: boolean;
}

export interface HostEntry {
  protocol: 'ssh' | 'telnet' | 'gcloud-iap';
  host: string;
  port: number;
  username?: string;
  password?: string;
  isJumpbox?: boolean;
  jumpboxId?: string;
  iapTunnel?: IapTunnelEntry;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
  /** Per-host "fixed terminal size" preference; `undefined` = follow the global
   *  default. Persisted so it survives across sessions and syncs across windows. */
  fixedTerminalSize?: boolean;
}

export interface HostTreeNode {
  id: string;
  type: 'folder' | 'host';
  name: string;
  entry?: HostEntry;
  children?: HostTreeNode[];
}

/** A node in the Web bookmarks tree (SessionDialog "Web" tab). Mirrors
 *  HostTreeNode but holds only a name + URL — no secrets, so it persists in a
 *  plain Zustand store (no DPAPI). */
export interface BookmarkNode {
  id: string;
  type: 'folder' | 'bookmark';
  name: string;
  url?: string; // only when type === 'bookmark'
  children?: BookmarkNode[];
}

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Updater
// ---------------------------------------------------------------------------

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  releaseUrl: string;
  prerelease: boolean;
  notes: string;
  isNewer: boolean;
}

export interface AIAuthStatus {
  authenticated: boolean;
  accountInfo?: string;
}

export interface AIModelInfo {
  name: string;
  displayName: string;
}

/**
 * An image attachment on an outgoing AI-chat user message. `dataBase64` is raw
 * standard-alphabet base64 (NO `data:` URL prefix); the `mimeType` (e.g.
 * `image/png`) is prepended when a `data:` URL is needed for display. Mirrors the
 * Rust `ChatImage` deserialize target in `services/ai/history.rs`.
 */
export interface ChatImage {
  mimeType: string;
  dataBase64: string;
}

interface AITokenUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

/**
 * `ai-chat-response` event payload — a discriminated union keyed on
 * `responseType` (mirrors the Rust `ChatResponseKind` enum). `usageMetadata`
 * (final token counts) only appears on the terminal `'done'` event; `content`
 * is a delta on `'chunk'` and a user-facing message on `'error'`.
 */
export type AIChatResponseData =
  | { sessionId: string; responseType: 'chunk'; content: string }
  | { sessionId: string; responseType: 'done'; content: string; usageMetadata?: AITokenUsage }
  | { sessionId: string; responseType: 'error'; content: string };

export interface AIAuthResultPayload {
  /** Provider id that produced this result — lets the UI ignore a late result
   *  for a provider the user has since switched away from. */
  provider: string;
  success: boolean;
}

export type CommandExecutionMode = 'ask-before-execute' | 'auto-execute-safe';

/**
 * How auto-execution safety is decided for AI-suggested commands. The
 * user-managed Blacklist is always checked first (a match → ask before execute).
 * - `static`  — Whitelist auto-runs; everything else asks. No AI.
 * - `ai`      — the AI judges anything not blacklisted (no whitelist fast-path).
 * - `hybrid`  — Whitelist auto-runs, AI judges the rest, else ask (recommended).
 */
export type ClassifierStrategy = 'static' | 'ai' | 'hybrid';

/**
 * Structured verdict from a one-shot AI command-safety classification.
 * Mirrors the Rust `CommandVerdict` struct in `services/ai/classifier.rs`.
 */
export interface CommandVerdict {
  modifiesState: boolean;
  confidence: number;
  reason: string;
}

export interface PersonaDefinition {
  id: string;
  label: string;
  systemPrompt: string;
}
