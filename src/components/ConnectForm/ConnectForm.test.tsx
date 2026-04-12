import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const openDialog = vi.fn();
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: (opts: unknown) => openDialog(opts),
}));

const mockListSerialPorts = vi.fn().mockResolvedValue([]);
const mockListWslDistributions = vi.fn().mockResolvedValue([]);
const mockDetectGitBash = vi.fn().mockResolvedValue(null);

vi.mock('../../services/tauriService', () => ({
  tauriService: {
    listSerialPorts: (...args: unknown[]) => mockListSerialPorts(...args),
    listWslDistributions: (...args: unknown[]) => mockListWslDistributions(...args),
    detectGitBash: (...args: unknown[]) => mockDetectGitBash(...args),
  },
}));

import { ConnectForm } from './ConnectForm';
import { useSettingsStore } from '../../stores/settingsStore';

describe('ConnectForm', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
    openDialog.mockReset();
    mockListSerialPorts.mockReset().mockResolvedValue([]);
    mockListWslDistributions.mockReset().mockResolvedValue([]);
    mockDetectGitBash.mockReset().mockResolvedValue(null);
  });

  it('renders nothing when open=false', () => {
    const { container } = render(
      <ConnectForm open={false} onCancel={() => {}} onSubmit={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders Protocol dropdown with all 7 options', () => {
    render(<ConnectForm open onCancel={() => {}} onSubmit={() => {}} />);
    const select = screen.getByText('Protocol').parentElement!.querySelector('select')! as HTMLSelectElement;
    expect(select).toBeTruthy();
    const options = Array.from(select.querySelectorAll('option'));
    expect(options.map((o) => o.value)).toEqual([
      'ssh', 'telnet', 'serial', 'wsl', 'cmd', 'powershell', 'git-bash',
    ]);
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
    fireEvent.change(screen.getByText('Protocol').parentElement!.querySelector('select')!, { target: { value: 'telnet' } });

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

  // --- Serial protocol ---

  it('shows serial fields when Serial is selected', () => {
    render(<ConnectForm open onCancel={() => {}} onSubmit={() => {}} />);
    fireEvent.change(screen.getByText('Protocol').parentElement!.querySelector('select')!, { target: { value: 'serial' } });

    expect(screen.getByText('Serial Port')).toBeTruthy();
    expect(screen.getByText('Baud Rate')).toBeTruthy();
    expect(screen.getByText('Data Bits')).toBeTruthy();
    expect(screen.getByText('Parity')).toBeTruthy();
    expect(screen.getByText('Stop Bits')).toBeTruthy();
    expect(screen.getByText('Flow Control')).toBeTruthy();
    // Network fields should be hidden
    expect(screen.queryByPlaceholderText('example.com')).toBeNull();
  });

  it('Serial: loads serial ports on protocol change', async () => {
    mockListSerialPorts.mockResolvedValue([
      { path: 'COM3', displayName: 'USB Serial Port' },
      { path: 'COM5', displayName: '' },
    ]);
    render(<ConnectForm open onCancel={() => {}} onSubmit={() => {}} />);
    fireEvent.change(screen.getByText('Protocol').parentElement!.querySelector('select')!, { target: { value: 'serial' } });

    await waitFor(() => {
      expect(mockListSerialPorts).toHaveBeenCalled();
    });
    // Should show dropdown with ports
    await waitFor(() => {
      expect(screen.getByText('COM3 (USB Serial Port)')).toBeTruthy();
    });
  });

  it('Serial: falls back to text input when no ports detected', () => {
    render(<ConnectForm open onCancel={() => {}} onSubmit={() => {}} />);
    fireEvent.change(screen.getByText('Protocol').parentElement!.querySelector('select')!, { target: { value: 'serial' } });

    // Text input with placeholder COM3
    expect(screen.getByPlaceholderText('COM3')).toBeTruthy();
  });

  it('Serial: Connect disabled until serial path is provided', () => {
    render(<ConnectForm open onCancel={() => {}} onSubmit={() => {}} />);
    fireEvent.change(screen.getByText('Protocol').parentElement!.querySelector('select')!, { target: { value: 'serial' } });
    const submit = screen.getByText('Connect') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('COM3'), { target: { value: 'COM4' } });
    expect(submit.disabled).toBe(false);
  });

  it('Serial: submits correct config', () => {
    const onSubmit = vi.fn();
    render(<ConnectForm open onCancel={() => {}} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByText('Protocol').parentElement!.querySelector('select')!, { target: { value: 'serial' } });
    fireEvent.change(screen.getByPlaceholderText('COM3'), { target: { value: 'COM4' } });
    fireEvent.click(screen.getByText('Connect'));

    const payload = onSubmit.mock.calls[0][0];
    expect(payload.protocol).toBe('serial');
    expect(payload.config.path).toBe('COM4');
    expect(payload.config.baudRate).toBe(9600);
    expect(payload.config.dataBits).toBe('8');
    expect(payload.config.parity).toBe('none');
    expect(payload.config.stopBits).toBe('1');
    expect(payload.config.flowControl).toBe('none');
    expect(payload.displayName).toBe('Serial COM4 (9600)');
  });

  // --- WSL protocol ---

  it('shows WSL distribution dropdown when WSL is selected', async () => {
    mockListWslDistributions.mockResolvedValue(['Ubuntu', 'Debian']);
    render(<ConnectForm open onCancel={() => {}} onSubmit={() => {}} />);
    fireEvent.change(screen.getByText('Protocol').parentElement!.querySelector('select')!, { target: { value: 'wsl' } });

    expect(screen.getByText('Distribution')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText('Ubuntu')).toBeTruthy();
      expect(screen.getByText('Debian')).toBeTruthy();
    });
  });

  it('WSL: shows message when no distributions found', () => {
    render(<ConnectForm open onCancel={() => {}} onSubmit={() => {}} />);
    fireEvent.change(screen.getByText('Protocol').parentElement!.querySelector('select')!, { target: { value: 'wsl' } });
    expect(screen.getByText('No WSL distributions found.')).toBeTruthy();
  });

  it('WSL: submits correct config', async () => {
    mockListWslDistributions.mockResolvedValue(['Ubuntu']);
    const onSubmit = vi.fn();
    render(<ConnectForm open onCancel={() => {}} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByText('Protocol').parentElement!.querySelector('select')!, { target: { value: 'wsl' } });

    await waitFor(() => {
      const submit = screen.getByText('Connect') as HTMLButtonElement;
      expect(submit.disabled).toBe(false);
    });

    fireEvent.click(screen.getByText('Connect'));
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.protocol).toBe('wsl');
    expect(payload.config.distribution).toBe('Ubuntu');
    expect(payload.displayName).toBe('WSL Ubuntu');
  });

  // --- cmd / powershell ---

  it('cmd: Connect is always enabled, submits correct config', () => {
    const onSubmit = vi.fn();
    render(<ConnectForm open onCancel={() => {}} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByText('Protocol').parentElement!.querySelector('select')!, { target: { value: 'cmd' } });
    const submit = screen.getByText('Connect') as HTMLButtonElement;
    expect(submit.disabled).toBe(false);

    fireEvent.click(submit);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.protocol).toBe('cmd');
    expect(payload.config.shellType).toBe('cmd');
    expect(payload.displayName).toBe('Command Prompt');
  });

  it('powershell: Connect is always enabled, submits correct config', () => {
    const onSubmit = vi.fn();
    render(<ConnectForm open onCancel={() => {}} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByText('Protocol').parentElement!.querySelector('select')!, { target: { value: 'powershell' } });

    fireEvent.click(screen.getByText('Connect'));
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.protocol).toBe('powershell');
    expect(payload.config.shellType).toBe('powershell');
    expect(payload.displayName).toBe('PowerShell');
  });

  // --- Git Bash ---

  it('git-bash: shows warning when not installed', async () => {
    mockDetectGitBash.mockResolvedValue(null);
    render(<ConnectForm open onCancel={() => {}} onSubmit={() => {}} />);
    fireEvent.change(screen.getByText('Protocol').parentElement!.querySelector('select')!, { target: { value: 'git-bash' } });

    await waitFor(() => {
      expect(screen.getByText('Git Bash is not installed.')).toBeTruthy();
    });
    const submit = screen.getByText('Connect') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('git-bash: Connect enabled when detected, submits correct config', async () => {
    mockDetectGitBash.mockResolvedValue('C:\\Program Files\\Git\\bin\\bash.exe');
    const onSubmit = vi.fn();
    render(<ConnectForm open onCancel={() => {}} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByText('Protocol').parentElement!.querySelector('select')!, { target: { value: 'git-bash' } });

    await waitFor(() => {
      const submit = screen.getByText('Connect') as HTMLButtonElement;
      expect(submit.disabled).toBe(false);
    });

    fireEvent.click(screen.getByText('Connect'));
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.protocol).toBe('git-bash');
    expect(payload.config.shellType).toBe('git-bash');
    expect(payload.config.shellPath).toBe('C:\\Program Files\\Git\\bin\\bash.exe');
    expect(payload.displayName).toBe('Git Bash');
  });

  // --- Encoding ---

  it('Encoding dropdown is visible for all protocols', () => {
    render(<ConnectForm open onCancel={() => {}} onSubmit={() => {}} />);
    for (const proto of ['ssh', 'telnet', 'serial', 'wsl', 'cmd', 'powershell', 'git-bash']) {
      fireEvent.change(screen.getByText('Protocol').parentElement!.querySelector('select')!, { target: { value: proto } });
      expect(screen.getByText('Encoding').parentElement!.querySelector('select')!).toBeTruthy();
    }
  });
});
