export type FeaturePaneType =
  | 'log-viewer'
  | 'ping-monitor'
  | 'ai-chat'
  | 'file-server'
  | 'web-browser'
  | 'interface-traffic';

type PaneContentType = 'session' | FeaturePaneType;

export interface FeaturePaneInfo {
  id: string;
  type: FeaturePaneType;
  displayName: string;
}

const FEATURE_PREFIXES: Record<FeaturePaneType, string> = {
  'log-viewer': 'lv-',
  'ping-monitor': 'pm-',
  'ai-chat': 'ai-',
  'file-server': 'fs-',
  'web-browser': 'wb-',
  'interface-traffic': 'if-',
};

const FEATURE_DISPLAY_NAMES: Record<FeaturePaneType, string> = {
  'log-viewer': 'Log Viewer',
  'ping-monitor': 'Ping Monitor',
  'ai-chat': 'AI Chat',
  'file-server': 'File Server',
  'web-browser': 'Web Browser',
  'interface-traffic': 'Interface Traffic',
};

export function makeFeaturePaneId(type: FeaturePaneType): string {
  const prefix = FEATURE_PREFIXES[type];
  return `${prefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getPaneContentType(id: string): PaneContentType {
  for (const [type, prefix] of Object.entries(FEATURE_PREFIXES)) {
    if (id.startsWith(prefix)) return type as FeaturePaneType;
  }
  return 'session';
}

export function isFeaturePane(id: string): boolean {
  return getPaneContentType(id) !== 'session';
}

export function getFeatureDisplayName(type: FeaturePaneType): string {
  return FEATURE_DISPLAY_NAMES[type];
}

/**
 * AI worker sessions: backend sessions the AI Chat opened on its own behalf that
 * have NO tab and NO xterm in this window (their output lives only in the
 * backend watch buffer). They carry a distinct id prefix so that (a) they can
 * never be mistaken for a pane/tab id, and (b) other windows' link pickers can
 * exclude them from `list_all_sessions`. `getPaneContentType` still reports
 * 'session' for them — a worker session that is later "materialized" into a real
 * tab keeps its id, so the id must remain a valid session id.
 */
export const WORKER_SESSION_PREFIX = 'h-';

export function makeWorkerSessionId(): string {
  return `${WORKER_SESSION_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isWorkerSessionId(id: string): boolean {
  return id.startsWith(WORKER_SESSION_PREFIX);
}
