import { useCallback, useEffect, useState } from 'react';
import { tauriService } from '../services/tauriService';
import type { SshKeyInfo } from '../types/appTypes';

/**
 * The contents of `~/.ssh`, for the SSH Keys tab and the session dialog's key
 * picker.
 *
 * Deliberately not a Zustand store. A store that imports `tauriService` poisons
 * the mocks in `tauriService.test.ts` under Vitest's forks pool, which takes the
 * whole suite down. Two callers each holding their own copy costs one extra
 * `read_dir` of a small folder, which is not worth a shared module for.
 *
 * Failures surface in `error` rather than through `logError`, because that
 * raises a toast — and "you have no keys yet" is a state the tab explains in
 * place, not an incident.
 */
export interface UseSshKeysResult {
  keys: SshKeyInfo[];
  /** Absolute path of `~/.ssh`, for display. */
  sshDir: string | null;
  /**
   * False when there is nowhere safe to keep keys — a network home, or no home
   * at all. A missing `~/.ssh` is NOT this: that is an empty list.
   */
  available: boolean;
  unavailableReason: string | null;
  /** The folder held more entries than the backend was willing to walk. */
  truncated: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useSshKeys(enabled: boolean): UseSshKeysResult {
  const [keys, setKeys] = useState<SshKeyInfo[]>([]);
  const [sshDir, setSshDir] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await tauriService.listSshKeys();
      setKeys(result.keys);
      setSshDir(result.sshDir ?? null);
      setAvailable(result.available);
      setUnavailableReason(result.unavailableReason ?? null);
      setTruncated(result.truncated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setKeys([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  return {
    keys,
    sshDir,
    available,
    unavailableReason,
    truncated,
    loading,
    error,
    refresh,
  };
}
