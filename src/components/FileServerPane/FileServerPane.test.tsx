import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { FileServerPane } from './FileServerPane';
import { tauriService } from '../../services/tauriService';
import { useSettingsStore } from '../../stores/settingsStore';
import type { FileServerEvent } from '../../types/appTypes';

let eventCb: ((e: FileServerEvent) => void) | null = null;

vi.mock('../../services/tauriService', () => ({
  tauriService: {
    fileServerTftpStart: vi.fn().mockResolvedValue(undefined),
    fileServerTftpStop: vi.fn().mockResolvedValue(undefined),
    fileServerSftpStart: vi.fn().mockResolvedValue(undefined),
    fileServerSftpStop: vi.fn().mockResolvedValue(undefined),
    fileServerFirewallStatus: vi.fn().mockResolvedValue('allowed'),
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

  it('ignores events for other panes', async () => {
    render(<FileServerPane paneId="fs-1" active />);
    await emit({ serverId: 'fs-OTHER', protocol: 'tftp', kind: 'status', status: 'running', timestamp: 0 });
    expect(screen.queryByText('Running')).toBeNull();
    expect(screen.getAllByText('Stopped')).toHaveLength(2);
  });
});
