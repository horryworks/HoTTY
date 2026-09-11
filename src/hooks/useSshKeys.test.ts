import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useSshKeys } from './useSshKeys';
import type { SshKeyInfo, SshKeyListResult } from '../types/appTypes';

const listSshKeys = vi.fn();

vi.mock('../services/tauriService', () => ({
  isEncrypted: (v: string) => typeof v === 'string' && v.startsWith('[SAFE]'),
  tauriService: {
    listSshKeys: () => listSshKeys(),
  },
}));

function key(overrides: Partial<SshKeyInfo> = {}): SshKeyInfo {
  return {
    name: 'id_ed25519_hotty',
    path: 'C:\\Users\\alice\\.ssh\\id_ed25519_hotty',
    algorithm: 'ssh-ed25519',
    fingerprint: 'SHA256:aaaa',
    comment: 'alice@example.com',
    encrypted: false,
    format: 'openssh',
    hasPublicFile: true,
    managed: true,
    ...overrides,
  };
}

function result(overrides: Partial<SshKeyListResult> = {}): SshKeyListResult {
  return {
    available: true,
    sshDir: 'C:\\Users\\alice\\.ssh',
    keys: [key()],
    truncated: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listSshKeys.mockResolvedValue(result());
});

describe('useSshKeys', () => {
  it('loads the keys once enabled', async () => {
    const { result: hook } = renderHook(() => useSshKeys(true));
    await waitFor(() => expect(hook.current.loading).toBe(false));

    expect(listSshKeys).toHaveBeenCalledTimes(1);
    expect(hook.current.keys).toHaveLength(1);
    expect(hook.current.keys[0].name).toBe('id_ed25519_hotty');
    expect(hook.current.sshDir).toBe('C:\\Users\\alice\\.ssh');
    expect(hook.current.error).toBe(null);
  });

  it('does not touch the backend while disabled', () => {
    // The session dialog mounts its picker long before anyone opens it; there is
    // no reason to walk the folder until it is shown.
    renderHook(() => useSshKeys(false));
    expect(listSshKeys).not.toHaveBeenCalled();
  });

  it('reports an unavailable home rather than an empty list', async () => {
    // A network home means we cannot promise the ACL, so the backend refuses
    // the whole feature. The tab has to say so rather than imply "no keys".
    listSshKeys.mockResolvedValue(
      result({
        available: false,
        unavailableReason: 'SSH keys are unavailable because your home folder is on a network path',
        sshDir: undefined,
        keys: [],
      }),
    );
    const { result: hook } = renderHook(() => useSshKeys(true));
    await waitFor(() => expect(hook.current.loading).toBe(false));

    expect(hook.current.available).toBe(false);
    expect(hook.current.unavailableReason).toContain('network path');
    expect(hook.current.keys).toEqual([]);
  });

  it('an empty ~/.ssh is available with no keys', async () => {
    listSshKeys.mockResolvedValue(result({ keys: [] }));
    const { result: hook } = renderHook(() => useSshKeys(true));
    await waitFor(() => expect(hook.current.loading).toBe(false));

    expect(hook.current.available).toBe(true);
    expect(hook.current.keys).toEqual([]);
  });

  it('surfaces a failure in error instead of throwing', async () => {
    listSshKeys.mockRejectedValue(new Error('backend exploded'));
    const { result: hook } = renderHook(() => useSshKeys(true));
    await waitFor(() => expect(hook.current.loading).toBe(false));

    expect(hook.current.error).toBe('backend exploded');
    expect(hook.current.keys).toEqual([]);
  });

  it('clears a previous error on a successful refresh', async () => {
    listSshKeys.mockRejectedValueOnce(new Error('transient'));
    const { result: hook } = renderHook(() => useSshKeys(true));
    await waitFor(() => expect(hook.current.error).toBe('transient'));

    listSshKeys.mockResolvedValue(result());
    await act(async () => {
      await hook.current.refresh();
    });

    expect(hook.current.error).toBe(null);
    expect(hook.current.keys).toHaveLength(1);
  });

  it('passes the truncated flag through', async () => {
    listSshKeys.mockResolvedValue(result({ truncated: true }));
    const { result: hook } = renderHook(() => useSshKeys(true));
    await waitFor(() => expect(hook.current.loading).toBe(false));

    expect(hook.current.truncated).toBe(true);
  });
});
