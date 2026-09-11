/**
 * Sharing terminal display names (and binding keys) between windows.
 *
 * ## The gap this fills
 * `list_all_sessions` is the backend's view, and the backend only knows a
 * session's `host` and protocol. The NAME a user sees — a Host Tree entry's
 * label, a renamed tab — lives in the renderer that owns the terminal, and so
 * does the config-derived `bindingKey` that survives a reconnect.
 *
 * That was tolerable while cross-window links were an occasional thing. Once
 * AI Chat can live in its own window, EVERY terminal it watches is another
 * window's, so without this the chips would all read `192.168.1.1` instead of
 * `core-sw01`, and a reconnect would never re-link (auto-rebind matches on
 * `bindingKey`, which the backend has no idea about).
 *
 * ## How it works
 * Each window broadcasts its own `sessionId → { displayName, bindingKey }` table
 * whenever it changes, on the existing shared-store channel. Receivers keep the
 * latest table per window in a module-level registry, so a lookup is a map read
 * with no React involved — `sessionLookup` is called from event handlers and
 * async timers, not only from render.
 *
 * A window's entries are dropped when it publishes an empty table; a window that
 * closes takes its sessions with it, and the backend stops listing them, so a
 * stale entry can only ever be a name for a session nobody can reach.
 *
 * Names are not secrets: a display name is what the user already sees on the tab.
 * Nothing here carries hosts, credentials or config.
 */

/** One window's contribution to the shared name table. */
export interface SharedSessionName {
  displayName: string;
  bindingKey?: string;
}

export interface SessionNamesMessage {
  v: number;
  /** The window whose table this is. */
  from: string;
  names: Record<string, SharedSessionName>;
}

/** Channel carrying session-name tables between windows. */
export const SESSION_NAMES_CHANNEL = 'hotty-session-names';

/** Wire version; a receiver ignores anything it does not recognise. */
export const SESSION_NAMES_VERSION = 1;

export function buildSessionNames(from: string, names: Record<string, SharedSessionName>): SessionNamesMessage {
  return { v: SESSION_NAMES_VERSION, from, names };
}

/**
 * Parse a name table, or `null` if malformed. Never throws — this rides a
 * broadcast, and one bad message must not take down the listener.
 */
export function parseSessionNames(raw: string): SessionNamesMessage | null {
  let p: unknown;
  try {
    p = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const o = p as Record<string, unknown>;
  if (o.v !== SESSION_NAMES_VERSION) return null;
  if (typeof o.from !== 'string' || !o.from) return null;
  if (!o.names || typeof o.names !== 'object' || Array.isArray(o.names)) return null;
  const names: Record<string, SharedSessionName> = {};
  for (const [id, value] of Object.entries(o.names as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    if (typeof v.displayName !== 'string' || !v.displayName) continue;
    names[id] = {
      displayName: v.displayName,
      bindingKey: typeof v.bindingKey === 'string' && v.bindingKey ? v.bindingKey : undefined,
    };
  }
  return { v: SESSION_NAMES_VERSION, from: o.from, names };
}

// ── Registry ────────────────────────────────────────────────────────────────
// Module-level rather than a store: reads happen from event handlers, async
// timers and pure helpers, none of which have a React context to hand.

const byWindow = new Map<string, Record<string, SharedSessionName>>();
let merged = new Map<string, SharedSessionName>();
const listeners = new Set<() => void>();

function remerge(): void {
  const next = new Map<string, SharedSessionName>();
  for (const table of byWindow.values()) {
    for (const [id, name] of Object.entries(table)) next.set(id, name);
  }
  merged = next;
  for (const l of listeners) l();
}

/** Record (or replace) one window's table. */
export function applySessionNames(msg: SessionNamesMessage): void {
  if (Object.keys(msg.names).length === 0) byWindow.delete(msg.from);
  else byWindow.set(msg.from, msg.names);
  remerge();
}

/** Forget a window's names (it closed, or it has no sessions left). */
export function forgetWindowNames(label: string): void {
  if (!byWindow.delete(label)) return;
  remerge();
}

/** What another window calls this session, if any window has said. */
export function remoteSessionName(sessionId: string): SharedSessionName | undefined {
  return merged.get(sessionId);
}

/** Every shared name currently known, for callers that want the whole table. */
export function remoteSessionNames(): ReadonlyMap<string, SharedSessionName> {
  return merged;
}

/** Subscribe to changes in the shared table; returns an unsubscribe function. */
export function subscribeSessionNames(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Drop everything. Test-only; a running app never needs it. */
export function resetSessionNames(): void {
  byWindow.clear();
  merged = new Map();
  for (const l of listeners) l();
}

/**
 * Whether two name tables differ, so a window only broadcasts on real changes
 * rather than on every render that touches its session map.
 */
export function sessionNamesEqual(
  a: Record<string, SharedSessionName>,
  b: Record<string, SharedSessionName>,
): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const x = a[k];
    const y = b[k];
    if (!y || x.displayName !== y.displayName || x.bindingKey !== y.bindingKey) return false;
  }
  return true;
}
