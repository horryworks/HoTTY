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
  isAiTab?: boolean;
  protocol?: ProtocolId;
  /** Whether this session's grid is pinned to the device's connect-time width. */
  fixedSize?: boolean;
  /** The pinned width (device-latched pty cols); undefined until the connect-time
   *  `session-pty-size` event arrives. Gates the context-menu toggle's visibility. */
  ptyCols?: number;
}

export function buildTabItems(
  sessions: SessionRecord[],
  featurePanes: FeaturePaneInfo[],
  sessionOrder: string[],
  watchingSessionId: string | null = null
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
        isWatching: session.id === watchingSessionId,
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
