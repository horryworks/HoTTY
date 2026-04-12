import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  readText as clipboardReadText,
  writeText as clipboardWriteText,
} from '@tauri-apps/plugin-clipboard-manager';
import type {
  ProtocolId,
  SshConnectionConfig,
  TelnetConnectionConfig,
  SessionDataPayload,
  SessionStatusPayload,
  SessionErrorPayload,
  SshHostKeyPromptPayload,
} from '../types/appTypes';

type AnyConfig = SshConnectionConfig | TelnetConnectionConfig;

const CLIPBOARD_MAX_BYTES = 10 * 1024 * 1024;

export const tauriService = {
  async connectSession(
    sessionId: string,
    protocol: ProtocolId,
    config: AnyConfig
  ): Promise<void> {
    await invoke('connect_session', { sessionId, protocol, config });
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

  async updateSessionEncoding(sessionId: string, encoding: string): Promise<void> {
    await invoke('update_session_encoding', { sessionId, encoding });
  },

  async writeClipboard(text: string): Promise<void> {
    if (typeof text !== 'string' || text.length === 0) return;
    if (text.length > CLIPBOARD_MAX_BYTES) return;
    await clipboardWriteText(text);
  },

  async readClipboard(): Promise<string> {
    const v = await clipboardReadText();
    return v ?? '';
  },

  async respondSshHostKey(
    sessionId: string,
    accept: boolean,
    remember: boolean
  ): Promise<void> {
    await invoke('ssh_host_key_response', { sessionId, accept, remember });
  },

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
};
