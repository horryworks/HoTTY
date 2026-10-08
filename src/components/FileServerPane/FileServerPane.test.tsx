import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { FileServerPane } from './FileServerPane';
import { tauriService } from '../../services/tauriService';
import { useSettingsStore } from '../../stores/settingsStore';
import type { FileServerEvent, FirewallReport } from '../../types/appTypes';

let eventCb: ((e: FileServerEvent) => void) | null = null;

vi.mock('../../services/tauriService', () => ({
  tauriService: {
    fileServerTftpStart: vi.fn().mockResolvedValue(undefined),
    fileServerTftpStop: vi.fn().mockResolvedValue(undefined),
    fileServerSftpStart: vi.fn().mockResolvedValue(undefined),
    fileServerSftpStop: vi.fn().mockResolvedValue(undefined),
    fileServerFirewallStatus: vi.fn().mockResolvedValue({ status: 'allowed' }),
    fileServerFirewallAllow: vi.fn().mockResolvedValue(undefined),
    fileServerLocalAddresses: vi.fn().mockResolvedValue([]),
    writeClipboard: vi.fn().mockResolvedValue(undefined),
    selectFolder: vi.fn().mockResolvedValue('C:/firmware'),
    onFileServerEvent: vi.fn((cb: (e: FileServerEvent) => void) => {
      eventCb = cb;
      return Promise.resolve(() => {});
    }),
  },
}));

const emit = async (ev: FileServerEvent) => {
  await act(async () => {
    eventCb?.(ev);
  });
};

const card = (name: 'TFTP' | 'SFTP') => within(screen.getByRole('region', { name }));

const setConfig = (patch: Partial<ReturnType<typeof useSettingsStore.getState>['fileServerConfig']> = {}) =>
  useSettingsStore.getState().update('fileServerConfig', {
    rootDir: '',
    bindAddr: '0.0.0.0',
    tftpPort: 69,
    tftpAllowWrite: false,
    sftpPort: 2222,
    sftpUsername: 'hotty',
    sftpAllowWrite: false,
    ...patch,
  });

beforeEach(() => {
  vi.clearAllMocks();
  eventCb = null;
  vi.mocked(tauriService.fileServerFirewallStatus).mockResolvedValue({ status: 'allowed' });
  vi.mocked(tauriService.fileServerLocalAddresses).mockResolvedValue([]);
  setConfig();
});

describe('FileServerPane', () => {
  it('shows one card per protocol with a switch, both stopped, and no warning', () => {
    render(<FileServerPane paneId="fs-1" active />);
    expect(card('TFTP').getByRole('switch', { name: 'Run TFTP' }).getAttribute('aria-checked')).toBe('false');
    expect(card('SFTP').getByRole('switch', { name: 'Run SFTP' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getAllByText('Stopped')).toHaveLength(2);
    expect(screen.queryByText(/anyone on this network/)).toBeNull();
  });

  it('shows the address a device should use, with the adapter list when there are several', async () => {
    vi.mocked(tauriService.fileServerLocalAddresses).mockResolvedValue([
      { name: 'Ethernet', address: '192.0.2.15' },
      { name: 'Wi-Fi', address: '198.51.100.7' },
    ]);
    render(<FileServerPane paneId="fs-1" active />);
    await waitFor(() => expect(screen.getByText('192.0.2.15')).toBeTruthy());
    fireEvent.change(screen.getByRole('combobox', { name: 'Network adapter' }), { target: { value: '198.51.100.7' } });
    expect(screen.getByText('198.51.100.7', { selector: '.fs-address' })).toBeTruthy();
  });

  it('copies the address', async () => {
    vi.mocked(tauriService.fileServerLocalAddresses).mockResolvedValue([{ name: 'Ethernet', address: '192.0.2.15' }]);
    render(<FileServerPane paneId="fs-1" active />);
    await waitFor(() => screen.getByText('192.0.2.15'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(tauriService.writeClipboard).toHaveBeenCalledWith('192.0.2.15'));
  });

  it('picks the shared folder with its button', async () => {
    render(<FileServerPane paneId="fs-1" active />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose a folder…' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'C:/firmware' })).toBeTruthy());
  });

  it('refuses to start TFTP without a shared folder', async () => {
    render(<FileServerPane paneId="fs-1" active />);
    fireEvent.click(card('TFTP').getByRole('switch'));
    await waitFor(() => expect(screen.getByText('Choose a folder to share first')).toBeTruthy());
    expect(tauriService.fileServerTftpStart).not.toHaveBeenCalled();
  });

  it('starts TFTP with the configured parameters from its switch', async () => {
    setConfig({ rootDir: 'C:/firmware' });
    render(<FileServerPane paneId="fs-1" active />);
    fireEvent.click(card('TFTP').getByRole('switch'));
    await waitFor(() => {
      expect(tauriService.fileServerTftpStart).toHaveBeenCalledWith('fs-1', '0.0.0.0', 69, 'C:/firmware', false);
    });
  });

  it('turns the switch on and shows the device command once running', async () => {
    vi.mocked(tauriService.fileServerLocalAddresses).mockResolvedValue([{ name: 'Ethernet', address: '192.0.2.15' }]);
    render(<FileServerPane paneId="fs-1" active />);
    await waitFor(() => screen.getByText('192.0.2.15'));
    await emit({ serverId: 'fs-1', protocol: 'tftp', kind: 'status', status: 'running', timestamp: 0 });
    expect(card('TFTP').getByRole('switch').getAttribute('aria-checked')).toBe('true');
    expect(card('TFTP').getByText('Running')).toBeTruthy();
    expect(card('TFTP').getByText('tftp://192.0.2.15/')).toBeTruthy();
  });

  it('stops TFTP from its switch while running', async () => {
    render(<FileServerPane paneId="fs-1" active />);
    await emit({ serverId: 'fs-1', protocol: 'tftp', kind: 'status', status: 'running', timestamp: 0 });
    fireEvent.click(card('TFTP').getByRole('switch'));
    await waitFor(() => expect(tauriService.fileServerTftpStop).toHaveBeenCalledWith('fs-1'));
  });

  it('warns only when a running server accepts uploads', async () => {
    setConfig({ rootDir: 'C:/firmware', tftpAllowWrite: true });
    render(<FileServerPane paneId="fs-1" active />);
    expect(screen.queryByText(/anyone on this network/)).toBeNull();
    await emit({ serverId: 'fs-1', protocol: 'tftp', kind: 'status', status: 'running', timestamp: 0 });
    expect(screen.getByText(/TFTP accepts uploads/)).toBeTruthy();
  });

  it('sets uploads with the two-way choice', () => {
    render(<FileServerPane paneId="fs-1" active />);
    fireEvent.click(card('SFTP').getByRole('button', { name: 'Accept uploads' }));
    expect(useSettingsStore.getState().fileServerConfig.sftpAllowWrite).toBe(true);
  });

  it('requires SFTP credentials before starting', async () => {
    setConfig({ rootDir: 'C:/firmware' });
    render(<FileServerPane paneId="fs-1" active />);
    fireEvent.click(card('SFTP').getByRole('switch'));
    await waitFor(() => expect(screen.getByText('Enter an SFTP username and password')).toBeTruthy());
    expect(tauriService.fileServerSftpStart).not.toHaveBeenCalled();
  });

  it('records transfer events in the log', async () => {
    render(<FileServerPane paneId="fs-1" active />);
    expect(screen.getByText('No transfers yet')).toBeTruthy();
    await emit({
      serverId: 'fs-1', protocol: 'tftp', kind: 'transfer', client: '192.0.2.5:5000',
      filename: 'ios.bin', direction: 'download', bytes: 2048, timestamp: 0,
    });
    expect(screen.getByText('ios.bin')).toBeTruthy();
    expect(screen.getByText('192.0.2.5:5000')).toBeTruthy();
  });

  it('shows — for a transfer whose size is unknown (TFTP without tsize)', async () => {
    render(<FileServerPane paneId="fs-1" active />);
    await emit({
      serverId: 'fs-1', protocol: 'tftp', kind: 'transfer', client: '192.0.2.1:16189',
      filename: 'ips.zip', direction: 'upload',
      // Backend sends null (serde None) when the client omits the tsize option;
      // this must render as an em dash, not the literal "null B".
      bytes: null as unknown as undefined, timestamp: 0,
    });
    expect(screen.getByText('ips.zip')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('ignores events for other panes', async () => {
    render(<FileServerPane paneId="fs-1" active />);
    await emit({ serverId: 'fs-OTHER', protocol: 'tftp', kind: 'status', status: 'running', timestamp: 0 });
    expect(screen.getAllByText('Stopped')).toHaveLength(2);
  });

  it('shows a backend error and clears it on the next start', async () => {
    setConfig({ rootDir: 'C:/firmware' });
    render(<FileServerPane paneId="fs-1" active />);
    await emit({
      serverId: 'fs-1', protocol: 'tftp', kind: 'error',
      message: "TFTP upload failed: 'rtr1.cfg' from 192.0.2.5:5000 — uploads are disabled.", timestamp: 0,
    });
    expect(screen.getByText(/uploads are disabled/i)).toBeTruthy();
    fireEvent.click(card('TFTP').getByRole('switch'));
    await waitFor(() => expect(screen.queryByText(/uploads are disabled/i)).toBeNull());
  });

  describe('firewall status', () => {
    /** Render and let the before-start check report `report`. */
    const renderWith = async (report: FirewallReport) => {
      vi.mocked(tauriService.fileServerFirewallStatus).mockResolvedValue(report);
      render(<FileServerPane paneId="fs-1" active />);
      await waitFor(() => expect(tauriService.fileServerFirewallStatus).toHaveBeenCalledWith('tftp', 69));
    };

    it('checks before any server starts', async () => {
      await renderWith({ status: 'allowed' });
      await waitFor(() => expect(card('TFTP').getByText(/Passes the firewall/)).toBeTruthy());
      expect(tauriService.fileServerFirewallStatus).toHaveBeenCalledWith('sftp', 2222);
    });

    it('names the other HoTTY installation when its rule is the one that exists', async () => {
      await renderWith({ status: 'blocked', reason: 'otherExeRule', otherExePath: 'C:\\dev\\HoTTY\\target\\debug\\hotty.exe' });
      await waitFor(() => expect(card('TFTP').getByText(/Blocked by Windows Firewall/)).toBeTruthy());
      expect(card('TFTP').getByRole('button', { name: /Allow through firewall/ })).toBeTruthy();
      expect(card('TFTP').getByText(/C:\\dev\\HoTTY\\target\\debug\\hotty\.exe/)).toBeTruthy();
    });

    it('still offers the fix when the status is unknown', async () => {
      await renderWith({ status: 'unknown', reason: 'queryFailed' });
      await waitFor(() => expect(card('TFTP').getByText('Firewall status unknown')).toBeTruthy());
      expect(card('TFTP').getByRole('button', { name: /Allow through firewall/ })).toBeTruthy();
    });

    it('adds the rule and re-checks when Allow is clicked', async () => {
      await renderWith({ status: 'blocked', reason: 'noRule' });
      await waitFor(() => card('TFTP').getByRole('button', { name: /Allow through firewall/ }));
      vi.mocked(tauriService.fileServerFirewallStatus).mockResolvedValue({ status: 'allowed' });
      fireEvent.click(card('TFTP').getByRole('button', { name: /Allow through firewall/ }));
      await waitFor(() => expect(tauriService.fileServerFirewallAllow).toHaveBeenCalledWith('tftp', 69));
      await waitFor(() => expect(card('TFTP').getByText(/Passes the firewall/)).toBeTruthy());
    });

    it('shows nothing where the check does not apply', async () => {
      await renderWith({ status: 'notApplicable' });
      await waitFor(() => expect(card('TFTP').queryByText(/firewall/i)).toBeNull());
    });
  });
});
