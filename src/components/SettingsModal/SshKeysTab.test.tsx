import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { SshKeysTab } from './SshKeysTab';
import type { SshKeyInfo, SshKeyListResult } from '../../types/appTypes';

const listSshKeys = vi.fn();
const readSshPublicKey = vi.fn();
const writeClipboard = vi.fn();
const deleteSshKey = vi.fn();
const exportSshPublicKey = vi.fn();
const openSshKeyFolder = vi.fn();

vi.mock('../../services/tauriService', () => ({
  isEncrypted: (v: string) => typeof v === 'string' && v.startsWith('[SAFE]'),
  tauriService: {
    listSshKeys: () => listSshKeys(),
    readSshPublicKey: (...a: unknown[]) => readSshPublicKey(...a),
    writeClipboard: (...a: unknown[]) => writeClipboard(...a),
    deleteSshKey: (...a: unknown[]) => deleteSshKey(...a),
    exportSshPublicKey: (...a: unknown[]) => exportSshPublicKey(...a),
    openSshKeyFolder: () => openSshKeyFolder(),
    generateSshKey: vi.fn(),
  },
}));

function key(overrides: Partial<SshKeyInfo> = {}): SshKeyInfo {
  return {
    name: 'id_ed25519_hotty',
    path: 'C:\\Users\\alice\\.ssh\\id_ed25519_hotty',
    algorithm: 'ssh-ed25519',
    fingerprint: 'SHA256:AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
    comment: 'alice@example.com',
    encrypted: false,
    format: 'openssh',
    hasPublicFile: true,
    managed: true,
    ...overrides,
  };
}

function listResult(overrides: Partial<SshKeyListResult> = {}): SshKeyListResult {
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
  listSshKeys.mockResolvedValue(listResult());
  readSshPublicKey.mockResolvedValue('ssh-ed25519 AAAAC3Nz alice@example.com');
  writeClipboard.mockResolvedValue(undefined);
  deleteSshKey.mockResolvedValue(undefined);
});

describe('SshKeysTab', () => {
  it('lists a key with its algorithm and fingerprint', async () => {
    render(<SshKeysTab />);

    expect(await screen.findByText('id_ed25519_hotty')).toBeTruthy();
    expect(screen.getByText('ssh-ed25519')).toBeTruthy();
    expect(screen.getByText('alice@example.com')).toBeTruthy();
    expect(screen.getByText(/^SHA256:/)).toBeTruthy();
  });

  it('shows the RSA size, which is the one algorithm with a choice', async () => {
    listSshKeys.mockResolvedValue(
      listResult({ keys: [key({ name: 'id_rsa', algorithm: 'ssh-rsa', bits: 3072 })] }),
    );
    render(<SshKeysTab />);
    expect(await screen.findByText('ssh-rsa 3072')).toBeTruthy();
  });

  it('marks the keys HoTTY created', async () => {
    listSshKeys.mockResolvedValue(
      listResult({ keys: [key(), key({ name: 'id_rsa', managed: false })] }),
    );
    render(<SshKeysTab />);
    await screen.findByText('id_ed25519_hotty');
    expect(screen.getAllByText('Created by HoTTY')).toHaveLength(1);
  });

  it('copies the public key through tauriService', async () => {
    render(<SshKeysTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Copy public key' }));

    await waitFor(() =>
      expect(writeClipboard).toHaveBeenCalledWith('ssh-ed25519 AAAAC3Nz alice@example.com'),
    );
  });

  it('will not delete a key another tool created', async () => {
    // The backend refuses these too — this is the visible half of the same rule.
    listSshKeys.mockResolvedValue(listResult({ keys: [key({ managed: false })] }));
    render(<SshKeysTab />);

    const button = await screen.findByRole('button', { name: 'Delete' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('asks before deleting, and passes the fingerprint it is deleting', async () => {
    const { container } = render(<SshKeysTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    // Deleting a key cannot be undone, so it goes through a confirm.
    expect(await screen.findByText('Delete this key?')).toBeTruthy();
    expect(deleteSshKey).not.toHaveBeenCalled();

    // Scoped to the confirm dialog: the row behind it has a Delete button too.
    const confirm = container.querySelector('.confirm-modal');
    expect(confirm).toBeTruthy();
    fireEvent.click(within(confirm as HTMLElement).getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(deleteSshKey).toHaveBeenCalledWith(
        'id_ed25519_hotty',
        'SHA256:AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
      ),
    );
  });

  it('cancelling the confirm deletes nothing', async () => {
    render(<SshKeysTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await screen.findByText('Delete this key?');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Delete this key?')).toBe(null));
    expect(deleteSshKey).not.toHaveBeenCalled();
  });

  it('explains an unavailable home instead of showing an empty list', async () => {
    // A network home means the ACL cannot be promised, so the whole feature is
    // off. Saying "no keys" there would be misleading.
    listSshKeys.mockResolvedValue(
      listResult({
        available: false,
        unavailableReason: 'SSH keys are unavailable because your home folder is on a network path',
        keys: [],
        sshDir: undefined,
      }),
    );
    render(<SshKeysTab />);

    expect(await screen.findByText(/network path/)).toBeTruthy();
    const generate = screen.getByRole('button', { name: 'Generate key…' });
    expect((generate as HTMLButtonElement).disabled).toBe(true);
  });

  it('an empty .ssh folder is a normal, generatable state', async () => {
    listSshKeys.mockResolvedValue(listResult({ keys: [] }));
    render(<SshKeysTab />);

    expect(await screen.findByText('No keys here yet.')).toBeTruthy();
    const generate = screen.getByRole('button', { name: 'Generate key…' });
    expect((generate as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows a key it could not parse without offering actions on it', async () => {
    listSshKeys.mockResolvedValue(
      listResult({
        keys: [
          key({
            name: 'id_rsa_putty',
            algorithm: undefined,
            fingerprint: undefined,
            comment: undefined,
            format: 'ppk',
            hasPublicFile: false,
            managed: false,
          }),
        ],
      }),
    );
    render(<SshKeysTab />);

    expect(await screen.findByText('id_rsa_putty')).toBeTruthy();
    expect(screen.getByText('Could not read this key.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Copy public key' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('opens the folder through the backend', async () => {
    render(<SshKeysTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open folder' }));
    expect(openSshKeyFolder).toHaveBeenCalled();
  });
});
