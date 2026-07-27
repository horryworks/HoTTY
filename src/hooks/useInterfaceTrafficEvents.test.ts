import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useInterfaceTrafficEvents } from './useInterfaceTrafficEvents';
import { tauriService } from '../services/tauriService';
import type { SnmpDataPayload, SnmpStatusPayload } from '../types/appTypes';

vi.mock('../services/tauriService', () => ({
  tauriService: {
    onSnmpWatcherData: vi.fn(),
    onSnmpWatcherStatus: vi.fn(),
  },
}));

const onData = vi.mocked(tauriService.onSnmpWatcherData);
const onStatus = vi.mocked(tauriService.onSnmpWatcherStatus);

function makeSnapshot(paneId: string, ifIndexes: number[]): SnmpDataPayload {
  return {
    paneId,
    timestamp: '2026-07-27 10:00:00.000',
    status: 'ok',
    counterWidth: 'hc',
    pollMs: 100,
    intervalMs: 10000,
    interfaces: ifIndexes.map((ifIndex) => ({ ifIndex, discontinuity: false })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  onData.mockResolvedValue(() => {});
  onStatus.mockResolvedValue(() => {});
});

describe('useInterfaceTrafficEvents', () => {
  it('subscribes to both events', async () => {
    renderHook(() => useInterfaceTrafficEvents('if-1'));
    await waitFor(() => {
      expect(onData).toHaveBeenCalledTimes(1);
      expect(onStatus).toHaveBeenCalledTimes(1);
    });
  });

  it('stores snapshots addressed to this pane', async () => {
    let emit: ((p: SnmpDataPayload) => void) | undefined;
    onData.mockImplementation(async (cb) => {
      emit = cb;
      return () => {};
    });

    const { result } = renderHook(() => useInterfaceTrafficEvents('if-1'));
    await waitFor(() => expect(emit).toBeDefined());

    act(() => emit!(makeSnapshot('if-1', [1, 2])));
    expect(result.current.snapshot?.interfaces).toHaveLength(2);
  });

  // Events are broadcast to every window, so the pane filter is what keeps two
  // watchers from writing into each other's tables.
  it('ignores snapshots for other panes', async () => {
    let emit: ((p: SnmpDataPayload) => void) | undefined;
    onData.mockImplementation(async (cb) => {
      emit = cb;
      return () => {};
    });

    const { result } = renderHook(() => useInterfaceTrafficEvents('if-1'));
    await waitFor(() => expect(emit).toBeDefined());

    act(() => emit!(makeSnapshot('if-OTHER', [1, 2, 3])));
    expect(result.current.snapshot).toBeNull();
  });

  // The backend sends a full snapshot each cycle; replacing (not merging) is
  // what makes a removed interface actually disappear from the table.
  it('replaces the previous snapshot rather than merging', async () => {
    let emit: ((p: SnmpDataPayload) => void) | undefined;
    onData.mockImplementation(async (cb) => {
      emit = cb;
      return () => {};
    });

    const { result } = renderHook(() => useInterfaceTrafficEvents('if-1'));
    await waitFor(() => expect(emit).toBeDefined());

    act(() => emit!(makeSnapshot('if-1', [1, 2, 3])));
    act(() => emit!(makeSnapshot('if-1', [1])));
    expect(result.current.snapshot?.interfaces.map((r) => r.ifIndex)).toEqual([1]);
  });

  it('tracks watcher state transitions and messages', async () => {
    let emit: ((p: SnmpStatusPayload) => void) | undefined;
    onStatus.mockImplementation(async (cb) => {
      emit = cb;
      return () => {};
    });

    const { result } = renderHook(() => useInterfaceTrafficEvents('if-1'));
    await waitFor(() => expect(emit).toBeDefined());

    act(() =>
      emit!({ paneId: 'if-1', state: 'connecting', timestamp: 't' })
    );
    expect(result.current.watcherState).toBe('connecting');
    expect(result.current.watcherMessage).toBeNull();

    act(() =>
      emit!({ paneId: 'if-1', state: 'error', message: 'No response', timestamp: 't' })
    );
    expect(result.current.watcherState).toBe('error');
    expect(result.current.watcherMessage).toBe('No response');
  });

  it('unlistens on unmount', async () => {
    const dataUnlisten = vi.fn();
    const statusUnlisten = vi.fn();
    onData.mockResolvedValue(dataUnlisten);
    onStatus.mockResolvedValue(statusUnlisten);

    const { unmount } = renderHook(() => useInterfaceTrafficEvents('if-1'));
    await waitFor(() => expect(onStatus).toHaveBeenCalled());
    unmount();

    expect(dataUnlisten).toHaveBeenCalled();
    expect(statusUnlisten).toHaveBeenCalled();
  });

  // The listener registration is async, so it can resolve after the effect has
  // already been torn down. Without the in-flight guard that leaks a listener.
  it('unsubscribes even when the subscription resolves after unmount (no leak)', async () => {
    const dataUnlisten = vi.fn();
    let resolveData: ((fn: () => void) => void) | undefined;
    onData.mockImplementation(
      () =>
        new Promise<() => void>((resolve) => {
          resolveData = resolve;
        })
    );

    const { unmount } = renderHook(() => useInterfaceTrafficEvents('if-1'));
    await waitFor(() => expect(resolveData).toBeDefined());
    unmount();

    await act(async () => {
      resolveData!(dataUnlisten);
      await Promise.resolve();
    });

    expect(dataUnlisten).toHaveBeenCalled();
  });
});
