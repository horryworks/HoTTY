import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildConfigFromHostNode, resolveEnablePassword, resolveHostLoginName, sendableEnablePassword } from './hostConnectConfig';
import { isEncrypted } from '../services/tauriService';
import { decryptBatch, findStoredHostNode, getCachedCredential } from '../hooks/useHostManager';
import { useSettingsStore } from '../stores/settingsStore';
import type { HostTreeNode, SshConnectionConfig, TelnetConnectionConfig } from '../types/appTypes';

vi.mock('../services/tauriService', () => ({
  // The real helper recognises the DPAPI envelope; here anything prefixed
  // `enc:` stands in for an encrypted blob.
  isEncrypted: vi.fn((v: string) => typeof v === 'string' && v.startsWith('enc:')),
}));

vi.mock('../hooks/useHostManager', () => ({
  decryptBatch: vi.fn(),
  getCachedCredential: vi.fn(),
  findStoredHostNode: vi.fn(),
}));

const mockDecryptBatch = vi.mocked(decryptBatch);
const mockGetCached = vi.mocked(getCachedCredential);
const mockFindStored = vi.mocked(findStoredHostNode);
const mockIsEncrypted = vi.mocked(isEncrypted);

const node = (entry: Partial<NonNullable<HostTreeNode['entry']>> & { host: string }): HostTreeNode => ({
  id: 'n1',
  type: 'host',
  name: 'core-01',
  entry: { protocol: 'ssh', port: 22, ...entry } as HostTreeNode['entry'],
});

beforeEach(() => {
  mockDecryptBatch.mockReset();
  mockGetCached.mockReset();
  mockGetCached.mockReturnValue(undefined);
  mockIsEncrypted.mockImplementation((v: string) => typeof v === 'string' && v.startsWith('enc:'));
  useSettingsStore.setState({
    globalEncoding: 'utf8',
    sshKeepAliveEnabled: true,
    sshKeepAliveInterval: 30,
    sshConnectTimeoutSecs: 15,
    telnetKeepAliveEnabled: false,
    telnetKeepAliveInterval: 60,
    telnetConnectTimeoutSecs: 12,
  });
});

describe('buildConfigFromHostNode', () => {
  it('returns null for an entry that cannot supply reusable credentials', async () => {
    await expect(buildConfigFromHostNode({ id: 'f', type: 'folder', name: 'Site' })).resolves.toBeNull();
    await expect(buildConfigFromHostNode(node({ host: 'vm-01', protocol: 'gcloud-iap' }))).resolves.toBeNull();
  });

  it('builds an SSH config from plaintext fields without touching the decrypt path', async () => {
    const r = await buildConfigFromHostNode(node({ host: '192.0.2.1', username: 'alice', password: 'hunter2' }));
    expect(r?.protocol).toBe('ssh');
    const c = r!.config as SshConnectionConfig;
    expect(c).toMatchObject({ host: '192.0.2.1', port: 22, username: 'alice', password: 'hunter2' });
    expect(mockDecryptBatch).not.toHaveBeenCalled();
  });

  it('applies the global connection settings the same way a user-opened session does', async () => {
    const ssh = await buildConfigFromHostNode(node({ host: '192.0.2.1', username: 'alice' }));
    expect(ssh!.config as SshConnectionConfig).toMatchObject({
      encoding: 'utf8', keepaliveIntervalSecs: 30, connectTimeoutSecs: 15,
    });

    const telnet = await buildConfigFromHostNode(node({ host: '192.0.2.2', protocol: 'telnet', port: 23 }));
    expect(telnet?.protocol).toBe('telnet');
    // Keepalive disabled globally must land as 0, not as the configured interval.
    expect(telnet!.config as TelnetConnectionConfig).toMatchObject({
      encoding: 'utf8', keepaliveIntervalSecs: 0, connectTimeoutSecs: 12,
    });
  });

  it('prefers the in-memory plaintext cache over a DPAPI round-trip', async () => {
    mockGetCached.mockReturnValue({ username: 'alice', password: 'hunter2', privateKeyPassphrase: 'pp' });
    const r = await buildConfigFromHostNode(
      node({ host: '192.0.2.1', username: 'enc:u', password: 'enc:p', privateKeyPassphrase: 'enc:k', privateKeyPath: 'C:\\id_ed25519' }),
    );
    const c = r!.config as SshConnectionConfig;
    expect(c.username).toBe('alice');
    expect(c.password).toBe('hunter2');
    expect(c.privateKeyPassphrase).toBe('pp');
    expect(mockDecryptBatch).not.toHaveBeenCalled();
  });

  it('decrypts the encrypted fields in ONE batch when the cache misses', async () => {
    mockDecryptBatch.mockResolvedValue(['alice', 'hunter2', 'pp']);
    const r = await buildConfigFromHostNode(
      node({ host: '192.0.2.1', username: 'enc:u', password: 'enc:p', privateKeyPassphrase: 'enc:k' }),
    );
    expect(mockDecryptBatch).toHaveBeenCalledTimes(1);
    expect(mockDecryptBatch).toHaveBeenCalledWith(['enc:u', 'enc:p', 'enc:k']);
    const c = r!.config as SshConnectionConfig;
    expect(c).toMatchObject({ username: 'alice', password: 'hunter2', privateKeyPassphrase: 'pp' });
  });

  it('only sends the encrypted slots to the batch, leaving plaintext ones untouched', async () => {
    mockDecryptBatch.mockResolvedValue([undefined, 'hunter2', undefined]);
    const r = await buildConfigFromHostNode(node({ host: '192.0.2.1', username: 'alice', password: 'enc:p' }));
    expect(mockDecryptBatch).toHaveBeenCalledWith([undefined, 'enc:p', undefined]);
    expect((r!.config as SshConnectionConfig).username).toBe('alice');
    expect((r!.config as SshConnectionConfig).password).toBe('hunter2');
  });

  it("lets the AI's explicit user: override the saved username", async () => {
    const r = await buildConfigFromHostNode(node({ host: '192.0.2.1', username: 'alice' }), 'bob');
    expect((r!.config as SshConnectionConfig).username).toBe('bob');
  });

  it('normalises empty optional secrets to undefined rather than empty strings', async () => {
    const r = await buildConfigFromHostNode(node({ host: '192.0.2.1', username: 'alice' }));
    const c = r!.config as SshConnectionConfig;
    expect(c.password).toBeUndefined();
    expect(c.privateKeyPath).toBeUndefined();
    expect(c.privateKeyPassphrase).toBeUndefined();
  });

  it('carries the entry\'s fixed-terminal-size flag through to the connection config', async () => {
    const r = await buildConfigFromHostNode(node({ host: '192.0.2.1', username: 'alice', fixedTerminalSize: true }));
    expect((r!.config as SshConnectionConfig).fixedTerminalSize).toBe(true);
  });
});

describe('resolveHostLoginName', () => {
  beforeEach(() => mockFindStored.mockReset());

  it('returns a plaintext name as is, without decrypting', async () => {
    mockFindStored.mockReturnValue(node({ host: '192.0.2.1', username: 'alice' }));
    await expect(resolveHostLoginName('n1')).resolves.toBe('alice');
    expect(mockDecryptBatch).not.toHaveBeenCalled();
  });

  it('prefers the in-memory plaintext cache over a decrypt', async () => {
    mockFindStored.mockReturnValue(node({ host: '192.0.2.1', username: 'enc:u' }));
    mockGetCached.mockReturnValue({ username: 'alice' });
    await expect(resolveHostLoginName('n1')).resolves.toBe('alice');
    expect(mockDecryptBatch).not.toHaveBeenCalled();
  });

  it('decrypts a stored name, and never hands back the ciphertext', async () => {
    mockFindStored.mockReturnValue(node({ host: '192.0.2.1', username: 'enc:u' }));
    mockDecryptBatch.mockResolvedValueOnce(['alice']);
    await expect(resolveHostLoginName('n1')).resolves.toBe('alice');
    expect(mockDecryptBatch).toHaveBeenCalledWith(['enc:u']);

    mockDecryptBatch.mockRejectedValueOnce(new Error('dpapi'));
    await expect(resolveHostLoginName('n1')).resolves.toBeUndefined();
    mockDecryptBatch.mockResolvedValueOnce([undefined]);
    await expect(resolveHostLoginName('n1')).resolves.toBeUndefined();
  });

  it('is undefined for a missing entry or one without a name', async () => {
    mockFindStored.mockReturnValue(undefined);
    await expect(resolveHostLoginName('gone')).resolves.toBeUndefined();
    mockFindStored.mockReturnValue(node({ host: '192.0.2.1' }));
    await expect(resolveHostLoginName('n1')).resolves.toBeUndefined();
  });
});

describe('sendableEnablePassword', () => {
  it('offers a saved enable password for SSH and Telnet hosts', () => {
    expect(sendableEnablePassword({ protocol: 'ssh', host: '192.0.2.1', port: 22, enablePassword: 'enc:e' })).toBe('enc:e');
    expect(sendableEnablePassword({ protocol: 'telnet', host: '192.0.2.1', port: 23, enablePassword: 'en' })).toBe('en');
  });

  it('never offers one for a gcloud-iap host, so the shortcut matches the hidden button', () => {
    expect(sendableEnablePassword({ protocol: 'gcloud-iap', host: 'vm-01', port: 22, enablePassword: 'enc:e' })).toBeUndefined();
  });

  it('is undefined with no entry or an empty value', () => {
    expect(sendableEnablePassword(undefined)).toBeUndefined();
    expect(sendableEnablePassword({ protocol: 'ssh', host: '192.0.2.1', port: 22, enablePassword: '' })).toBeUndefined();
  });
});

describe('resolveEnablePassword', () => {
  it('is none when nothing is saved', async () => {
    await expect(resolveEnablePassword(undefined)).resolves.toEqual({ kind: 'none' });
    await expect(resolveEnablePassword('')).resolves.toEqual({ kind: 'none' });
    expect(mockDecryptBatch).not.toHaveBeenCalled();
  });

  it('returns a plaintext value (a fresh edit in this window) without decrypting', async () => {
    await expect(resolveEnablePassword('s3cret')).resolves.toEqual({ kind: 'ok', value: 's3cret' });
    expect(mockDecryptBatch).not.toHaveBeenCalled();
  });

  it('always decrypts ciphertext, even when the cache holds a value', async () => {
    // The cache is not refreshed by another window's edit, so it must not win.
    mockGetCached.mockReturnValue({ enablePassword: 'stale' });
    mockDecryptBatch.mockResolvedValueOnce(['fresh']);
    await expect(resolveEnablePassword('enc:e')).resolves.toEqual({ kind: 'ok', value: 'fresh' });
    expect(mockDecryptBatch).toHaveBeenCalledWith(['enc:e']);
  });

  it('reports a failed decrypt instead of handing back ciphertext', async () => {
    mockDecryptBatch.mockResolvedValueOnce([undefined]);
    await expect(resolveEnablePassword('enc:e')).resolves.toEqual({ kind: 'failed' });
    mockDecryptBatch.mockRejectedValueOnce(new Error('dpapi'));
    await expect(resolveEnablePassword('enc:e')).resolves.toEqual({ kind: 'failed' });
  });

  it('reports failed when a rejected decrypt hands the ciphertext back', async () => {
    // decryptBatch fails open on an IPC rejection and returns its input.
    mockDecryptBatch.mockResolvedValueOnce(['enc:e']);
    await expect(resolveEnablePassword('enc:e')).resolves.toEqual({ kind: 'failed' });
  });
});
