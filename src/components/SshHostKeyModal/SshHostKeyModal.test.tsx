import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import type { SshHostKeyPromptPayload } from '../../types/appTypes';

const respondSshHostKey = vi.fn().mockResolvedValue(undefined);
let emit: ((payload: SshHostKeyPromptPayload) => void) | null = null;

vi.mock('../../services/tauriService', () => ({
  tauriService: {
    onSshHostKeyPrompt: (cb: (p: SshHostKeyPromptPayload) => void) => {
      emit = cb;
      return Promise.resolve(() => {
        emit = null;
      });
    },
    respondSshHostKey: (id: string, accept: boolean, remember: boolean) =>
      respondSshHostKey(id, accept, remember),
  },
}));

import { SshHostKeyModal } from './SshHostKeyModal';

const samplePayload: SshHostKeyPromptPayload = {
  sessionId: 'sess-1',
  host: 'example.com',
  port: 22,
  keyType: 'ssh-ed25519',
  fingerprint: 'SHA256:deadbeef',
  kind: 'new',
};

describe('SshHostKeyModal', () => {
  beforeEach(() => {
    respondSshHostKey.mockClear();
    emit = null;
  });

  it('renders nothing until a prompt is emitted', () => {
    const { container } = render(<SshHostKeyModal />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the host, key type, and fingerprint on "new" prompt', async () => {
    render(<SshHostKeyModal />);
    await waitFor(() => expect(emit).not.toBeNull());
    act(() => emit!(samplePayload));
    expect(screen.getByText('Unknown host key')).toBeTruthy();
    expect(screen.getByText('example.com:22')).toBeTruthy();
    expect(screen.getByText('ssh-ed25519')).toBeTruthy();
    expect(screen.getByText('SHA256:deadbeef')).toBeTruthy();
  });

  it('shows a warning for "changed" prompts', async () => {
    render(<SshHostKeyModal />);
    await waitFor(() => expect(emit).not.toBeNull());
    act(() => emit!({ ...samplePayload, kind: 'changed' }));
    expect(screen.getByText('Host key CHANGED')).toBeTruthy();
    expect(screen.getByText(/man-in-the-middle/)).toBeTruthy();
  });

  it('Reject calls respondSshHostKey(false, false)', async () => {
    render(<SshHostKeyModal />);
    await waitFor(() => expect(emit).not.toBeNull());
    act(() => emit!(samplePayload));
    fireEvent.click(screen.getByText('Reject'));
    expect(respondSshHostKey).toHaveBeenCalledWith('sess-1', false, false);
  });

  it('Accept once calls respondSshHostKey(true, false)', async () => {
    render(<SshHostKeyModal />);
    await waitFor(() => expect(emit).not.toBeNull());
    act(() => emit!(samplePayload));
    fireEvent.click(screen.getByText('Accept once'));
    expect(respondSshHostKey).toHaveBeenCalledWith('sess-1', true, false);
  });

  it('Accept & remember calls respondSshHostKey(true, true)', async () => {
    render(<SshHostKeyModal />);
    await waitFor(() => expect(emit).not.toBeNull());
    act(() => emit!(samplePayload));
    fireEvent.click(screen.getByText(/Accept & remember/));
    expect(respondSshHostKey).toHaveBeenCalledWith('sess-1', true, true);
  });
});
