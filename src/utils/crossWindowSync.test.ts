import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { syncStoreAcrossWindows, type SyncableStore } from './crossWindowSync';
import { tauriService } from '../services/tauriService';

// WINDOW_LABEL resolves to 'main' under Vitest (no Tauri internals), so remote
// events with origin !== 'main' are "from another window".

/** A Zustand `persist` blob as it lives in localStorage. */
function blob(state: Record<string, unknown>, version = 1): string {
  return JSON.stringify({ state, version });
}

/** A delta payload as broadcast between windows. */
function delta(changed: Record<string, unknown>, removed: string[] = []): string {
  return JSON.stringify({ changed, removed });
}

function makeFakeStore(rehydrate: () => void) {
  let listener: (() => void) | null = null;
  const store: SyncableStore & { fireChange: () => void } = {
    subscribe: (l) => {
      listener = l;
      return () => {
        listener = null;
      };
    },
    persist: { rehydrate },
    fireChange: () => listener?.(),
  };
  return store;
}

describe('syncStoreAcrossWindows', () => {
  let remoteCb: ((p: { channel: string; payload: string; origin: string }) => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    remoteCb = null;
    vi.spyOn(tauriService, 'broadcastSharedChange').mockResolvedValue(undefined);
    vi.spyOn(tauriService, 'onSharedStoreChanged').mockImplementation((cb) => {
      remoteCb = cb;
      return Promise.resolve(() => {});
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('broadcasts only the changed fields (delta) on a local change', () => {
    localStorage.setItem('k', blob({ a: 1, b: 2 }));
    const store = makeFakeStore(vi.fn());
    syncStoreAcrossWindows(store, 'k', 50);

    // A local mutation changes only `b`.
    localStorage.setItem('k', blob({ a: 1, b: 3 }));
    store.fireChange();
    expect(tauriService.broadcastSharedChange).not.toHaveBeenCalled(); // debounced
    vi.advanceTimersByTime(50);
    expect(tauriService.broadcastSharedChange).toHaveBeenCalledWith('k', delta({ b: 3 }));
  });

  it('broadcasts removed keys', () => {
    localStorage.setItem('k', blob({ a: 1, b: 2 }));
    const store = makeFakeStore(vi.fn());
    syncStoreAcrossWindows(store, 'k', 50);

    localStorage.setItem('k', blob({ a: 1 }));
    store.fireChange();
    vi.advanceTimersByTime(50);
    expect(tauriService.broadcastSharedChange).toHaveBeenCalledWith('k', delta({}, ['b']));
  });

  it('does not broadcast when nothing changed', () => {
    localStorage.setItem('k', blob({ a: 1 }));
    const store = makeFakeStore(vi.fn());
    syncStoreAcrossWindows(store, 'k', 50);

    store.fireChange(); // localStorage untouched
    vi.advanceTimersByTime(50);
    expect(tauriService.broadcastSharedChange).not.toHaveBeenCalled();
  });

  it('merges a remote delta WITHOUT clobbering untouched fields, then rehydrates', () => {
    // This window holds b=2 locally; a remote change to `a` must leave `b` intact
    // (the whole-blob clobber this delta protocol fixes) and preserve `version`.
    localStorage.setItem('k', blob({ a: 1, b: 2 }, 7));
    const rehydrate = vi.fn();
    const store = makeFakeStore(rehydrate);
    syncStoreAcrossWindows(store, 'k', 50);

    remoteCb!({ channel: 'k', payload: delta({ a: 9 }), origin: 'win-2' });

    const merged = JSON.parse(localStorage.getItem('k')!);
    expect(merged.state).toEqual({ a: 9, b: 2 });
    expect(merged.version).toBe(7);
    expect(rehydrate).toHaveBeenCalledTimes(1);
  });

  it('applies removed keys from a remote delta', () => {
    localStorage.setItem('k', blob({ a: 1, b: 2 }));
    const store = makeFakeStore(vi.fn());
    syncStoreAcrossWindows(store, 'k', 50);

    remoteCb!({ channel: 'k', payload: delta({}, ['a']), origin: 'win-2' });
    expect(JSON.parse(localStorage.getItem('k')!).state).toEqual({ b: 2 });
  });

  it('ignores its own broadcast (origin === this window)', () => {
    localStorage.setItem('k', blob({ a: 1 }));
    const rehydrate = vi.fn();
    const store = makeFakeStore(rehydrate);
    syncStoreAcrossWindows(store, 'k', 50);

    remoteCb!({ channel: 'k', payload: delta({ a: 2 }), origin: 'main' });
    expect(rehydrate).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('k')!).state).toEqual({ a: 1 });
  });

  it('ignores changes for a different channel', () => {
    const rehydrate = vi.fn();
    const store = makeFakeStore(rehydrate);
    syncStoreAcrossWindows(store, 'k', 50);

    remoteCb!({ channel: 'other', payload: delta({ a: 2 }), origin: 'win-2' });
    expect(rehydrate).not.toHaveBeenCalled();
  });

  it('ignores a malformed delta payload (does not corrupt local state)', () => {
    localStorage.setItem('k', blob({ a: 1 }));
    const rehydrate = vi.fn();
    const store = makeFakeStore(rehydrate);
    syncStoreAcrossWindows(store, 'k', 50);

    remoteCb!({ channel: 'k', payload: 'not json', origin: 'win-2' });
    expect(rehydrate).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('k')!).state).toEqual({ a: 1 });
  });

  it('does not re-broadcast a change it just applied (no echo loop)', () => {
    localStorage.setItem('k', blob({ a: 1 }));
    // rehydrate fires the store subscriber synchronously, like the real one.
    const store = makeFakeStore(() => store.fireChange());
    syncStoreAcrossWindows(store, 'k', 50);

    remoteCb!({ channel: 'k', payload: delta({ a: 2 }), origin: 'win-2' });
    vi.advanceTimersByTime(50);
    expect(tauriService.broadcastSharedChange).not.toHaveBeenCalled();
  });
});
