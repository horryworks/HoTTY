import type { SessionRecord } from '../../hooks/useSessionManager';
import type { ProtocolId } from '../../types/appTypes';
import type { FeaturePaneInfo, FeaturePaneType } from '../../utils/paneTypes';
import type { SidebarEdge } from '../../stores/sidebarLayoutStore';

export interface TabItem {
  id: string;
  /** A session tab always carries one. A feature tab carries one only when it
   *  overrides its type's translated label — a Web Browser pane showing a site.
   *  Otherwise TabBar resolves the label from `featureType` through `t()`. */
  displayName?: string;
  kind: 'session' | 'feature';
  status?: string;
  errorMessage?: string;
  featureType?: FeaturePaneType;
  isWatching?: boolean;
  /** Palette slot [0,5] of the conversation watching this terminal (for coloring). */
  watchColorIndex?: number;
  /** The conversation tab currently watching this terminal (for the "Watch in" picker). */
  watchOwnerTabId?: string;
  isAiTab?: boolean;
  protocol?: ProtocolId;
  /** Whether this session's grid is pinned to the device's connect-time width. */
  fixedSize?: boolean;
  /** The pinned width (device-latched pty cols); undefined until the connect-time
   *  `session-pty-size` event arrives. Gates the context-menu toggle's visibility. */
  ptyCols?: number;
  /** Second line of a session tab: what it is connected to ("SSH · host",
   *  "COM3 · 9600", the WSL distro, the shell). Not translated — protocol
   *  names and targets read the same in every language. */
  detail?: string;
}

/** A conversation of the singleton AI Chat pane, for the "Watch in ▸" picker.
 *  `title` is pre-resolved (with the "Tab N" fallback) so TabBar needs no aiChat i18n. */
export interface ConversationSummary {
  id: string;
  title: string;
  /** Palette slot [0,5] for the conversation's color (from its ordinal). */
  colorIndex: number;
}

/** Per-session watch info consumed for tab coloring/ownership: presence = watched,
 *  plus the owning conversation's color slot and tab id. Structurally matches the
 *  orchestrator's `WatchedSessionInfo` map. */
const NO_WATCHED: ReadonlyMap<string, { tabId?: string; colorIndex: number }> = new Map();

export function buildTabItems(
  sessions: SessionRecord[],
  featurePanes: FeaturePaneInfo[],
  sessionOrder: string[],
  watchedSessions: ReadonlyMap<string, { tabId?: string; colorIndex: number }> = NO_WATCHED
): TabItem[] {
  const sessionMap = new Map(sessions.map((s) => [s.id, s]));
  const featureMap = new Map(featurePanes.map((f) => [f.id, f]));

  const items: TabItem[] = [];
  for (const id of sessionOrder) {
    const session = sessionMap.get(id);
    if (session) {
      items.push({
        id: session.id,
        displayName: session.displayName,
        kind: 'session',
        status: session.status,
        errorMessage: session.errorMessage,
        isWatching: watchedSessions.has(session.id),
        watchColorIndex: watchedSessions.get(session.id)?.colorIndex,
        watchOwnerTabId: watchedSessions.get(session.id)?.tabId,
        protocol: session.protocol,
        fixedSize: session.fixedSize,
        ptyCols: session.ptyCols,
        detail: sessionDetail(session),
      });
      continue;
    }
    const feature = featureMap.get(id);
    if (feature) {
      items.push({
        id: feature.id,
        displayName: feature.displayName,
        kind: 'feature',
        featureType: feature.type,
        isAiTab: feature.type === 'ai-chat',
      });
    }
  }
  return items;
}

const PROTOCOL_LABEL: Record<ProtocolId, string> = {
  ssh: 'SSH',
  telnet: 'Telnet',
  serial: 'Serial',
  wsl: 'WSL',
  cmd: 'Command Prompt',
  powershell: 'PowerShell',
  'git-bash': 'Git Bash',
  'gcloud-iap': 'IAP',
};

/** What a session is connected to, for the tab's second line. Reads the
 *  connection config defensively — it is typed per protocol but a restored or
 *  AI-opened session may carry a partial one. */
export function sessionDetail(rec: Pick<SessionRecord, 'protocol' | 'connectionConfig'>): string {
  const label = PROTOCOL_LABEL[rec.protocol] ?? rec.protocol;
  const c = (rec.connectionConfig ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.length > 0 ? v : typeof v === 'number' ? String(v) : undefined;
  switch (rec.protocol) {
    case 'ssh':
    case 'telnet': {
      const host = str(c.host);
      return host ? `${label} · ${host}` : label;
    }
    case 'serial': {
      const path = str(c.path);
      const baud = str(c.baudRate);
      return [path ?? label, baud].filter(Boolean).join(' · ');
    }
    case 'wsl': {
      // No distribution means WSL's default one; say nothing rather than an
      // untranslated "default".
      const distro = str(c.distribution);
      return distro ? `${label} · ${distro}` : label;
    }
    case 'gcloud-iap': {
      const instance = str(c.instance);
      return instance ? `${label} · ${instance}` : label;
    }
    default:
      return label;
  }
}

/** The mark a pane carries in the tab list and in its own corner: a grid cell
 *  is numbered 1..6, an edge bar is named by its edge. */
export type PaneBadge =
  | { kind: 'grid'; index: number }
  | { kind: 'edge'; edge: SidebarEdge };

const EDGE_PANE = /^bar-(left|right|top|bottom)$/;

export function paneBadge(paneId: string): PaneBadge | null {
  if (/^\d+$/.test(paneId)) return { kind: 'grid', index: Number(paneId) };
  const m = EDGE_PANE.exec(paneId);
  return m ? { kind: 'edge', edge: m[1] as SidebarEdge } : null;
}

export interface PlacedTab {
  item: TabItem;
  paneId: string;
}

/**
 * Split the tab list into what is on screen and what is not. `visiblePanes`
 * is every pane the user can currently see, in visual order (grid first, then
 * the edge bars that are shown); the on-screen group follows that order so a
 * tab's position in the list matches its pane number. The rest keep their
 * `sessionOrder` position.
 */
export function groupTabs(
  items: TabItem[],
  visiblePanes: readonly string[],
  allocations: Readonly<Record<string, string | null>>
): { shown: PlacedTab[]; hidden: TabItem[] } {
  const byId = new Map(items.map((i) => [i.id, i]));
  const shown: PlacedTab[] = [];
  const placed = new Set<string>();
  for (const paneId of visiblePanes) {
    const id = allocations[paneId];
    const item = id ? byId.get(id) : undefined;
    if (!item || placed.has(item.id)) continue;
    shown.push({ item, paneId });
    placed.add(item.id);
  }
  return { shown, hidden: items.filter((i) => !placed.has(i.id)) };
}

/** Widths used to decide how many hidden tabs fit in a horizontal dock. */
const H_SHOWN_TAB_PX = 160;
const H_HIDDEN_TAB_PX = 150;
const H_HIDDEN_TAB_COMPACT_PX = 112;
const H_GROUP_LABELS_PX = 96;
const H_MORE_BUTTON_PX = 76;

/**
 * How many hidden tabs fit beside the shown ones in a horizontal dock of
 * `width` px. Shown tabs shrink before anything is dropped; hidden ones that do
 * not fit go into the "More" menu, which then takes room of its own.
 */
export function hiddenTabsThatFit(width: number, shown: number, hidden: number, compact: boolean): number {
  const each = compact ? H_HIDDEN_TAB_COMPACT_PX : H_HIDDEN_TAB_PX;
  const room = width - shown * H_SHOWN_TAB_PX - H_GROUP_LABELS_PX;
  let fit = Math.max(0, Math.floor(room / each));
  if (fit < hidden) fit = Math.max(0, Math.floor((room - H_MORE_BUTTON_PX) / each));
  return Math.min(fit, hidden);
}

/** The state dot at the end of a row. Feature panes have none. */
export type TabStateDot = 'ok' | 'connecting' | 'bad' | 'unread' | null;

export function tabStateDot(item: TabItem, unread: boolean): TabStateDot {
  if (item.kind !== 'session') return null;
  if (unread) return 'unread';
  if (item.status === 'connecting') return 'connecting';
  if (item.status === 'error' || item.status === 'disconnected') return 'bad';
  return 'ok';
}
