import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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

beforeEach(() => {
  vi.clearAllMocks();
  eventCb = null;
  // Reset persisted config to a known baseline (empty root).
  useSettingsStore.getState().update('fileServerConfig', {
    rootDir: '',
    bindAddr: '0.0.0.0',
    tftpPort: 69,
    tftpAllowWrite: false,
    sftpPort: 2222,
    sftpUsername: 'hotty',
    sftpAllowWrite: false,
  });
});

describe('FileServerPane', () => {
  it('renders title, exposure warning, and both protocol sections', () => {
    render(<FileServerPane paneId="fs-1" active />);
    expect(screen.getByText('File Server')).toBeTruthy();
    expect(screen.getByText(/exposes the selected folder/i)).toBeTruthy();
    expect(screen.getByText('TFTP')).toBeTruthy();
    expect(screen.getByText('SFTP')).toBeTruthy();
    expect(screen.getAllByText('Start')).toHaveLength(2);
    expect(screen.getAllByText('Stopped')).toHaveLength(2);
  });

  it('blocks TFTP start without a served folder', async () => {
    render(<FileServerPane paneId="fs-1" active />);
    fireEvent.click(screen.getAllByText('Start')[0]);
    await waitFor(() => {
      expect(screen.getByText('Choose a folder to serve first')).toBeTruthy();
    });
    expect(tauriService.fileServerTftpStart).not.toHaveBeenCalled();
  });

  it('starts TFTP with the configured parameters', async () => {
    render(<FileServerPane paneId="fs-1" active />);
    fireEvent.change(screen.getByPlaceholderText('Choose a folder to share…'), {
      target: { value: 'C:/firmware' },
    });
    fireEvent.click(screen.getAllByText('Start')[0]);
    await waitFor(() => {
      expect(tauriService.fileServerTftpStart).toHaveBeenCalledWith('fs-1', '0.0.0.0', 69, 'C:/firmware', false);
    });
  });

  it('shows Running and Stop once a running status event arrives', async () => {
    render(<FileServerPane paneId="fs-1" active />);
    await emit({ serverId: 'fs-1', protocol: 'tftp', kind: 'status', status: 'running', timestamp: 0 });
    expect(screen.getByText('Stop')).toBeTruthy();
    expect(screen.getByText('Running')).toBeTruthy();
  });

  it('requires SFTP credentials before starting', async () => {
    render(<FileServerPane paneId="fs-1" active />);
    fireEvent.change(screen.getByPlaceholderText('Choose a folder to share…'), {
      target: { value: 'C:/firmware' },
    });
    // SFTP start is the second Start button; password is empty by default.
    fireEvent.click(screen.getAllByText('Start')[1]);
    await waitFor(() => {
      expect(screen.getByText('Enter an SFTP username and password')).toBeTruthy();
    });
    expect(tauriService.fileServerSftpStart).not.toHaveBeenCalled();
  });

  it('records transfer events in the log', async () => {
    render(<FileServerPane paneId="fs-1" active />);
    expect(screen.getByText('No transfers yet')).toBeTruthy();
    await emit({
      serverId: 'fs-1',
      protocol: 'tftp',
      kind: 'transfer',
      client: '10.0.0.5:5000',
      filename: 'ios.bin',
      direction: 'download',
      bytes: 2048,
      timestamp: 0,
    });
    expect(screen.getByText('ios.bin')).toBeTruthy();
    expect(screen.getByText('10.0.0.5:5000')).toBeTruthy();
  });

  it('shows — for a transfer whose size is unknown (TFTP without tsize)', async () => {
    render(<FileServerPane paneId="fs-1" active />);
    await emit({
      serverId: 'fs-1',
      protocol: 'tftp',
      kind: 'transfer',
      client: '192.168.1.1:16189',
      filename: 'ips.zip',
      direction: 'upload',
      // Backend sends null (serde None) when the client omits the tsize option;
      // this must render as an em dash, not the literal "null B".
      bytes: null as unknown as undefined,
      timestamp: 0,
    });
    expect(screen.getByText('ips.zip')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('ignores events for other panes', async () => {
    render(<FileServerPane paneId="fs-1" active />);
    await emit({ serverId: 'fs-OTHER', protocol: 'tftp', kind: 'status', status: 'running', timestamp: 0 });
    expect(screen.queryByText('Running')).toBeNull();
    expect(screen.getAllByText('Stopped')).toHaveLength(2);
  });

  it('shows backend error events in the banner', async () => {
    render(<FileServerPane paneId="fs-1" active />);
    await emit({
      serverId: 'fs-1',
      protocol: 'tftp',
      kind: 'error',
      message: "TFTP upload failed: 'rtr1.cfg' from 10.0.0.5:5000 — uploads are disabled.",
      timestamp: 0,
    });
    expect(screen.getByText(/uploads are disabled/i)).toBeTruthy();
  });

  describe('firewall status', () => {
    /** Start TFTP, then report `report` from the firewall check. */
    const startTftpWith = async (report: FirewallReport) => {
      vi.mocked(tauriService.fileServerFirewallStatus).mockResolvedValue(report);
      render(<FileServerPane paneId="fs-1" active />);
      await emit({ serverId: 'fs-1', protocol: 'tftp', kind: 'status', status: 'running', timestamp: 0 });
      fireEvent.click(screen.getByText('Re-check'));
      await waitFor(() => {
        expect(tauriService.fileServerFirewallStatus).toHaveBeenCalledWith('tftp', 69);
      });
    };

    it('names the other HoTTY installation when its rule is the one that exists', async () => {
      await startTftpWith({
        status: 'blocked',
        reason: 'otherExeRule',
        otherExePath: 'C:\\dev\\HoTTY\\target\\debug\\hotty.exe',
      });
      await waitFor(() => {
        expect(screen.getByText(/Blocked by Windows Firewall/i)).toBeTruthy();
      });
      expect(screen.getByText('Allow through firewall')).toBeTruthy();
      expect(screen.getByText(/C:\\dev\\HoTTY\\target\\debug\\hotty\.exe/)).toBeTruthy();
    });

    it('still offers remediation when the status is unknown', async () => {
      await startTftpWith({ status: 'unknown', reason: 'queryFailed' });
      await waitFor(() => {
        expect(screen.getByText('Firewall status unknown')).toBeTruthy();
      });
      // A check we could not complete must not strand the user.
      expect(screen.getByText('Allow through firewall')).toBeTruthy();
      expect(screen.getByText(/Couldn’t determine the firewall status/i)).toBeTruthy();
    });

    it('explains a profile-scoped rule', async () => {
      await startTftpWith({ status: 'blocked', reason: 'profileMismatch' });
      await waitFor(() => {
        expect(screen.getByText(/not for the network you are on now/i)).toBeTruthy();
      });
    });

    it('offers nothing to fix when allowed', async () => {
      await startTftpWith({ status: 'allowed' });
      await waitFor(() => {
        expect(screen.getByText('Allowed through firewall')).toBeTruthy();
      });
      expect(screen.queryByText('Allow through firewall')).toBeNull();
    });

    it('adds the rule and re-checks when Allow is clicked', async () => {
      await startTftpWith({ status: 'blocked', reason: 'noRule' });
      await waitFor(() => {
        expect(screen.getByText('Allow through firewall')).toBeTruthy();
      });
      vi.mocked(tauriService.fileServerFirewallStatus).mockResolvedValue({ status: 'allowed' });
      fireEvent.click(screen.getByText('Allow through firewall'));
      await waitFor(() => {
        expect(tauriService.fileServerFirewallAllow).toHaveBeenCalledWith('tftp', 69);
      });
      await waitFor(() => {
        expect(screen.getByText('Allowed through firewall')).toBeTruthy();
      });
    });
  });
});
