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

/**
 * Keep a shared `persist` store consistent across windows in the single process.
 *
 * Two windows share one localStorage origin, so without coordination the later
 * writer clobbers the earlier window's whole persisted blob (data loss, not just
 * staleness). Here, each local mutation forwards the exact localStorage value to
 * the other windows (debounced), and a received change is applied by writing
 * localStorage and rehydrating — guarded so it never echoes back.
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

  const unsubscribe = store.subscribe(() => {
    if (applyingRemote) return; // don't re-broadcast a change we just received
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const raw = localStorage.getItem(storageKey);
      if (raw != null) void tauriService.broadcastSharedChange(storageKey, raw);
    }, debounceMs);
  });

  void tauriService
    .onSharedStoreChanged(({ channel, payload, origin }) => {
      if (origin === WINDOW_LABEL || channel !== storageKey) return;
      if (localStorage.getItem(storageKey) === payload) return; // already in sync
      applyingRemote = true;
      localStorage.setItem(storageKey, payload);
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
