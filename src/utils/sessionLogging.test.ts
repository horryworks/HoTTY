import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveLoggingForConnect } from './sessionLogging';
import { tauriService } from '../services/tauriService';
import { useSettingsStore } from '../stores/settingsStore';

vi.mock('../services/tauriService', () => ({
  tauriService: {
    confirmLogDir: vi.fn(),
  },
}));

const mockConfirm = vi.mocked(tauriService.confirmLogDir);

/** Set only the two settings this helper reads, leaving the rest of the store alone. */
function setLogging(loggingEnabled: boolean, loggingPath: string) {
  useSettingsStore.setState({ loggingEnabled, loggingPath });
}

beforeEach(() => {
  mockConfirm.mockReset();
  setLogging(false, '');
});

describe('resolveLoggingForConnect', () => {
  it('returns disabled without prompting when session logging is off', async () => {
    setLogging(false, 'C:\\logs');
    await expect(resolveLoggingForConnect()).resolves.toEqual({ enabled: false, path: '' });
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('returns disabled without prompting when no folder is configured', async () => {
    setLogging(true, '');
    await expect(resolveLoggingForConnect()).resolves.toEqual({ enabled: false, path: '' });
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('enables logging for the configured folder once the native dialog approves it', async () => {
    setLogging(true, 'C:\\logs');
    mockConfirm.mockResolvedValue(true);
    await expect(resolveLoggingForConnect()).resolves.toEqual({ enabled: true, path: 'C:\\logs' });
    expect(mockConfirm).toHaveBeenCalledWith('C:\\logs');
  });

  // ADR-010: the backend rejects unapproved paths, so a declined dialog must
  // degrade to "connect without logging", never to "connect and log anyway".
  it('falls back to no logging when the user declines the folder approval', async () => {
    setLogging(true, 'C:\\logs');
    mockConfirm.mockResolvedValue(false);
    await expect(resolveLoggingForConnect()).resolves.toEqual({ enabled: false, path: '' });
  });

  it('fails closed when the approval call throws, so a connect is never blocked by logging', async () => {
    setLogging(true, 'C:\\logs');
    mockConfirm.mockRejectedValue(new Error('dialog unavailable'));
    await expect(resolveLoggingForConnect()).resolves.toEqual({ enabled: false, path: '' });
  });
});
