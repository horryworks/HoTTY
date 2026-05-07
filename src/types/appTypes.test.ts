import { describe, it, expect } from 'vitest';
import type {
  ProtocolId,
  FeatureId,
  Encoding,
  LayoutMode,
  SessionStatus,
  SshConnectionConfig,
  TelnetConnectionConfig,
  SerialConnectionConfig,
  WslConnectionConfig,
  LocalConnectionConfig,
  SshHostKeyPromptPayload,
  Theme,
  HostEntry,
  HostTreeNode,
  TextEditorTab,
  AIAuthType,
  AIChatResponseData,
  CommandExecutionMode,
  PersonaDefinition,
  UpdateInfo,
} from './appTypes';

// These are compile-time type assertions. If any of the listed union members
// or interface shapes drift, `tsc` will fail this file before vitest even runs.

describe('appTypes', () => {
  it('ProtocolId accepts every declared member', () => {
    const values: ProtocolId[] = ['ssh', 'telnet', 'serial', 'wsl', 'cmd', 'powershell', 'git-bash'];
    expect(values).toHaveLength(7);
  });

  it('FeatureId accepts every declared member', () => {
    const values: FeatureId[] = ['ai-chat', 'log-viewer', 'ping-monitor', 'text-editor', 'file-explorer'];
    expect(values).toHaveLength(5);
  });

  it('Encoding accepts every declared member', () => {
    const values: Encoding[] = ['utf8', 'shift_jis', 'euc-jp'];
    expect(values).toHaveLength(3);
  });

  it('LayoutMode accepts every declared member', () => {
    const values: LayoutMode[] = ['1x1', '1x2', '2x1', '2x2', '2x3', '3x2'];
    expect(values).toHaveLength(6);
  });

  it('SessionStatus accepts every declared member', () => {
    const values: SessionStatus[] = ['connected', 'disconnected'];
    expect(values).toHaveLength(2);
  });

  it('AIAuthType accepts every declared member', () => {
    const values: AIAuthType[] = ['oauth2', 'service_account', 'api_key', 'adc'];
    expect(values).toHaveLength(4);
  });

  it('CommandExecutionMode accepts every declared member', () => {
    const values: CommandExecutionMode[] = ['ask-before-execute', 'auto-execute-safe'];
    expect(values).toHaveLength(2);
  });

  it('SshConnectionConfig requires username and extends BaseConnectionConfig', () => {
    const cfg: SshConnectionConfig = {
      host: 'example.com',
      port: 22,
      username: 'alice',
      encoding: 'utf8',
      keepaliveIntervalSecs: 60,
      connectTimeoutSecs: 3,
    };
    expect(cfg.username).toBe('alice');
    expect(cfg.port).toBe(22);
  });

  it('TelnetConnectionConfig has BaseConnectionConfig shape (username optional)', () => {
    const cfg: TelnetConnectionConfig = {
      host: 'example.com',
      port: 23,
      encoding: 'utf8',
      keepaliveIntervalSecs: 0,
      connectTimeoutSecs: 3,
    };
    expect(cfg.host).toBe('example.com');
  });

  it('SerialConnectionConfig uses string-typed bit fields', () => {
    const cfg: SerialConnectionConfig = {
      path: 'COM3',
      baudRate: 9600,
      dataBits: '8',
      parity: 'none',
      stopBits: '1',
      flowControl: 'none',
      encoding: 'utf8',
    };
    expect(cfg.baudRate).toBe(9600);
  });

  it('WslConnectionConfig allows omitting distribution', () => {
    const cfg: WslConnectionConfig = { encoding: 'utf8' };
    expect(cfg.distribution).toBeUndefined();
  });

  it('LocalConnectionConfig accepts every shellType', () => {
    const shells: LocalConnectionConfig['shellType'][] = ['cmd', 'powershell', 'git-bash'];
    expect(shells).toHaveLength(3);
  });

  it('SshHostKeyPromptPayload.kind is restricted to "new" | "changed"', () => {
    const payload: SshHostKeyPromptPayload = {
      sessionId: 's1',
      host: 'h',
      port: 22,
      keyType: 'ssh-ed25519',
      fingerprint: 'SHA256:abc',
      kind: 'new',
    };
    expect(payload.kind).toBe('new');
  });

  it('TextEditorTab.lineEnding is restricted to "LF" | "CRLF"', () => {
    const lf: TextEditorTab = {
      id: '1',
      filePath: null,
      content: '',
      savedContent: '',
      encoding: 'utf-8',
      lineEnding: 'LF',
    };
    const crlf: TextEditorTab['lineEnding'] = 'CRLF';
    expect(lf.lineEnding).toBe('LF');
    expect(crlf).toBe('CRLF');
  });

  it('Theme exposes variables map and terminal colors', () => {
    const theme: Theme = {
      name: 'test',
      variables: { '--accent-color': '#000' },
      terminal: {
        foreground: '#fff',
        background: '#000',
        backgroundInactive: '#111',
        paneBackground: '#222',
      },
    };
    expect(theme.variables['--accent-color']).toBe('#000');
    expect(theme.terminal.foreground).toBe('#fff');
  });

  it('HostEntry.protocol is restricted to "ssh" | "telnet"', () => {
    const entry: HostEntry = { protocol: 'ssh', host: 'h', port: 22 };
    expect(entry.protocol).toBe('ssh');
  });

  it('HostTreeNode supports recursive children', () => {
    const node: HostTreeNode = {
      id: 'root',
      type: 'folder',
      name: 'root',
      children: [
        { id: 'h1', type: 'host', name: 'host1', entry: { protocol: 'telnet', host: 'h', port: 23 } },
      ],
    };
    expect(node.children?.[0]?.entry?.protocol).toBe('telnet');
  });

  it('AIChatResponseData.usageMetadata is optional', () => {
    const data: AIChatResponseData = {
      sessionId: 's',
      responseType: 'chunk',
      content: 'hello',
    };
    expect(data.usageMetadata).toBeUndefined();
  });

  it('PersonaDefinition carries askAiCommands list', () => {
    const persona: PersonaDefinition = {
      id: 'p',
      label: 'General',
      systemPrompt: 'You are helpful.',
      askAiCommands: [{ id: 'c', label: 'Explain', promptTemplate: 'Explain: {selection}' }],
    };
    expect(persona.askAiCommands).toHaveLength(1);
  });

  it('UpdateInfo has isNewer flag', () => {
    const info: UpdateInfo = {
      currentVersion: '2.0.0',
      latestVersion: '2.0.1',
      releaseName: 'v2.0.1',
      releaseUrl: 'https://example.com',
      prerelease: false,
      notes: '',
      isNewer: true,
    };
    expect(info.isNewer).toBe(true);
  });
});
