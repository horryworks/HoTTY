import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  readText as clipboardReadText,
  writeText as clipboardWriteText,
} from '@tauri-apps/plugin-clipboard-manager';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { ask as dialogAsk, open as dialogOpen } from '@tauri-apps/plugin-dialog';
import { redactSensitive } from '../utils/redaction';
import { WINDOW_LABEL } from '../utils/windowLabel';
import type {
  ProtocolId,
  SshConnectionConfig,
  TelnetConnectionConfig,
  SerialConnectionConfig,
  WslConnectionConfig,
  LocalConnectionConfig,
  GcloudIapConnectionConfig,
  SessionDataPayload,
  SessionStatusPayload,
  IapConnectProgressPayload,
  SessionPtySizePayload,
  SessionErrorPayload,
  SessionInfo,
  SshHostKeyPromptPayload,
  SerialPortInfo,
  FontInfo,
  ContextMenuItem,
  Theme,
  SshAlgorithms,
  SaveThemeResult,
  ThirdPartyLicenses,
  ListLogFilesResult,
  ReadLogFileResult,
  ChatLogMeta,
  ChatLogTurnPayload,
  ExportHtreeResult,
  PingDataPayload,
  PingLogFilePayload,
  SnmpConfig,
  SnmpDataPayload,
  SnmpDiscovery,
  SnmpStatusPayload,
  FileServerEvent,
  FileServerProtocol,
  FirewallReport,
  WebBrowserRect,
  WebBrowserClearDataOptions,
  WebBrowserNavState,
  WebBrowserHistoryState,
  WebBrowserAccel,
  WebBrowserZoomState,
  WebBrowserFocus,
  GcloudStatus,
  GcloudAuthStatus,
  GcpProject,
  GceInstance,
  GcloudCacheSnapshot,
  GcpRefreshProgress,
  GcpVmActionEvent,
  IapVmStartPromptPayload,
  AIAuthStatus,
  AIModelInfo,
  AIChatResponseData,
  AIAuthResultPayload,
  ChatImage,
  CommandVerdict,
  UpdateInfo,
} from '../types/appTypes';

type AnyConfig =
  | SshConnectionConfig
  | TelnetConnectionConfig
  | SerialConnectionConfig
  | WslConnectionConfig
  | LocalConnectionConfig
  | GcloudIapConnectionConfig;

const CLIPBOARD_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Check if a credential string is encrypted (DPAPI or SAFE format).
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith('[DPAPI]') || value.startsWith('[SAFE]');
}

export const tauriService = {
  // -----------------------------------------------------------------------
  // Window identity (multi-window)
  // -----------------------------------------------------------------------

  /** This window's label, used to namespace per-window state. */
  windowLabel: WINDOW_LABEL,

  /** Open a new HoTTY window in the current process; resolves to its label. */
  async createWindow(): Promise<string> {
    return invoke<string>('create_window');
  },

  /**
   * Broadcast a shared-store change to all windows (tagged with this window's
   * label as `origin`, which receivers use to ignore their own events).
   */
  async broadcastSharedChange(channel: string, payload: string): Promise<void> {
    await invoke('broadcast_shared_change', { channel, payload, origin: WINDOW_LABEL });
  },

  /** Subscribe to shared-store changes broadcast by other windows. */
  onSharedStoreChanged(
    cb: (p: { channel: string; payload: string; origin: string }) => void,
  ): Promise<UnlistenFn> {
    return listen<{ channel: string; payload: string; origin: string }>(
      'shared-store-changed',
      (e) => cb(e.payload),
    );
  },

  // -----------------------------------------------------------------------
  // Session management
  // -----------------------------------------------------------------------

  async connectSession(
    sessionId: string,
    protocol: ProtocolId,
    config: AnyConfig,
    loggingEnabled: boolean,
    loggingPath: string,
  ): Promise<void> {
    await invoke('connect_session', { sessionId, protocol, config, loggingEnabled, loggingPath });
  },

  async disconnectSession(sessionId: string): Promise<void> {
    await invoke('disconnect_session', { sessionId });
  },

  /**
   * List every live session across ALL windows in the process (the backend
   * enabler for cross-window AI linking). `sendInput` and the watch buffer are
   * keyed by global session id, so any returned session can be driven.
   */
  async listAllSessions(): Promise<SessionInfo[]> {
    return invoke<SessionInfo[]>('list_all_sessions');
  },

  async sendInput(sessionId: string, data: string): Promise<void> {
    await invoke('send_input', { sessionId, data });
  },

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    await invoke('term_resize', { sessionId, cols, rows });
  },

  async updateSessionLogging(loggingEnabled: boolean, loggingPath: string): Promise<void> {
    await invoke('update_session_logging', { loggingEnabled, loggingPath });
  },

  // -----------------------------------------------------------------------
  // AI watch buffer (app-global, keyed by session id — see Phase 5)
  // -----------------------------------------------------------------------

  /** Enable/disable backend AI-watch capture for a session. */
  async setWatching(sessionId: string, watching: boolean, limit: number): Promise<void> {
    await invoke('set_watching', { sessionId, watching, limit });
  },

  /** Peek a session's watch buffer without clearing it (auto-exec poll). */
  async getWatchBuffer(sessionId: string): Promise<string> {
    return invoke<string>('get_watch_buffer', { sessionId });
  },

  /** Read and clear a session's watch buffer (read-once for the AI prompt). */
  async takeWatchBuffer(sessionId: string): Promise<string> {
    return invoke<string>('take_watch_buffer', { sessionId });
  },

  /** Clear a session's watch buffer without disabling watching. */
  async clearWatchBuffer(sessionId: string): Promise<void> {
    await invoke('clear_watch_buffer', { sessionId });
  },

  // -----------------------------------------------------------------------
  // Clipboard
  // -----------------------------------------------------------------------

  async writeClipboard(text: string): Promise<void> {
    if (typeof text !== 'string' || text.length === 0) return;
    if (text.length > CLIPBOARD_MAX_BYTES) return;
    await clipboardWriteText(text);
  },

  async readClipboard(): Promise<string> {
    const v = await clipboardReadText();
    return v ?? '';
  },

  // -----------------------------------------------------------------------
  // SSH host key
  // -----------------------------------------------------------------------

  async respondSshHostKey(
    sessionId: string,
    accept: boolean,
    remember: boolean
  ): Promise<void> {
    await invoke('ssh_host_key_response', { sessionId, accept, remember });
  },

  // -----------------------------------------------------------------------
  // System / utilities
  // -----------------------------------------------------------------------

  async listSerialPorts(): Promise<SerialPortInfo[]> {
    return invoke<SerialPortInfo[]>('list_serial_ports');
  },

  async listWslDistributions(): Promise<string[]> {
    return invoke<string[]>('list_wsl_distributions');
  },

  async detectGitBash(): Promise<string | null> {
    return invoke<string | null>('detect_git_bash');
  },

  async listSystemFonts(): Promise<FontInfo[]> {
    return invoke<FontInfo[]>('list_system_fonts');
  },

  async focusWindow(): Promise<void> {
    await invoke('focus_window');
  },

  async showContextMenu(items: ContextMenuItem[]): Promise<string | null> {
    return invoke<string | null>('show_context_menu', { items });
  },

  async openDebugLogFolder(): Promise<void> {
    await invoke('open_debug_log_folder');
  },

  // -----------------------------------------------------------------------
  // Themes
  // -----------------------------------------------------------------------

  async getThemes(): Promise<Record<string, Theme>> {
    return invoke<Record<string, Theme>>('get_themes');
  },

  async saveCustomTheme(themeKey: string, themeData: Theme): Promise<SaveThemeResult> {
    return invoke<SaveThemeResult>('save_custom_theme', { themeKey, themeData });
  },

  async deleteCustomTheme(themeKey: string): Promise<SaveThemeResult> {
    return invoke<SaveThemeResult>('delete_custom_theme', { themeKey });
  },

  // -----------------------------------------------------------------------
  // Third-party licenses
  // -----------------------------------------------------------------------

  async getThirdPartyLicenses(): Promise<ThirdPartyLicenses> {
    return invoke<ThirdPartyLicenses>('get_third_party_licenses');
  },

  // -----------------------------------------------------------------------
  // SSH algorithms
  // -----------------------------------------------------------------------

  async getSshAlgorithms(): Promise<SshAlgorithms> {
    return invoke<SshAlgorithms>('get_ssh_algorithms');
  },

  async saveSshAlgorithms(algorithms: SshAlgorithms): Promise<boolean> {
    return invoke<boolean>('save_ssh_algorithms', { algorithms });
  },

  // -----------------------------------------------------------------------
  // Log viewer
  // -----------------------------------------------------------------------

  async listLogFiles(folderPath: string): Promise<ListLogFilesResult> {
    return invoke<ListLogFilesResult>('list_log_files', { folderPath });
  },

  async readLogFile(filePath: string): Promise<ReadLogFileResult> {
    return invoke<ReadLogFileResult>('read_log_file', { filePath });
  },

  // -----------------------------------------------------------------------
  // AI chat logging (markdown transcripts, same folder as session logs)
  // -----------------------------------------------------------------------

  /**
   * Append conversation turns to `logKey`'s transcript, creating the file on
   * the first call. Rejects if `logDir` is not in the dialog-attested
   * allow-list that also gates terminal session logging.
   */
  async aiChatLogAppend(
    logKey: string,
    logDir: string,
    meta: ChatLogMeta,
    turns: ChatLogTurnPayload[],
  ): Promise<void> {
    await invoke('ai_chat_log_append', { logKey, logDir, meta, turns });
  },

  /** Forget `logKey` so the next append starts a fresh transcript file. */
  async aiChatLogClose(logKey: string): Promise<void> {
    await invoke('ai_chat_log_close', { logKey });
  },

  // -----------------------------------------------------------------------
  // Host tree import/export
  // -----------------------------------------------------------------------

  async exportHtree(data: string, password: string): Promise<ExportHtreeResult> {
    return invoke<ExportHtreeResult>('export_htree', { data, password });
  },

  async selectImportFile(): Promise<string | null> {
    return invoke<string | null>('select_import_file');
  },

  async decryptImportFile(password: string): Promise<string> {
    return invoke<string>('decrypt_import_file', { password });
  },

  async migrateHostTreeCredentials(treeJson: string): Promise<string> {
    return invoke<string>('migrate_host_tree_credentials', { treeJson });
  },

  // -----------------------------------------------------------------------
  // DPAPI encryption
  // -----------------------------------------------------------------------

  async dpapiEncrypt(plaintext: string): Promise<string> {
    return invoke<string>('dpapi_encrypt', { plaintext });
  },

  async dpapiDecrypt(ciphertext: string): Promise<string> {
    return invoke<string>('dpapi_decrypt', { ciphertext });
  },

  async dpapiEncryptBatch(values: string[]): Promise<string[]> {
    return invoke<string[]>('dpapi_encrypt_batch', { values });
  },

  async dpapiDecryptBatch(values: string[]): Promise<string[]> {
    return invoke<string[]>('dpapi_decrypt_batch', { values });
  },

  // -----------------------------------------------------------------------
  // Logging
  // -----------------------------------------------------------------------

  async logDebug(level: string, category: string, message: string): Promise<void> {
    await invoke('log_debug', { level, category, message: redactSensitive(message) });
  },

  // -----------------------------------------------------------------------
  // File dialogs
  // -----------------------------------------------------------------------

  async selectImage(): Promise<string | null> {
    return invoke<string | null>('select_image');
  },

  async selectFolder(): Promise<string | null> {
    return invoke<string | null>('select_folder');
  },

  /**
   * Native single-file picker. Unlike the pickers above there is no backend
   * command behind this one — it is the `plugin-dialog` API directly — but it is
   * wrapped here anyway so components never import a Tauri API themselves
   * (ADR-004). Returns null when the user cancels.
   */
  async selectFile(title: string): Promise<string | null> {
    const selected = await dialogOpen({ multiple: false, directory: false, title });
    return typeof selected === 'string' ? selected : null;
  },

  /**
   * Convert an absolute filesystem path into a URL the webview can load through
   * Tauri's asset protocol (scoped by `assetProtocol.scope` in
   * `tauri.conf.json`). Synchronous — `convertFileSrc` is pure string rewriting,
   * not IPC — so callers must not await it.
   */
  toAssetUrl(path: string): string {
    return convertFileSrc(path);
  },

  async confirmLogDir(path: string): Promise<boolean> {
    return invoke<boolean>('confirm_log_dir', { path });
  },

  // -----------------------------------------------------------------------
  // Ping monitor
  // -----------------------------------------------------------------------

  async pingMonitorStart(
    sessionId: string,
    targets: string[],
    intervalMs: number,
    loggingEnabled: boolean,
    loggingPath: string
  ): Promise<void> {
    await invoke('ping_monitor_start', { sessionId, targets, intervalMs, loggingEnabled, loggingPath });
  },

  async pingMonitorStop(sessionId: string): Promise<void> {
    await invoke('ping_monitor_stop', { sessionId });
  },

  async pingMonitorUpdateTargets(sessionId: string, targets: string[]): Promise<void> {
    await invoke('ping_monitor_update_targets', { sessionId, targets });
  },

  async pingMonitorUpdateInterval(sessionId: string, intervalMs: number): Promise<void> {
    await invoke('ping_monitor_update_interval', { sessionId, intervalMs });
  },

  onPingMonitorData(cb: (p: PingDataPayload) => void): Promise<UnlistenFn> {
    return listen<PingDataPayload>('ping-monitor-data', (e) => cb(e.payload));
  },

  onPingMonitorLogFile(cb: (p: PingLogFilePayload) => void): Promise<UnlistenFn> {
    return listen<PingLogFilePayload>('ping-monitor-log-file', (e) => cb(e.payload));
  },

  // -----------------------------------------------------------------------
  // Interface traffic watcher (SNMP)
  // -----------------------------------------------------------------------

  /** One-shot connection test + interface listing. */
  async snmpListInterfaces(config: SnmpConfig): Promise<SnmpDiscovery> {
    return await invoke<SnmpDiscovery>('snmp_list_interfaces', { config });
  },

  /** Start (or restart) polling. Calling it again for the same pane replaces
   *  the running watcher, which is also how the target device is changed. */
  async snmpWatcherStart(paneId: string, config: SnmpConfig, intervalMs: number): Promise<void> {
    await invoke('snmp_watcher_start', { paneId, config, intervalMs });
  },

  async snmpWatcherStop(paneId: string): Promise<void> {
    await invoke('snmp_watcher_stop', { paneId });
  },

  async snmpWatcherUpdateInterval(paneId: string, intervalMs: number): Promise<void> {
    await invoke('snmp_watcher_update_interval', { paneId, intervalMs });
  },

  onSnmpWatcherData(cb: (p: SnmpDataPayload) => void): Promise<UnlistenFn> {
    return listen<SnmpDataPayload>('snmp-watcher-data', (e) => cb(e.payload));
  },

  onSnmpWatcherStatus(cb: (p: SnmpStatusPayload) => void): Promise<UnlistenFn> {
    return listen<SnmpStatusPayload>('snmp-watcher-status', (e) => cb(e.payload));
  },

  // -----------------------------------------------------------------------
  // File server (TFTP / SFTP)
  // -----------------------------------------------------------------------

  async fileServerTftpStart(
    serverId: string,
    bindAddr: string,
    port: number,
    rootDir: string,
    allowWrite: boolean
  ): Promise<void> {
    await invoke('file_server_tftp_start', { serverId, bindAddr, port, rootDir, allowWrite });
  },

  async fileServerTftpStop(serverId: string): Promise<void> {
    await invoke('file_server_tftp_stop', { serverId });
  },

  async fileServerSftpStart(
    serverId: string,
    bindAddr: string,
    port: number,
    rootDir: string,
    username: string,
    password: string,
    allowWrite: boolean
  ): Promise<void> {
    await invoke('file_server_sftp_start', {
      serverId,
      bindAddr,
      port,
      rootDir,
      username,
      password,
      allowWrite,
    });
  },

  async fileServerSftpStop(serverId: string): Promise<void> {
    await invoke('file_server_sftp_stop', { serverId });
  },

  async fileServerFirewallStatus(
    protocol: FileServerProtocol,
    port: number
  ): Promise<FirewallReport> {
    return invoke<FirewallReport>('file_server_firewall_status', { protocol, port });
  },

  async fileServerFirewallAllow(protocol: FileServerProtocol, port: number): Promise<void> {
    await invoke('file_server_firewall_allow', { protocol, port });
  },

  onFileServerEvent(cb: (p: FileServerEvent) => void): Promise<UnlistenFn> {
    return listen<FileServerEvent>('file-server-event', (e) => cb(e.payload));
  },

  // -----------------------------------------------------------------------
  // Web browser pane (embedded native webview)
  // -----------------------------------------------------------------------

  async webBrowserCreate(
    paneId: string,
    url: string,
    rect: WebBrowserRect,
    zoom: number,
  ): Promise<void> {
    await invoke('web_browser_create', { paneId, url, rect, zoom });
  },

  async webBrowserNavigate(paneId: string, url: string): Promise<void> {
    await invoke('web_browser_navigate', { paneId, url });
  },

  async webBrowserCurrentUrl(paneId: string): Promise<string | null> {
    return invoke<string | null>('web_browser_current_url', { paneId });
  },

  async webBrowserBack(paneId: string): Promise<void> {
    await invoke('web_browser_back', { paneId });
  },

  async webBrowserForward(paneId: string): Promise<void> {
    await invoke('web_browser_forward', { paneId });
  },

  async webBrowserReload(paneId: string): Promise<void> {
    await invoke('web_browser_reload', { paneId });
  },

  async webBrowserStop(paneId: string): Promise<void> {
    await invoke('web_browser_stop', { paneId });
  },

  async webBrowserSetBounds(paneId: string, rect: WebBrowserRect): Promise<void> {
    await invoke('web_browser_set_bounds', { paneId, rect });
  },

  async webBrowserSetVisible(paneId: string, visible: boolean): Promise<void> {
    await invoke('web_browser_set_visible', { paneId, visible });
  },

  async webBrowserDestroy(paneId: string): Promise<void> {
    await invoke('web_browser_destroy', { paneId });
  },

  /** Set the pane's webview zoom (percentage; clamped server-side to 25–500). */
  async webBrowserSetZoom(paneId: string, zoom: number): Promise<void> {
    await invoke('web_browser_set_zoom', { paneId, zoom });
  },

  /** Clear the selected categories of browsing data (cookies/site data, cache,
   *  history, saved passwords, autofill) for the embedded browser. HoTTY's own
   *  settings and bookmarks (localStorage in the shared profile) are preserved. */
  async webBrowserClearBrowsingData(
    paneId: string,
    options: WebBrowserClearDataOptions,
  ): Promise<void> {
    await invoke('web_browser_clear_browsing_data', { paneId, options });
  },

  /** Export the whole bookmark tree to a user-chosen JSON file (native save
   *  dialog on the backend). Resolves false if the user cancels. */
  async webBrowserExportBookmarks(data: string): Promise<boolean> {
    return invoke<boolean>('web_browser_export_bookmarks', { data });
  },

  /** Pick a bookmarks JSON file (native open dialog) and return its raw text,
   *  or null if the user cancels. Shape validation happens client-side. */
  async webBrowserImportBookmarks(): Promise<string | null> {
    return invoke<string | null>('web_browser_import_bookmarks');
  },

  onWebBrowserNavState(cb: (p: WebBrowserNavState) => void): Promise<UnlistenFn> {
    return listen<WebBrowserNavState>('web-browser-nav-state', (e) => cb(e.payload));
  },

  onWebBrowserHistoryState(cb: (p: WebBrowserHistoryState) => void): Promise<UnlistenFn> {
    return listen<WebBrowserHistoryState>('web-browser-history-state', (e) => cb(e.payload));
  },

  onWebBrowserAccel(cb: (p: WebBrowserAccel) => void): Promise<UnlistenFn> {
    return listen<WebBrowserAccel>('web-browser-accel', (e) => cb(e.payload));
  },

  onWebBrowserZoomState(cb: (p: WebBrowserZoomState) => void): Promise<UnlistenFn> {
    return listen<WebBrowserZoomState>('web-browser-zoom-state', (e) => cb(e.payload));
  },

  onWebBrowserFocus(cb: (p: WebBrowserFocus) => void): Promise<UnlistenFn> {
    return listen<WebBrowserFocus>('web-browser-focus', (e) => cb(e.payload));
  },

  // -----------------------------------------------------------------------
  // GCE IAP Tunnel
  // -----------------------------------------------------------------------

  async gceIapCheckGcloud(): Promise<GcloudStatus> {
    return invoke<GcloudStatus>('gce_iap_check_gcloud');
  },

  async gceIapCheckAuth(): Promise<GcloudAuthStatus> {
    return invoke<GcloudAuthStatus>('gce_iap_check_auth');
  },

  /** Launch `gcloud auth login` (browser OAuth). Fire-and-forget; the user
   *  completes login in the browser, then refreshes the GCP pane. */
  async gceIapRunAuthLogin(): Promise<void> {
    return invoke<void>('gce_iap_run_auth_login');
  },

  async gceIapListProjects(): Promise<GcpProject[]> {
    return invoke<GcpProject[]>('gce_iap_list_projects');
  },

  async gceIapListZones(project: string): Promise<string[]> {
    return invoke<string[]>('gce_iap_list_zones', { project });
  },

  async gceIapListInstances(project: string, zone: string): Promise<GceInstance[]> {
    return invoke<GceInstance[]>('gce_iap_list_instances', { project, zone });
  },

  /** Subscribe to the backend's "VM is stopped — ask the user before starting" prompt. */
  onIapVmStartPrompt(cb: (p: IapVmStartPromptPayload) => void): Promise<UnlistenFn> {
    return listen<IapVmStartPromptPayload>('iap-vm-start-prompt', (e) => cb(e.payload));
  },

  /** Deliver the user's response to a pending VM-start prompt. */
  async gceIapRespondVmStart(sessionId: string, approved: boolean): Promise<void> {
    await invoke('gce_iap_respond_vm_start', { sessionId, approved });
  },

  /** Read the current GCP discovery cache (never triggers a fetch). */
  async gceIapGetCache(): Promise<GcloudCacheSnapshot> {
    return invoke<GcloudCacheSnapshot>('gce_iap_get_cache');
  },

  /**
   * Force-refresh the GCP discovery cache. Emits `gcp-refresh-progress` events
   * during the run and `gcp-cache-updated` on completion. Returns the final
   * snapshot.
   */
  async gceIapRefreshCache(): Promise<GcloudCacheSnapshot> {
    return invoke<GcloudCacheSnapshot>('gce_iap_refresh_cache');
  },

  /**
   * Start a stopped GCE instance. Resolves as soon as the backend registers the
   * action — it does NOT wait for gcloud. Transitions, the final status, and any
   * failure arrive via `onGcpVmAction`, and each is written into the GCP cache.
   * Rejects only when the action was never registered (invalid identifiers, or
   * one already in flight for this VM).
   */
  async gceIapStartInstance(project: string, zone: string, instance: string): Promise<void> {
    await invoke('gce_iap_start_instance', { project, zone, instance });
  },

  /** Stop a running GCE instance. Same contract as `gceIapStartInstance`. */
  async gceIapStopInstance(project: string, zone: string, instance: string): Promise<void> {
    await invoke('gce_iap_stop_instance', { project, zone, instance });
  },

  /**
   * Every VM Start/Stop currently in flight. Called on mount so the pane can
   * re-adopt actions started before it existed — a Start issued and then
   * "abandoned" by closing the session dialog keeps running in the backend.
   */
  async gceIapListVmActions(): Promise<GcpVmActionEvent[]> {
    return invoke<GcpVmActionEvent[]>('gce_iap_list_vm_actions');
  },

  /** Subscribe to GCP cache refresh progress updates. */
  onGcpRefreshProgress(cb: (p: GcpRefreshProgress) => void): Promise<UnlistenFn> {
    return listen<GcpRefreshProgress>('gcp-refresh-progress', (e) => cb(e.payload));
  },

  /** Subscribe to "cache refresh completed" notifications. */
  onGcpCacheUpdated(cb: () => void): Promise<UnlistenFn> {
    return listen<void>('gcp-cache-updated', () => cb());
  },

  /** Subscribe to tracked VM Start/Stop progress (broadcast to every window). */
  onGcpVmAction(cb: (e: GcpVmActionEvent) => void): Promise<UnlistenFn> {
    return listen<GcpVmActionEvent>('gcp-vm-action', (e) => cb(e.payload));
  },

  // -----------------------------------------------------------------------
  // App info
  // -----------------------------------------------------------------------

  async getAppVersion(): Promise<string> {
    return getVersion();
  },

  async setWindowTitle(title: string): Promise<void> {
    await getCurrentWebviewWindow().setTitle(title);
  },

  async confirmDialog(
    message: string,
    options: { title?: string; okLabel?: string; cancelLabel?: string } = {},
  ): Promise<boolean> {
    return dialogAsk(message, {
      title: options.title ?? 'HoTTY',
      kind: 'warning',
      okLabel: options.okLabel,
      cancelLabel: options.cancelLabel,
    });
  },

  /**
   * Open an external URL in the user's default app.
   *
   * Curated destinations (HoTTY's repo, gcloud install docs, GPL license,
   * Gemini OAuth) open immediately. Anything else triggers a native confirm
   * dialog on the backend before the URL is handed to the system opener.
   */
  async openExternal(url: string): Promise<void> {
    await invoke('open_external', { url });
  },

  // -----------------------------------------------------------------------
  // Updater
  // -----------------------------------------------------------------------

  async checkForUpdates(): Promise<UpdateInfo | null> {
    return invoke<UpdateInfo | null>('check_for_updates');
  },

  // -----------------------------------------------------------------------
  // Event listeners
  // -----------------------------------------------------------------------

  onSessionData(cb: (p: SessionDataPayload) => void): Promise<UnlistenFn> {
    return listen<SessionDataPayload>('session-data', (e) => cb(e.payload));
  },

  onSessionStatus(cb: (p: SessionStatusPayload) => void): Promise<UnlistenFn> {
    return listen<SessionStatusPayload>('session-status', (e) => cb(e.payload));
  },

  /** Coarse GCP/IAP connect-phase progress for the New Session dialog spinner. */
  onIapConnectProgress(
    cb: (p: IapConnectProgressPayload) => void
  ): Promise<UnlistenFn> {
    return listen<IapConnectProgressPayload>('iap-connect-progress', (e) =>
      cb(e.payload)
    );
  },

  onSessionPtySize(cb: (p: SessionPtySizePayload) => void): Promise<UnlistenFn> {
    return listen<SessionPtySizePayload>('session-pty-size', (e) => cb(e.payload));
  },

  onSessionError(cb: (p: SessionErrorPayload) => void): Promise<UnlistenFn> {
    return listen<SessionErrorPayload>('session-error', (e) => cb(e.payload));
  },

  onSshHostKeyPrompt(
    cb: (p: SshHostKeyPromptPayload) => void
  ): Promise<UnlistenFn> {
    return listen<SshHostKeyPromptPayload>('ssh-host-key-prompt', (e) =>
      cb(e.payload)
    );
  },

  /**
   * Session-scoped warning emitted when an accepted SSH host key could not be
   * persisted to known_hosts (the key won't be remembered, so the user will be
   * re-prompted next connect). Payload is a human-readable English message.
   */
  onSshKnownHostsWarning(cb: (message: string) => void): Promise<UnlistenFn> {
    return listen<string>('ssh-known-hosts-warning', (e) => cb(e.payload));
  },

  // -----------------------------------------------------------------------
  // AI
  // -----------------------------------------------------------------------

  async aiAuthStart(credentials: Record<string, unknown>): Promise<boolean> {
    return invoke<boolean>('ai_auth_start', { credentials });
  },

  async aiAuthAuto(credentials: Record<string, unknown>): Promise<boolean> {
    return invoke<boolean>('ai_auth_auto', { credentials });
  },

  async aiAuthStatus(): Promise<AIAuthStatus> {
    return invoke<AIAuthStatus>('ai_auth_status');
  },

  async aiAuthLogout(): Promise<void> {
    await invoke('ai_auth_logout');
  },

  async aiChatSend(
    sessionId: string,
    message: string,
    model: string,
    systemInstruction?: string,
    images?: ChatImage[],
  ): Promise<void> {
    const messageLen = message.length;
    const imageCount = images?.length ?? 0;
    const hasWatchPrefix = message.startsWith('[Watched Terminal Output')
      || message.startsWith('Terminal Output (Command:');
    // Log counts only — never the base64 image bytes.
    const sendInfo = `send-to-ai ${JSON.stringify({ paneId: sessionId, messageLen, imageCount, hasWatchPrefix })}`;
    console.debug(`[AIExec/info] ${sendInfo}`);
    Promise.resolve(invoke('log_debug', { level: 'info', category: 'AIExec', message: redactSensitive(sendInfo) })).catch(() => {});
    try {
      await invoke('ai_chat_send', {
        sessionId,
        message,
        model,
        systemInstruction: systemInstruction ?? null,
        images: images && images.length > 0 ? images : null,
      });
    } catch (e) {
      const errStr = typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);
      const rejInfo = `ai-send-rejected ${JSON.stringify({ messageLen, imageCount, error: errStr })}`;
      console.warn(`[AIExec/warn] ${rejInfo}`);
      Promise.resolve(invoke('log_debug', { level: 'warn', category: 'AIExec', message: redactSensitive(rejInfo) })).catch(() => {});
      throw e;
    }
  },

  async aiChatCancel(sessionId: string): Promise<void> {
    await invoke('ai_chat_cancel', { sessionId });
  },

  async aiChatClear(sessionId: string): Promise<void> {
    await invoke('ai_chat_clear', { sessionId });
  },

  /**
   * One-shot command-safety classification (history-less). Used by the hybrid
   * auto-execution gate to judge whether a command modifies state. Rejects (and
   * the caller falls back to manual) when the provider is unauthenticated, the
   * call times out, or the provider doesn't support classification.
   */
  async aiClassifyCommand(command: string, model: string): Promise<CommandVerdict> {
    return invoke<CommandVerdict>('ai_classify_command', { command, model });
  },

  async aiListModels(): Promise<AIModelInfo[]> {
    return invoke<AIModelInfo[]>('ai_list_models');
  },

  async aiListLocations(): Promise<string[]> {
    return invoke<string[]>('ai_list_locations');
  },

  async aiSetProvider(providerId: string): Promise<void> {
    await invoke('ai_set_provider', { providerId });
  },

  async aiSetLocation(location: string): Promise<void> {
    await invoke('ai_set_location', { location });
  },

  async selectServiceAccountKeyFile(): Promise<string | null> {
    return invoke<string | null>('select_service_account_key_file');
  },

  // -----------------------------------------------------------------------
  // AI Event listeners
  // -----------------------------------------------------------------------

  onAiChatResponse(cb: (p: AIChatResponseData) => void): Promise<UnlistenFn> {
    return listen<AIChatResponseData>('ai-chat-response', (e) => cb(e.payload));
  },

  onAiAuthResult(cb: (p: AIAuthResultPayload) => void): Promise<UnlistenFn> {
    return listen<AIAuthResultPayload>('ai-auth-result', (e) => cb(e.payload));
  },

  /** Explicit logout broadcast (all windows). Distinct from a failed sign-in. */
  onAiAuthLogout(cb: () => void): Promise<UnlistenFn> {
    return listen<void>('ai-auth-logout', () => cb());
  },
};
