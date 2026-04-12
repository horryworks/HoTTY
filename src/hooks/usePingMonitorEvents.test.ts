import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePingMonitorEvents } from './usePingMonitorEvents';
import { tauriService } from '../services/tauriService';
import type { PingDataPayload, PingLogFilePayload } from '../types/appTypes';

vi.mock('../services/tauriService', () => ({
  tauriService: {
    onPingMonitorData: vi.fn(),
    onPingMonitorLogFile: vi.fn(),
  },
}));

const mockOnData = vi.mocked(tauriService.onPingMonitorData);
const mockOnLogFile = vi.mocked(tauriService.onPingMonitorLogFile);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('usePingMonitorEvents', () => {
  it('subscribes to events on mount and unsubscribes on unmount', async () => {
    const dataUnsub = vi.fn();
    const logUnsub = vi.fn();
    mockOnData.mockResolvedValue(dataUnsub);
    mockOnLogFile.mockResolvedValue(logUnsub);

    const { unmount } = renderHook(() => usePingMonitorEvents('pm-1'));

    // Wait for async setup
    await vi.waitFor(() => {
      expect(mockOnData).toHaveBeenCalledTimes(1);
      expect(mockOnLogFile).toHaveBeenCalledTimes(1);
    });

    unmount();

    await vi.waitFor(() => {
      expect(dataUnsub).toHaveBeenCalledTimes(1);
      expect(logUnsub).toHaveBeenCalledTimes(1);
    });
  });

  it('filters events by sessionId', async () => {
    let dataCallback: ((p: PingDataPayload) => void) | null = null;
    mockOnData.mockImplementation(async (cb) => {
      dataCallback = cb;
      return () => {};
    });
    mockOnLogFile.mockResolvedValue(() => {});

    const { result } = renderHook(() => usePingMonitorEvents('pm-1'));

    await vi.waitFor(() => {
      expect(dataCallback).toBeTruthy();
    });

    // Event for different session — should be ignored
    act(() => {
      dataCallback!({
        sessionId: 'pm-other',
        results: [{ target: '8.8.8.8', status: 'ok', rtt: 10, ttl: 64, timestamp: '2024-01-01' }],
      });
    });

    expect(result.current.latestResults.size).toBe(0);

    // Event for matching session
    act(() => {
      dataCallback!({
        sessionId: 'pm-1',
        results: [{ target: '8.8.8.8', status: 'ok', rtt: 15, ttl: 64, timestamp: '2024-01-01' }],
      });
    });

    expect(result.current.latestResults.size).toBe(1);
    expect(result.current.latestResults.get('8.8.8.8')?.rtt).toBe(15);
  });

  it('updates logFileName when log file event arrives', async () => {
    let logCallback: ((p: PingLogFilePayload) => void) | null = null;
    mockOnData.mockResolvedValue(() => {});
    mockOnLogFile.mockImplementation(async (cb) => {
      logCallback = cb;
      return () => {};
    });

    const { result } = renderHook(() => usePingMonitorEvents('pm-1'));

    await vi.waitFor(() => {
      expect(logCallback).toBeTruthy();
    });

    expect(result.current.logFileName).toBeNull();

    act(() => {
      logCallback!({ sessionId: 'pm-1', fileName: 'ping-log.csv' });
    });

    expect(result.current.logFileName).toBe('ping-log.csv');
  });
});
