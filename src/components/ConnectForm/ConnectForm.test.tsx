import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const openDialog = vi.fn();
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: (opts: unknown) => openDialog(opts),
}));

import { ConnectForm } from './ConnectForm';
import { useSettingsStore } from '../../stores/settingsStore';

describe('ConnectForm', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
    openDialog.mockReset();
  });

  it('renders nothing when open=false', () => {
    const { container } = render(
      <ConnectForm open={false} onCancel={() => {}} onSubmit={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('Connect button is disabled until host and username are provided (SSH)', () => {
    render(<ConnectForm open onCancel={() => {}} onSubmit={() => {}} />);
    const submit = screen.getByText('Connect') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('example.com'), {
      target: { value: 'h' },
    });
    expect(submit.disabled).toBe(true);

    const labels = screen.getAllByText(/^Username/);
    const usernameInput = labels[0].parentElement!.querySelector('input') as HTMLInputElement;
    fireEvent.change(usernameInput, { target: { value: 'root' } });
    expect(submit.disabled).toBe(false);
  });

  it('submits an SSH payload with trimmed fields and settings-derived keepalive', () => {
    useSettingsStore.getState().update('sshKeepAliveEnabled', true);
    useSettingsStore.getState().update('sshKeepAliveInterval', 42);
    const onSubmit = vi.fn();
    render(<ConnectForm open onCancel={() => {}} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByPlaceholderText('example.com'), {
      target: { value: '  host.example  ' },
    });
    const usernameInput = screen
      .getAllByText(/^Username/)[0]
      .parentElement!.querySelector('input') as HTMLInputElement;
    fireEvent.change(usernameInput, { target: { value: '  me  ' } });

    fireEvent.click(screen.getByText('Connect'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.protocol).toBe('ssh');
    expect(payload.config.host).toBe('host.example');
    expect(payload.config.username).toBe('me');
    expect(payload.config.port).toBe(22);
    expect(payload.config.keepaliveIntervalSecs).toBe(42);
    expect(payload.displayName).toMatch(/SSH/);
    expect(payload.displayName).toMatch(/host\.example/);
  });

  it('switching to Telnet changes the default port and allows empty username', () => {
    const onSubmit = vi.fn();
    render(<ConnectForm open onCancel={() => {}} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByLabelText('Telnet'));

    fireEvent.change(screen.getByPlaceholderText('example.com'), {
      target: { value: 'h' },
    });
    const submit = screen.getByText('Connect') as HTMLButtonElement;
    expect(submit.disabled).toBe(false);

    fireEvent.click(submit);
    expect(onSubmit.mock.calls[0][0].protocol).toBe('telnet');
    expect(onSubmit.mock.calls[0][0].config.port).toBe(23);
  });

  it('Browse button opens the file dialog and stores the path', async () => {
    openDialog.mockResolvedValue('/keys/id_rsa');
    render(<ConnectForm open onCancel={() => {}} onSubmit={() => {}} />);
    fireEvent.click(screen.getByText(/Browse/));
    await waitFor(() => {
      const keyInput = screen.getByPlaceholderText('~/.ssh/id_rsa') as HTMLInputElement;
      expect(keyInput.value).toBe('/keys/id_rsa');
    });
    expect(openDialog).toHaveBeenCalled();
  });

  it('Cancel button calls onCancel', () => {
    const onCancel = vi.fn();
    render(<ConnectForm open onCancel={onCancel} onSubmit={() => {}} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
