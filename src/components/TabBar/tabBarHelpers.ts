import type { SessionRecord } from '../../hooks/useSessionManager';
import type { ProtocolId } from '../../types/appTypes';
import type { FeaturePaneInfo, FeaturePaneType } from '../../utils/paneTypes';

export interface TabItem {
  id: string;
  displayName: string;
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
