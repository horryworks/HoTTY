import { useEffect, useRef, useState } from 'react';
import { tauriService } from '../services/tauriService';
import { logError } from '../utils/logger';
import i18n from '../i18n';
import { recallPaneMemory, rememberPaneMemory, useRememberPane } from './usePaneMemory';
import type { SnmpDataPayload, SnmpWatcherStatusState } from '../types/appTypes';

/** How many polls of history each interface keeps for its graphs. */
export const TRAFFIC_HISTORY = 60;

/** One interface's recent rates, oldest first. `undefined` is a poll with no rate. */
export interface TrafficHistory {
  bpsIn: (number | undefined)[];
  bpsOut: (number | undefined)[];
}

export interface InterfaceTrafficEventData {
  /** The most recent complete snapshot, or null before the first poll lands. */
  snapshot: SnmpDataPayload | null;
  /** When `snapshot` arrived (ms since epoch), for the "next value in" countdown. */
  receivedAt: number | null;
  /** Recent rates per ifIndex. Cleared whenever the watcher (re)connects. */
  history: Map<number, TrafficHistory>;
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
 * The rate history is the one thing carried across polls.
 */
export function useInterfaceTrafficEvents(paneId: string): InterfaceTrafficEventData {
  // Kept across remounts: the watcher keeps polling while its tab is hidden.
  const [snapshot, setSnapshot] = useState<SnmpDataPayload | null>(() => recallPaneMemory(paneId, 'snmp.snapshot', null));
  const [receivedAt, setReceivedAt] = useState<number | null>(() => recallPaneMemory(paneId, 'snmp.receivedAt', null));
  const [history, setHistory] = useState<Map<number, TrafficHistory>>(() => recallPaneMemory(paneId, 'snmp.history', new Map()));
  const [watcherState, setWatcherState] = useState<SnmpWatcherStatusState | null>(() => recallPaneMemory(paneId, 'snmp.state', null));
  const [watcherMessage, setWatcherMessage] = useState<string | null>(() => recallPaneMemory(paneId, 'snmp.message', null));
  const historyRef = useRef<Map<number, TrafficHistory>>(recallPaneMemory(paneId, 'snmp.historyRef', new Map()));
  useRememberPane(paneId, { 'snmp.snapshot': snapshot, 'snmp.receivedAt': receivedAt, 'snmp.history': history, 'snmp.state': watcherState, 'snmp.message': watcherMessage });

  useEffect(() => {
    let cancelled = false;
    let dataUnlisten: (() => void) | null = null;
    let statusUnlisten: (() => void) | null = null;

    const setup = async () => {
      const data = await tauriService.onSnmpWatcherData((payload) => {
        // Events are broadcast to every window, so filter by pane id.
        if (cancelled || payload.paneId !== paneId) return;
        setSnapshot(payload);
        setReceivedAt(Date.now());
        // A poll that carried old rows over (the device did not answer) adds
        // nothing: repeating the last value would draw a flat line that looks
        // like real traffic.
        if (payload.staleForMs !== undefined || payload.status === 'error') return;
        const next = new Map<number, TrafficHistory>();
        for (const row of payload.interfaces) {
          const prev = historyRef.current.get(row.ifIndex);
          next.set(row.ifIndex, {
            bpsIn: [...(prev?.bpsIn ?? []), row.bpsIn].slice(-TRAFFIC_HISTORY),
            bpsOut: [...(prev?.bpsOut ?? []), row.bpsOut].slice(-TRAFFIC_HISTORY),
          });
        }
        historyRef.current = next;
        rememberPaneMemory(paneId, 'snmp.historyRef', next);
        setHistory(next);
      });
      // If the effect was torn down while this subscribe was in flight,
      // unlisten immediately instead of leaking the listener.
      if (cancelled) data();
      else dataUnlisten = data;

      const status = await tauriService.onSnmpWatcherStatus((payload) => {
        if (cancelled || payload.paneId !== paneId) return;
        setWatcherState(payload.state);
        setWatcherMessage(payload.message ?? null);
        if (payload.state === 'connecting') {
          // A new connection may be a different device: its ifIndex 1 is not
          // the old one's, so start the graphs and the table over.
          historyRef.current = new Map();
          rememberPaneMemory(paneId, 'snmp.historyRef', historyRef.current);
          setHistory(historyRef.current);
          setSnapshot(null);
          setReceivedAt(null);
        }
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
  }, [paneId, setSnapshot, setReceivedAt, setHistory, setWatcherState, setWatcherMessage]);

  return { snapshot, receivedAt, history, watcherState, watcherMessage };
}
