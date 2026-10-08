import { useEffect } from 'react';

// A tool pane is rendered only while its tab sits in a pane: moving the tab to
// the hidden group (or to another pane) unmounts it, while the backend monitor
// or server it started keeps running. This keeps such a pane's state between
// mounts, until the tab is closed (`forgetPaneMemory`).
//
// Usage: start each piece of state from `recallPaneMemory`, and hand the
// current values to `useRememberPane` once per render:
//
//   const [running, setRunning] = useState(() => recallPaneMemory(paneId, 'running', false));
//   useRememberPane(paneId, { running });
//
// Plain useState keeps the setters stable for the hooks lint and the compiler.
const memory = new Map<string, unknown>();

const slot = (paneId: string, key: string) => `${paneId}\u0000${key}`;

/** The remembered value for `key`, or `fallback` on a pane's first mount. */
export function recallPaneMemory<T>(paneId: string, key: string, fallback: T): T {
  const k = slot(paneId, key);
  return memory.has(k) ? (memory.get(k) as T) : fallback;
}

/** Store one value outside a render (for state kept in a ref). */
export function rememberPaneMemory<T>(paneId: string, key: string, value: T): void {
  memory.set(slot(paneId, key), value);
}

/** Remember the given values after every render. */
export function useRememberPane(paneId: string, values: Record<string, unknown>): void {
  useEffect(() => {
    for (const [key, value] of Object.entries(values)) memory.set(slot(paneId, key), value);
  });
}

/** Drop everything remembered for a pane. Called when its tab closes. */
export function forgetPaneMemory(paneId: string): void {
  const prefix = `${paneId}\u0000`;
  for (const k of Array.from(memory.keys())) {
    if (k.startsWith(prefix)) memory.delete(k);
  }
}

/** Drop everything. For tests, which reuse pane ids. */
export function clearAllPaneMemory(): void {
  memory.clear();
}
