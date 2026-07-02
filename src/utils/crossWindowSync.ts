import { tauriService } from '../services/tauriService';
import { WINDOW_LABEL } from './windowLabel';

/**
 * Minimal shape of a Zustand `persist` store needed for cross-window sync:
 * `subscribe` to observe local mutations and `persist.rehydrate` to re-read
 * the (just-updated) localStorage value into in-memory state.
 */
export interface SyncableStore {
  subscribe: (listener: () => void) => () => void;
  persist: { rehydrate: () => void | Promise<void> };
}

/** The Zustand `persist` blob stored in localStorage: `{ state, version }`. */
interface PersistBlob {
  state?: Record<string, unknown>;
  version?: number;
}

/** A field-level diff broadcast to the other windows. */
interface StateDelta {
  changed: Record<string, unknown>;
  removed: string[];
}

function parseBlob(raw: string | null): PersistBlob {
  if (raw == null) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as PersistBlob;
  } catch {
    /* corrupt blob — treat as empty */
  }
  return {};
}

/** The persisted `state` object (a shallow copy), or `{}` if absent/corrupt. */
function stateOf(raw: string | null): Record<string, unknown> {
  const blob = parseBlob(raw);
  return blob.state && typeof blob.state === 'object' ? { ...blob.state } : {};
}

function jsonEq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Top-level field diff between two persisted-state snapshots. */
function diffState(prev: Record<string, unknown>, next: Record<string, unknown>): StateDelta {
  const changed: Record<string, unknown> = {};
  const removed: string[] = [];
  for (const k of Object.keys(next)) {
    if (!jsonEq(prev[k], next[k])) changed[k] = next[k];
  }
  for (const k of Object.keys(prev)) {
    if (!(k in next)) removed.push(k);
  }
  return { changed, removed };
}

function isEmptyDelta(d: StateDelta): boolean {
  return Object.keys(d.changed).length === 0 && d.removed.length === 0;
}

/**
 * Keep a shared `persist` store consistent across windows in the single process.
 *
 * All windows are one origin sharing ONE localStorage, which breaks naïve sync
 * two ways: (1) a whole-blob "last writer wins" broadcast lets a window with a
 * stale in-memory copy clobber another window's field on its next persist, and
 * (2) a receiver can't detect "new data" by comparing bytes, because the shared
 * localStorage already holds the new value — so it would skip updating its own
 * in-memory state and the UI never reflects the change.
 *
 * This syncs at **field granularity**: each local mutation broadcasts only the
 * top-level persisted keys that actually changed; a received delta is MERGED
 * into the shared blob (untouched fields preserved) and then the store is
 * rehydrated unconditionally so this window's in-memory state — what the UI
 * reads — actually updates. Concurrent edits to *different* fields converge
 * instead of one clobbering the other. Echoes are suppressed via `applyingRemote`.
 *
 * No-op outside Tauri; call sites gate on `IS_TAURI`. Returns a disposer.
 */
export function syncStoreAcrossWindows(
  store: SyncableStore,
  storageKey: string,
  debounceMs = 150,
): () => void {
  let applyingRemote = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unlistenFn: (() => void) | null = null;
  let disposed = false;

  // Snapshot of the persisted state we last reconciled, so a local change can be
  // diffed down to only the fields that actually changed.
  let lastKnownState = stateOf(localStorage.getItem(storageKey));

  const unsubscribe = store.subscribe(() => {
    if (applyingRemote) return; // don't re-broadcast a change we just received
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const next = stateOf(localStorage.getItem(storageKey));
      const delta = diffState(lastKnownState, next);
      lastKnownState = next;
      if (isEmptyDelta(delta)) return;
      void tauriService.broadcastSharedChange(storageKey, JSON.stringify(delta));
    }, debounceMs);
  });

  void tauriService
    .onSharedStoreChanged(({ channel, payload, origin }) => {
      if (origin === WINDOW_LABEL || channel !== storageKey) return;

      let delta: StateDelta;
      try {
        const parsed = JSON.parse(payload);
        delta = {
          changed:
            parsed && typeof parsed.changed === 'object' && parsed.changed ? parsed.changed : {},
          removed: Array.isArray(parsed?.removed) ? parsed.removed : [],
        };
      } catch {
        return; // malformed delta — ignore rather than corrupt local state
      }
      if (isEmptyDelta(delta)) return;

      // Merge the delta into the SHARED localStorage blob — preserving `version`
      // and every field this delta doesn't touch (the clobber fix) — then
      // rehydrate so THIS window's in-memory store (what the UI reads) updates.
      const blob = parseBlob(localStorage.getItem(storageKey));
      const state = blob.state && typeof blob.state === 'object' ? { ...blob.state } : {};
      for (const [k, v] of Object.entries(delta.changed)) state[k] = v;
      for (const k of delta.removed) delete state[k];
      blob.state = state;
      localStorage.setItem(storageKey, JSON.stringify(blob));
      lastKnownState = { ...state };

      applyingRemote = true;
      // rehydrate() sets state synchronously (firing subscribe while the guard is
      // still up); clear the guard once its promise settles.
      void Promise.resolve(store.persist.rehydrate()).finally(() => {
        applyingRemote = false;
      });
    })
    .then((un) => {
      if (disposed) un();
      else unlistenFn = un;
    })
    .catch(() => {
      /* listen() unavailable (e.g. tests) — sync stays a no-op */
    });

  return () => {
    disposed = true;
    unsubscribe();
    if (timer) clearTimeout(timer);
    if (unlistenFn) unlistenFn();
  };
}
