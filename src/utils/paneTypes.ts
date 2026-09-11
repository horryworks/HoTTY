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
  /**
   * A name that overrides the label belonging to `type`. Only a Web Browser
   * pane sets one — the host of the site it is showing — and it goes back to
   * `undefined` when there is no site.
   *
   * Left unset for every other pane on purpose. The generic name is a property
   * of the type, not of the pane, so it is resolved through `t()` at render
   * time; storing the English name here is what used to leave a Japanese UI
   * with a "Log Viewer" tab hanging off a translated Features menu.
   */
  displayName?: string;
}

const FEATURE_PREFIXES: Record<FeaturePaneType, string> = {
  'log-viewer': 'lv-',
  'ping-monitor': 'pm-',
  'ai-chat': 'ai-',
  'file-server': 'fs-',
  'web-browser': 'wb-',
  'interface-traffic': 'if-',
};

/**
 * The `chrome.tabBar` translation key naming each feature pane type. The same
 * keys already label the Features menu that opens these panes, so a tab and the
 * menu entry that produced it now read the same in every language.
 */
export const FEATURE_LABEL_KEYS = {
  'log-viewer': 'chrome.tabBar.logViewer',
  'ping-monitor': 'chrome.tabBar.pingMonitor',
  'ai-chat': 'chrome.tabBar.aiChat',
  'file-server': 'chrome.tabBar.fileServer',
  'web-browser': 'chrome.tabBar.webBrowser',
  'interface-traffic': 'chrome.tabBar.interfaceTraffic',
  // `as const` keeps the values literal so `t()` still type-checks the key;
  // `satisfies` keeps the map exhaustive when a new pane type is added.
} as const satisfies Record<FeaturePaneType, string>;

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
