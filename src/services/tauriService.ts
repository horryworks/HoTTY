import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  readText as clipboardReadText,
  writeText as clipboardWriteText,
} from '@tauri-apps/plugin-clipboard-manager';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { ask as dialogAsk } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import type {
  ProtocolId,
  SshConnectionConfig,
  TelnetConnectionConfig,
  SerialConnectionConfig,
  WslConnectionConfig,
  LocalConnectionConfig,
  SessionDataPayload,
  SessionStatusPayload,
  SessionErrorPayload,
  SshHostKeyPromptPayload,
  SerialPortInfo,
  FontInfo,
  ContextMenuItem,
  Theme,
  SshAlgorithms,
  SaveThemeResult,
  ListLogFilesResult,
  ReadLogFileResult,
  ExportHtreeResult,
  ReadFileResult,
  ListDirectoryResult,
  GetDrivesResult,
  PingDataPayload,
  PingLogFilePayload,
  GcloudStatus,
  GcloudAuthStatus,
  GcpProject,
  GceInstance,
  AIAuthStatus,
  AIModelInfo,
  AIChatResponseData,
  AIAuthResultPayload,
  UpdateInfo,
} from '../types/appTypes';

type AnyConfig =
  | SshConnectionConfig
  | TelnetConnectionConfig
  | SerialConnectionConfig
  | WslConnectionConfig
  | LocalConnectionConfig;

const CLIPBOARD_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Check if a credential string is encrypted (DPAPI or SAFE format).
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith('[DPAPI]') || value.startsWith('[SAFE]');
}

export const tauriService = {
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
    await invoke('log_debug', { level, category, message });
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

  // -----------------------------------------------------------------------
  // Text editor
  // -----------------------------------------------------------------------

  async textEditorOpenFile(): Promise<string | null> {
    return invoke<string | null>('text_editor_open_file');
  },

  async textEditorSaveFile(defaultPath?: string): Promise<string | null> {
    return invoke<string | null>('text_editor_save_file', { defaultPath: defaultPath ?? null });
  },

  async textEditorReadFile(filePath: string, encoding: string): Promise<ReadFileResult> {
    return invoke<ReadFileResult>('text_editor_read_file', { filePath, encoding });
  },

  async textEditorWriteFile(filePath: string, content: string, encoding: string): Promise<boolean> {
    return invoke<boolean>('text_editor_write_file', { filePath, content, encoding });
  },

  async textEditorApproveDroppedFile(filePath: string): Promise<boolean> {
    return invoke<boolean>('text_editor_approve_dropped_file', { filePath });
  },

  // -----------------------------------------------------------------------
  // File explorer
  // -----------------------------------------------------------------------

  async fileExplorerListDirectory(dirPath: string): Promise<ListDirectoryResult> {
    return invoke<ListDirectoryResult>('file_explorer_list_directory', { dirPath });
  },

  async fileExplorerGetDrives(): Promise<GetDrivesResult> {
    return invoke<GetDrivesResult>('file_explorer_get_drives');
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
  // GCE IAP Tunnel
  // -----------------------------------------------------------------------

  async gceIapCheckGcloud(): Promise<GcloudStatus> {
    return invoke<GcloudStatus>('gce_iap_check_gcloud');
  },

  async gceIapCheckAuth(): Promise<GcloudAuthStatus> {
    return invoke<GcloudAuthStatus>('gce_iap_check_auth');
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

  // -----------------------------------------------------------------------
  // App info
  // -----------------------------------------------------------------------

  async getAppVersion(): Promise<string> {
    return getVersion();
  },

  async setWindowTitle(title: string): Promise<void> {
    await getCurrentWebviewWindow().setTitle(title);
  },

  async onWindowCloseRequested(
    handler: (preventDefault: () => void) => void | Promise<void>,
  ): Promise<UnlistenFn> {
    return getCurrentWebviewWindow().onCloseRequested(async (event) => {
      await handler(() => event.preventDefault());
    });
  },

  async destroyWindow(): Promise<void> {
    await getCurrentWebviewWindow().destroy();
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

  async openExternal(url: string): Promise<void> {
    await openUrl(url);
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
  ): Promise<void> {
    const messageLen = message.length;
    const hasWatchPrefix = message.startsWith('[Watched Terminal Output')
      || message.startsWith('Terminal Output (Command:');
    const sendInfo = `send-to-ai ${JSON.stringify({ paneId: sessionId, messageLen, hasWatchPrefix })}`;
    console.debug(`[AIExec/info] ${sendInfo}`);
    Promise.resolve(invoke('log_debug', { level: 'info', category: 'AIExec', message: sendInfo })).catch(() => {});
    try {
      await invoke('ai_chat_send', { sessionId, message, model, systemInstruction: systemInstruction ?? null });
    } catch (e) {
      const errStr = typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);
      const rejInfo = `ai-send-rejected ${JSON.stringify({ messageLen, error: errStr })}`;
      console.warn(`[AIExec/warn] ${rejInfo}`);
      Promise.resolve(invoke('log_debug', { level: 'warn', category: 'AIExec', message: rejInfo })).catch(() => {});
      throw e;
    }
  },

  async aiChatCancel(sessionId: string): Promise<void> {
    await invoke('ai_chat_cancel', { sessionId });
  },

  async aiChatClear(sessionId: string): Promise<void> {
    await invoke('ai_chat_clear', { sessionId });
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
};
