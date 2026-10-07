import { useEffect, useRef, useState } from 'react';
import { tauriService } from '../services/tauriService';
import { IS_TAURI, WINDOW_LABEL } from '../utils/windowLabel';
import { sessionBindingKey } from '../utils/sessionBindingKey';
import {
  applySessionNames,
  buildSessionNames,
  parseSessionNames,
  sessionNamesEqual,
  subscribeSessionNames,
  SESSION_NAMES_CHANNEL,
  SESSION_NAMES_REQUEST_CHANNEL,
  type SharedSessionName,
} from '../utils/sessionNameShare';
import type { SessionRecord } from './useSessionManager';

/**
 * Publish this window's terminal names, and take in every other window's.
 *
 * `list_all_sessions` carries only what the backend knows — host and protocol —
 * so a terminal watched from another window would otherwise read as a bare IP,
 * and a reconnect would never auto-rebind (that matches on the config-derived
 * `bindingKey`, which lives in the renderer). Both matter far more now that an
 * AI Chat window watches nothing BUT other windows' terminals.
 *
 * Publishing is change-gated: the table goes out when a session is added,
 * removed or renamed, not on every render that touches the session map — and
 * once more whenever another window asks (it has just started and missed
 * every table sent before it listened).
 *
 * Returns a counter that advances each time another window's table arrives,
 * so the caller re-renders whatever it derives from `remoteSessionName`.
 */
export function useSessionNameShare(sessions: ReadonlyMap<string, SessionRecord>): number {
  const publishedRef = useRef<Record<string, SharedSessionName>>({});
  const [arrivals, setArrivals] = useState(0);

  const publish = (table: Record<string, SharedSessionName>) => {
    void tauriService
      .broadcastSharedChange(SESSION_NAMES_CHANNEL, JSON.stringify(buildSessionNames(WINDOW_LABEL, table)))
      .catch(() => {
        /* names are a convenience — a failed broadcast just means the other
           window keeps showing the host until the next change. */
      });
  };

  useEffect(() => {
    if (!IS_TAURI) return;
    const table: Record<string, SharedSessionName> = {};
    for (const rec of sessions.values()) {
      table[rec.id] = { displayName: rec.displayName, bindingKey: sessionBindingKey(rec) };
    }
    if (sessionNamesEqual(table, publishedRef.current)) return;
    publishedRef.current = table;
    publish(table);
  }, [sessions]);

  useEffect(() => {
    if (!IS_TAURI) return;
    let unlisten: (() => void) | null = null;
    let disposed = false;
    const unsubscribe = subscribeSessionNames(() => setArrivals((n) => n + 1));
    void tauriService
      .onSharedStoreChanged(({ channel, payload, origin }) => {
        if (origin === WINDOW_LABEL) return;
        if (channel === SESSION_NAMES_REQUEST_CHANNEL) {
          // A newcomer asks: answer with the current table, changed or not.
          // An empty table is still an answer (it clears nothing the newcomer
          // could hold), but costs a broadcast for nothing, so skip it.
          if (Object.keys(publishedRef.current).length > 0) publish(publishedRef.current);
          return;
        }
        if (channel !== SESSION_NAMES_CHANNEL) return;
        const msg = parseSessionNames(payload);
        if (msg) applySessionNames(msg);
      })
      .then((un) => {
        if (disposed) {
          un();
          return;
        }
        unlisten = un;
        // Listening now — ask the windows that were here first for their tables.
        void tauriService
          .broadcastSharedChange(SESSION_NAMES_REQUEST_CHANNEL, JSON.stringify({ v: 1, from: WINDOW_LABEL }))
          .catch(() => {
            /* same as a failed table broadcast: names arrive on the next change */
          });
      })
      .catch(() => {
        /* listen() unavailable (tests) — names stay local */
      });
    return () => {
      disposed = true;
      unsubscribe();
      if (unlisten) unlisten();
    };
  }, []);

  return arrivals;
}
