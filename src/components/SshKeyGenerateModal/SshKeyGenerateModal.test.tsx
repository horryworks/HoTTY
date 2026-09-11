import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SshKeyGenerateModal } from './SshKeyGenerateModal';
import type { SshKeyInfo } from '../../types/appTypes';

const generateSshKey = vi.fn();
const readSshPublicKey = vi.fn();
const writeClipboard = vi.fn();

vi.mock('../../services/tauriService', () => ({
  isEncrypted: (v: string) => typeof v === 'string' && v.startsWith('[SAFE]'),
  tauriService: {
    generateSshKey: (...a: unknown[]) => generateSshKey(...a),
    readSshPublicKey: (...a: unknown[]) => readSshPublicKey(...a),
    writeClipboard: (...a: unknown[]) => writeClipboard(...a),
  },
}));

const created: SshKeyInfo = {
  name: 'id_ed25519_hotty',
  path: 'C:\\Users\\alice\\.ssh\\id_ed25519_hotty',
  algorithm: 'ssh-ed25519',
  fingerprint: 'SHA256:aaaa',
  encrypted: false,
  format: 'openssh',
  hasPublicFile: true,
  managed: true,
};

function renderModal(props: Partial<Parameters<typeof SshKeyGenerateModal>[0]> = {}) {
  const onClose = vi.fn();
  const onGenerated = vi.fn();
  render(
    <SshKeyGenerateModal
      open
      defaultName="id_ed25519_hotty"
      existingNames={[]}
      onClose={onClose}
      onGenerated={onGenerated}
      {...props}
    />,
  );
  return { onClose, onGenerated };
}

function generateButton() {
  return screen.getByRole('button', { name: 'Generate' });
}

beforeEach(() => {
  vi.clearAllMocks();
  generateSshKey.mockResolvedValue(created);
  readSshPublicKey.mockResolvedValue('ssh-ed25519 AAAAC3Nz alice@example.com');
  writeClipboard.mockResolvedValue(undefined);
});

describe('SshKeyGenerateModal', () => {
  it('starts ready to generate with the suggested name', () => {
    renderModal();
    expect((generateButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('refuses a name that is not a name', () => {
    renderModal();
    fireEvent.change(screen.getByLabelText('File name'), { target: { value: '../id_rsa' } });
    expect((generateButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('says so when the name is already taken', () => {
    // The backend refuses to overwrite regardless; catching it here just saves
    // the user a round trip into an error.
    renderModal({ existingNames: ['id_ed25519_hotty'] });
    expect(screen.getByText('A key with that name already exists.')).toBeTruthy();
    expect((generateButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('will not generate while the two passphrases differ', () => {
    // A typo here locks the user out of their own key, which is why the confirm
    // field is mandatory rather than advisory.
    renderModal();
    fireEvent.change(screen.getByLabelText('Passphrase (optional)'), {
      target: { value: 'correct horse' },
    });
    expect((generateButton() as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Confirm passphrase'), {
      target: { value: 'correct horse' },
    });
    expect((generateButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('sends the passphrase as its own argument, never inside the request', async () => {
    // The request object is `Debug`-safe on the Rust side precisely because it
    // carries no secret. This pins the shape that makes that true.
    renderModal();
    fireEvent.change(screen.getByLabelText('Passphrase (optional)'), {
      target: { value: 'hunter2' },
    });
    fireEvent.change(screen.getByLabelText('Confirm passphrase'), {
      target: { value: 'hunter2' },
    });
    fireEvent.click(generateButton());

    await waitFor(() => expect(generateSshKey).toHaveBeenCalled());
    const [req, passphrase] = generateSshKey.mock.calls[0];
    expect(passphrase).toBe('hunter2');
    expect(JSON.stringify(req)).not.toContain('hunter2');
  });

  it('sends null rather than an empty passphrase', async () => {
    // An untouched field is "no passphrase", not "a passphrase of zero length".
    renderModal();
    fireEvent.click(generateButton());

    await waitFor(() => expect(generateSshKey).toHaveBeenCalled());
    expect(generateSshKey.mock.calls[0][1]).toBe(null);
  });

  it('reports the created key and shows the line for the server', async () => {
    const { onGenerated } = renderModal();
    fireEvent.click(generateButton());

    await waitFor(() => expect(onGenerated).toHaveBeenCalled());
    expect(onGenerated.mock.calls[0][0]).toEqual(created);
    expect(await screen.findByDisplayValue(/ssh-ed25519 AAAAC3Nz/)).toBeTruthy();
  });

  it('copies the public key through tauriService, not the raw browser API', async () => {
    renderModal();
    fireEvent.click(generateButton());
    const copy = await screen.findByRole('button', { name: 'Copy public key' });

    fireEvent.click(copy);
    await waitFor(() =>
      expect(writeClipboard).toHaveBeenCalledWith('ssh-ed25519 AAAAC3Nz alice@example.com'),
    );
  });

  it('surfaces a backend failure instead of claiming success', async () => {
    generateSshKey.mockRejectedValue(new Error('A key with that name already exists'));
    const { onGenerated } = renderModal();
    fireEvent.click(generateButton());

    expect(await screen.findByText('A key with that name already exists')).toBeTruthy();
    expect(onGenerated).not.toHaveBeenCalled();
  });

  it('cannot be cancelled while a key is being written', async () => {
    // `spawn_blocking` cannot be interrupted, so closing here would be a lie:
    // the file would still appear a few seconds later.
    let release: (value: SshKeyInfo) => void = () => {};
    generateSshKey.mockReturnValue(
      new Promise<SshKeyInfo>((resolve) => {
        release = resolve;
      }),
    );
    const { onClose } = renderModal();
    fireEvent.click(generateButton());

    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    expect((cancel as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(cancel);
    expect(onClose).not.toHaveBeenCalled();

    release(created);
    await waitFor(() => expect(readSshPublicKey).toHaveBeenCalled());
  });

  it('does not carry a passphrase over to the next time it opens', async () => {
    const { rerender } = render(
      <SshKeyGenerateModal
        open
        defaultName="id_ed25519_hotty"
        existingNames={[]}
        onClose={vi.fn()}
        onGenerated={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Passphrase (optional)'), {
      target: { value: 'hunter2' },
    });

    rerender(
      <SshKeyGenerateModal
        open={false}
        defaultName="id_ed25519_hotty"
        existingNames={[]}
        onClose={vi.fn()}
        onGenerated={vi.fn()}
      />,
    );
    rerender(
      <SshKeyGenerateModal
        open
        defaultName="id_ed25519_hotty"
        existingNames={[]}
        onClose={vi.fn()}
        onGenerated={vi.fn()}
      />,
    );

    expect((screen.getByLabelText('Passphrase (optional)') as HTMLInputElement).value).toBe('');
  });

  it('only offers to attach the key to a connection when asked to', () => {
    renderModal();
    expect(screen.queryByText('Use this key for this connection')).toBe(null);

    renderModal({ offerUseForConnection: true });
    expect(screen.getByText('Use this key for this connection')).toBeTruthy();
  });

  it('renders nothing when closed', () => {
    render(
      <SshKeyGenerateModal
        open={false}
        defaultName="id_ed25519_hotty"
        existingNames={[]}
        onClose={vi.fn()}
        onGenerated={vi.fn()}
      />,
    );
    expect(screen.queryByRole('dialog')).toBe(null);
  });
});
