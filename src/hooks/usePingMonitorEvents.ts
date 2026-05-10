import { useEffect, useRef, useState } from 'react';
import { tauriService } from '../services/tauriService';
import { logError } from '../utils/logger';
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
    let dataUnlisten: (() => void) | null = null;
    let logUnlisten: (() => void) | null = null;

    const setup = async () => {
      dataUnlisten = await tauriService.onPingMonitorData((payload) => {
        if (payload.sessionId !== sessionId) return;
        setLatestResults((prev) => {
          const next = new Map(prev);
          for (const result of payload.results) {
            next.set(result.target, result);
            // Update history
            const history = historyRef.current.get(result.target) ?? [];
            history.push(result);
            if (history.length > MAX_HISTORY) history.shift();
            historyRef.current.set(result.target, history);
          }
          return next;
        });
      });

      logUnlisten = await tauriService.onPingMonitorLogFile((payload) => {
        if (payload.sessionId !== sessionId) return;
        setLogFileName(payload.fileName);
      });
    };

    setup().catch((e) => {
      logError('PingMonitor', 'Failed to set up listeners', e);
    });

    return () => {
      dataUnlisten?.();
      logUnlisten?.();
    };
  }, [sessionId]);

  return { latestResults, logFileName };
}
