export type ProtocolId = 'ssh' | 'telnet';

export type Encoding = 'utf8' | 'shift_jis' | 'euc-jp';

export type LayoutMode = '1x1' | '1x2' | '2x1' | '2x2' | '2x3' | '3x2';

export type SessionStatus = 'connected' | 'disconnected';

export interface BaseConnectionConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  encoding: Encoding;
  keepaliveIntervalSecs: number;
}

export interface SshConnectionConfig extends BaseConnectionConfig {
  username: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
}

export type TelnetConnectionConfig = BaseConnectionConfig;

export interface ConnectionRequest {
  protocol: ProtocolId;
  displayName: string;
  config: SshConnectionConfig | TelnetConnectionConfig;
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

export type ThemeId = 'dark' | 'medium' | 'light';

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
