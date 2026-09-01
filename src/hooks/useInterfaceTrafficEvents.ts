import { useEffect, useState } from 'react';
import { tauriService } from '../services/tauriService';
import { logError } from '../utils/logger';
import i18n from '../i18n';
import type { SnmpDataPayload, SnmpWatcherStatusState } from '../types/appTypes';

export interface InterfaceTrafficEventData {
  /** The most recent complete snapshot, or null before the first poll lands. */
  snapshot: SnmpDataPayload | null;
  /** Lifecycle state reported by the backend watcher. */
  watcherState: SnmpWatcherStatusState | null;
  /** Message that came with a `connecting`/`error` transition. */
  watcherMessage: string | null;
}

/**
 * Subscribe to one pane's SNMP watcher events.
 *
 * The backend emits a complete snapshot every cycle, so state is *replaced*
 * rather than merged — an interface that disappeared (line card pulled, SVI
 * deleted) must vanish from the table rather than linger with stale numbers.
 */
export function useInterfaceTrafficEvents(paneId: string): InterfaceTrafficEventData {
  const [snapshot, setSnapshot] = useState<SnmpDataPayload | null>(null);
  const [watcherState, setWatcherState] = useState<SnmpWatcherStatusState | null>(null);
  const [watcherMessage, setWatcherMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let dataUnlisten: (() => void) | null = null;
    let statusUnlisten: (() => void) | null = null;

    const setup = async () => {
      const data = await tauriService.onSnmpWatcherData((payload) => {
        // Events are broadcast to every window, so filter by pane id.
        if (cancelled || payload.paneId !== paneId) return;
        setSnapshot(payload);
      });
      // If the effect was torn down while this subscribe was in flight,
      // unlisten immediately instead of leaking the listener.
      if (cancelled) data();
      else dataUnlisten = data;

      const status = await tauriService.onSnmpWatcherStatus((payload) => {
        if (cancelled || payload.paneId !== paneId) return;
        setWatcherState(payload.state);
        setWatcherMessage(payload.message ?? null);
      });
      if (cancelled) status();
      else statusUnlisten = status;
    };

    setup().catch((e) => {
      logError('InterfaceTraffic', i18n.t('notifications.errors.trafficListener'), e);
    });

    return () => {
      cancelled = true;
      dataUnlisten?.();
      statusUnlisten?.();
    };
  }, [paneId]);

  return { snapshot, watcherState, watcherMessage };
}
