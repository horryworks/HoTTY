import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logError } from './logger';
import { tauriService } from '../services/tauriService';
import { useErrorNotificationStore } from '../stores/errorNotificationStore';

vi.mock('../services/tauriService', () => ({
  tauriService: {
    logDebug: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('logError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useErrorNotificationStore.getState().clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('forwards to tauriService.logDebug at error level with category and message', () => {
    logError('SSH', 'connection refused');
    expect(tauriService.logDebug).toHaveBeenCalledWith('error', 'SSH', 'connection refused');
  });

  it('appends Error.message when an Error is passed', () => {
    logError('TextEditor', 'Failed to load file', new Error('ENOENT'));
    expect(tauriService.logDebug).toHaveBeenCalledWith(
      'error',
      'TextEditor',
      'Failed to load file: ENOENT',
    );
  });

  it('appends stringified value when a non-Error is passed', () => {
    logError('AI', 'auth failed', 401);
    expect(tauriService.logDebug).toHaveBeenCalledWith(
      'error',
      'AI',
      'auth failed: 401',
    );
  });

  it('omits separator when err is undefined', () => {
    logError('A', 'plain message');
    expect(tauriService.logDebug).toHaveBeenCalledWith('error', 'A', 'plain message');
  });

  it('pushes a notification to the store with the full message', () => {
    logError('TextEditor', 'Failed to load file', new Error('ENOENT'));
    const list = useErrorNotificationStore.getState().notifications;
    expect(list).toHaveLength(1);
    expect(list[0].category).toBe('TextEditor');
    expect(list[0].message).toBe('Failed to load file: ENOENT');
  });

  it('does not throw when tauriService.logDebug rejects', async () => {
    vi.mocked(tauriService.logDebug).mockRejectedValueOnce(new Error('invoke failed'));
    expect(() => logError('A', 'msg')).not.toThrow();
    // notification still pushed
    expect(useErrorNotificationStore.getState().notifications).toHaveLength(1);
    // wait a tick for the swallowed promise rejection
    await Promise.resolve();
  });

  it('also writes to console.error for dev visibility', () => {
    const spy = vi.spyOn(console, 'error');
    logError('A', 'msg', new Error('x'));
    expect(spy).toHaveBeenCalled();
  });
});
