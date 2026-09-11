import { useEffect, useRef } from 'react';
import { tauriService } from '../services/tauriService';
import { IS_TAURI, WINDOW_LABEL } from '../utils/windowLabel';
import { sessionBindingKey } from '../utils/sessionBindingKey';
import {
  applySessionNames,
  buildSessionNames,
  parseSessionNames,
  sessionNamesEqual,
  SESSION_NAMES_CHANNEL,
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
 * removed or renamed, not on every render that touches the session map.
 */
export function useSessionNameShare(sessions: ReadonlyMap<string, SessionRecord>): void {
  const publishedRef = useRef<Record<string, SharedSessionName>>({});

  useEffect(() => {
    if (!IS_TAURI) return;
    const table: Record<string, SharedSessionName> = {};
    for (const rec of sessions.values()) {
      table[rec.id] = { displayName: rec.displayName, bindingKey: sessionBindingKey(rec) };
    }
    if (sessionNamesEqual(table, publishedRef.current)) return;
    publishedRef.current = table;
    void tauriService
      .broadcastSharedChange(SESSION_NAMES_CHANNEL, JSON.stringify(buildSessionNames(WINDOW_LABEL, table)))
      .catch(() => {
        /* names are a convenience — a failed broadcast just means the other
           window keeps showing the host until the next change. */
      });
  }, [sessions]);

  useEffect(() => {
    if (!IS_TAURI) return;
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void tauriService
      .onSharedStoreChanged(({ channel, payload, origin }) => {
        if (channel !== SESSION_NAMES_CHANNEL || origin === WINDOW_LABEL) return;
        const msg = parseSessionNames(payload);
        if (msg) applySessionNames(msg);
      })
      .then((un) => {
        if (disposed) un();
        else unlisten = un;
      })
      .catch(() => {
        /* listen() unavailable (tests) — names stay local */
      });
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, []);
}
