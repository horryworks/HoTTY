import { useCallback, useEffect, useRef, useState } from 'react';
import { tauriService } from '../services/tauriService';
import { logError } from '../utils/logger';
import i18n from '../i18n';
import { recallPaneMemory, rememberPaneMemory, useRememberPane } from './usePaneMemory';
import type { PingResult } from '../types/appTypes';

export const MAX_HISTORY = 60;

interface PingMonitorEventData {
  latestResults: Map<string, PingResult>;
  /** The last MAX_HISTORY results per target, oldest first. */
  history: Map<string, PingResult[]>;
  logFileName: string | null;
  /** Forget the file name, e.g. when recording is turned off. */
  clearLogFileName: () => void;
}

export function usePingMonitorEvents(sessionId: string): PingMonitorEventData {
  // Kept across remounts: the monitor keeps running while its tab is hidden.
  const [latestResults, setLatestResults] = useState<Map<string, PingResult>>(() => recallPaneMemory(sessionId, 'ping.latest', new Map()));
  const [logFileName, setLogFileName] = useState<string | null>(() => recallPaneMemory(sessionId, 'ping.logFile', null));
  const [history, setHistory] = useState<Map<string, PingResult[]>>(() => recallPaneMemory(sessionId, 'ping.history', new Map()));
  const historyRef = useRef<Map<string, PingResult[]>>(recallPaneMemory(sessionId, 'ping.historyRef', new Map()));
  useRememberPane(sessionId, { 'ping.latest': latestResults, 'ping.logFile': logFileName, 'ping.history': history });

  useEffect(() => {
    let cancelled = false;
    let dataUnlisten: (() => void) | null = null;
    let logUnlisten: (() => void) | null = null;

    const setup = async () => {
      const data = await tauriService.onPingMonitorData((payload) => {
        if (cancelled || payload.sessionId !== sessionId) return;
        // The backend emits a complete snapshot of the current targets every
        // cycle, so rebuild the map from the payload rather than merging into
        // the previous state. This drops rows for targets that were removed —
        // otherwise their stale results would linger forever.
        const next = new Map<string, PingResult>();
        const seen = new Set<string>();
        for (const result of payload.results) {
          next.set(result.target, result);
          seen.add(result.target);
          // Update history
          const past = historyRef.current.get(result.target) ?? [];
          past.push(result);
          if (past.length > MAX_HISTORY) past.shift();
          historyRef.current.set(result.target, past);
        }
        // Prune history for targets no longer present in the snapshot.
        for (const key of Array.from(historyRef.current.keys())) {
          if (!seen.has(key)) historyRef.current.delete(key);
        }
        setLatestResults(next);
        rememberPaneMemory(sessionId, 'ping.historyRef', historyRef.current);
        // A fresh Map (and fresh arrays) so the table re-renders; the ref keeps
        // the running copy between events.
        setHistory(new Map(Array.from(historyRef.current, ([k, v]) => [k, [...v]])));
      });
      // If the effect was already torn down while this subscribe was in flight,
      // unlisten immediately instead of leaking the listener.
      if (cancelled) data();
      else dataUnlisten = data;

      const logFile = await tauriService.onPingMonitorLogFile((payload) => {
        if (cancelled || payload.sessionId !== sessionId) return;
        setLogFileName(payload.fileName);
      });
      if (cancelled) logFile();
      else logUnlisten = logFile;
    };

    setup().catch((e) => {
      logError('PingMonitor', i18n.t('notifications.errors.pingMonitorListener'), e);
    });

    return () => {
      cancelled = true;
      dataUnlisten?.();
      logUnlisten?.();
    };
  }, [sessionId, setLatestResults, setHistory, setLogFileName]);

  const clearLogFileName = useCallback(() => setLogFileName(null), [setLogFileName]);

  return { latestResults, history, logFileName, clearLogFileName };
}
