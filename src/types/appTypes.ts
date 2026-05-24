export type ProtocolId = 'ssh' | 'telnet' | 'serial' | 'wsl' | 'cmd' | 'powershell' | 'git-bash' | 'gcloud-iap';
export type FeatureId = 'ai-chat' | 'log-viewer' | 'ping-monitor' | 'text-editor' | 'file-explorer';

export type Encoding = 'utf8' | 'shift_jis' | 'euc-jp';

export type LayoutMode = '1x1' | '1x2' | '2x1' | '2x2' | '2x3' | '3x2';

export type SessionStatus = 'connected' | 'disconnected';

export type SessionRecordStatus = SessionStatus | 'connecting' | 'error';

export interface BaseConnectionConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  encoding: Encoding;
  keepaliveIntervalSecs: number;
  connectTimeoutSecs: number;
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

export interface SessionErrorPayload {
  sessionId: string;
  error: string;
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
export interface InstanceAccess {
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
}

export interface GcpRefreshProgress {
  stage: 'gcloud' | 'auth' | 'projects' | 'instances' | 'done';
  currentProject?: string;
  done: number;
  total: number;
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
}

export interface HostTreeNode {
  id: string;
  type: 'folder' | 'host';
  name: string;
  entry?: HostEntry;
  children?: HostTreeNode[];
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

export type AIAuthType = 'oauth2' | 'service_account' | 'api_key' | 'adc';

export interface AIAuthStatus {
  authenticated: boolean;
  accountInfo?: string;
}

export interface AIModelInfo {
  name: string;
  displayName: string;
}

interface AITokenUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

export interface AIChatResponseData {
  sessionId: string;
  responseType: string;
  content: string;
  usageMetadata?: AITokenUsage;
}

export interface AIAuthResultPayload {
  success: boolean;
}

export type CommandExecutionMode = 'ask-before-execute' | 'auto-execute-safe';

export interface AskAiCommand {
  id: string;
  label: string;
  promptTemplate: string;
}

export interface PersonaDefinition {
  id: string;
  label: string;
  systemPrompt: string;
  askAiCommands: AskAiCommand[];
}
