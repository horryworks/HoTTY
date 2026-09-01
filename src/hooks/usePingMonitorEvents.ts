import { useEffect, useRef, useState } from 'react';
import { tauriService } from '../services/tauriService';
import { logError } from '../utils/logger';
import i18n from '../i18n';
import type { PingResult } from '../types/appTypes';

const MAX_HISTORY = 60;

interface PingMonitorEventData {
  latestResults: Map<string, PingResult>;
  logFileName: string | null;
}

export function usePingMonitorEvents(sessionId: string): PingMonitorEventData {
  const [latestResults, setLatestResults] = useState<Map<string, PingResult>>(new Map());
  const [logFileName, setLogFileName] = useState<string | null>(null);
  const historyRef = useRef<Map<string, PingResult[]>>(new Map());

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
          const history = historyRef.current.get(result.target) ?? [];
          history.push(result);
          if (history.length > MAX_HISTORY) history.shift();
          historyRef.current.set(result.target, history);
        }
        // Prune history for targets no longer present in the snapshot.
        for (const key of Array.from(historyRef.current.keys())) {
          if (!seen.has(key)) historyRef.current.delete(key);
        }
        setLatestResults(next);
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
  }, [sessionId]);

  return { latestResults, logFileName };
}
