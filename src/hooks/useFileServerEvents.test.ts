import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFileServerEvents } from './useFileServerEvents';
import { tauriService } from '../services/tauriService';
import type { FileServerEvent } from '../types/appTypes';

vi.mock('../services/tauriService', () => ({
  tauriService: {
    onFileServerEvent: vi.fn(),
  },
}));

const mockOnEvent = vi.mocked(tauriService.onFileServerEvent);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useFileServerEvents', () => {
  it('subscribes on mount and unsubscribes on unmount', async () => {
    const unsub = vi.fn();
    mockOnEvent.mockResolvedValue(unsub);

    const { unmount } = renderHook(() => useFileServerEvents('srv-1'));

    await vi.waitFor(() => {
      expect(mockOnEvent).toHaveBeenCalledTimes(1);
    });

    unmount();

    await vi.waitFor(() => {
      expect(unsub).toHaveBeenCalledTimes(1);
    });
  });

  it('tracks per-protocol run state and filters by serverId', async () => {
    let cb: ((e: FileServerEvent) => void) | null = null;
    mockOnEvent.mockImplementation(async (handler) => {
      cb = handler;
      return () => {};
    });

    const { result } = renderHook(() => useFileServerEvents('srv-1'));
    await vi.waitFor(() => expect(cb).toBeTruthy());

    // Event for a different server is ignored.
    act(() => {
      cb!({ serverId: 'other', protocol: 'tftp', kind: 'status', status: 'running', timestamp: 1 });
    });
    expect(result.current.tftpState).toBe('stopped');

    // Matching server toggles the right protocol.
    act(() => {
      cb!({ serverId: 'srv-1', protocol: 'tftp', kind: 'status', status: 'running', timestamp: 2 });
      cb!({ serverId: 'srv-1', protocol: 'sftp', kind: 'status', status: 'running', timestamp: 3 });
    });
    expect(result.current.tftpState).toBe('running');
    expect(result.current.sftpState).toBe('running');

    // Transfers accumulate most-recent-first; errors surface.
    act(() => {
      cb!({
        serverId: 'srv-1',
        protocol: 'tftp',
        kind: 'transfer',
        client: '10.0.0.5',
        filename: 'ios.bin',
        direction: 'download',
        bytes: 1024,
        timestamp: 4,
      });
      cb!({ serverId: 'srv-1', protocol: 'sftp', kind: 'error', message: 'boom', timestamp: 5 });
    });
    expect(result.current.transfers).toHaveLength(1);
    expect(result.current.transfers[0].filename).toBe('ios.bin');
    expect(result.current.lastError).toBe('boom');
  });

  it('unsubscribes even when the subscription resolves after unmount (no leak)', async () => {
    const unsub = vi.fn();
    let resolveSub!: (fn: () => void) => void;
    mockOnEvent.mockReturnValue(
      new Promise<() => void>((res) => {
        resolveSub = res;
      })
    );

    const { unmount } = renderHook(() => useFileServerEvents('srv-1'));

    // Tear down before the in-flight subscribe resolves.
    unmount();

    // The subscription now resolves post-unmount: the hook must immediately
    // unlisten it rather than storing (and leaking) the listener.
    await act(async () => {
      resolveSub(unsub);
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(unsub).toHaveBeenCalledTimes(1);
    });
  });
});
