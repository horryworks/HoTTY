import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { syncStoreAcrossWindows, type SyncableStore } from './crossWindowSync';
import { tauriService } from '../services/tauriService';

// WINDOW_LABEL resolves to 'main' under Vitest (no Tauri internals), so remote
// events with origin !== 'main' are "from another window".

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

  it('broadcasts the localStorage value (debounced) on a local change', () => {
    localStorage.setItem('k', 'v1');
    const store = makeFakeStore(vi.fn());
    syncStoreAcrossWindows(store, 'k', 50);

    store.fireChange();
    expect(tauriService.broadcastSharedChange).not.toHaveBeenCalled(); // debounced
    vi.advanceTimersByTime(50);
    expect(tauriService.broadcastSharedChange).toHaveBeenCalledWith('k', 'v1');
  });

  it('applies a remote change from another window (writes localStorage + rehydrates)', () => {
    const rehydrate = vi.fn();
    const store = makeFakeStore(rehydrate);
    syncStoreAcrossWindows(store, 'k', 50);

    remoteCb!({ channel: 'k', payload: 'v2', origin: 'win-2' });
    expect(localStorage.getItem('k')).toBe('v2');
    expect(rehydrate).toHaveBeenCalledTimes(1);
  });

  it('ignores its own broadcast (origin === this window)', () => {
    const rehydrate = vi.fn();
    const store = makeFakeStore(rehydrate);
    syncStoreAcrossWindows(store, 'k', 50);

    remoteCb!({ channel: 'k', payload: 'v2', origin: 'main' });
    expect(rehydrate).not.toHaveBeenCalled();
    expect(localStorage.getItem('k')).toBeNull();
  });

  it('ignores changes for a different channel', () => {
    const rehydrate = vi.fn();
    const store = makeFakeStore(rehydrate);
    syncStoreAcrossWindows(store, 'k', 50);

    remoteCb!({ channel: 'other', payload: 'v2', origin: 'win-2' });
    expect(rehydrate).not.toHaveBeenCalled();
  });

  it('does not re-broadcast a change it just applied (no echo loop)', () => {
    // rehydrate fires the store subscriber synchronously, like the real one.
    const store = makeFakeStore(() => store.fireChange());
    syncStoreAcrossWindows(store, 'k', 50);

    remoteCb!({ channel: 'k', payload: 'v2', origin: 'win-2' });
    vi.advanceTimersByTime(50);
    expect(tauriService.broadcastSharedChange).not.toHaveBeenCalled();
  });
});
