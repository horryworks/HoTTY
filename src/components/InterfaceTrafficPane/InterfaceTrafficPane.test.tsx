import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { InterfaceTrafficPane } from './InterfaceTrafficPane';
import { tauriService } from '../../services/tauriService';
import { useSettingsStore } from '../../stores/settingsStore';
import type { SnmpDataPayload, SnmpIfRow } from '../../types/appTypes';

vi.mock('../../services/tauriService', () => ({
  isEncrypted: (v: string) => v.startsWith('[SAFE]') || v.startsWith('[DPAPI]'),
  tauriService: {
    snmpListInterfaces: vi.fn(),
    snmpWatcherStart: vi.fn(),
    snmpWatcherStop: vi.fn(),
    snmpWatcherUpdateInterval: vi.fn(),
    onSnmpWatcherData: vi.fn(),
    onSnmpWatcherStatus: vi.fn(),
    dpapiEncrypt: vi.fn(),
    dpapiDecrypt: vi.fn(),
  },
}));

const mockStart = vi.mocked(tauriService.snmpWatcherStart);
const mockStop = vi.mocked(tauriService.snmpWatcherStop);
const mockUpdateInterval = vi.mocked(tauriService.snmpWatcherUpdateInterval);
const mockEncrypt = vi.mocked(tauriService.dpapiEncrypt);
const mockDecrypt = vi.mocked(tauriService.dpapiDecrypt);

let emitData: ((p: SnmpDataPayload) => void) | null = null;

const snapshot = (interfaces: SnmpIfRow[], extra: Partial<SnmpDataPayload> = {}): SnmpDataPayload => ({
  paneId: 'if-1',
  timestamp: '2026-10-09 14:05:10.000',
  status: 'ok',
  sysName: 'sw-01',
  sysUptimeSecs: 3600,
  counterWidth: 'hc',
  pollMs: 120,
  intervalMs: 10000,
  interfaces,
  ...extra,
});

const port = (ifIndex: number, name: string, extra: Partial<SnmpIfRow> = {}): SnmpIfRow => ({
  ifIndex, name, operStatus: 1, adminStatus: 1, speedMbps: 1000, discontinuity: false, ...extra,
});

const fillHost = (host: string) =>
  fireEvent.change(screen.getByPlaceholderText('192.0.2.10'), { target: { value: host } });

const connect = async () => {
  fireEvent.click(screen.getByRole('button', { name: /Connect and monitor/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: /Stop/ })).toBeTruthy());
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  act(() => useSettingsStore.getState().reset());
  emitData = null;
  vi.mocked(tauriService.onSnmpWatcherData).mockImplementation(async (cb) => {
    emitData = cb;
    return () => {};
  });
  vi.mocked(tauriService.onSnmpWatcherStatus).mockResolvedValue(() => {});
  mockStart.mockResolvedValue();
  mockStop.mockResolvedValue();
  mockUpdateInterval.mockResolvedValue();
  mockEncrypt.mockImplementation(async (v: string) => `[SAFE]${v}`);
  mockDecrypt.mockImplementation(async (v: string) => v.replace('[SAFE]', ''));
});

describe('InterfaceTrafficPane', () => {
  it('shows only the connection form before connecting', () => {
    render(<InterfaceTrafficPane paneId="if-1" active />);
    expect(screen.getByRole('button', { name: /Connect and monitor/ })).toBeTruthy();
    expect(document.querySelector('.itw-table')).toBeNull();
  });

  it('refuses to connect without a host', async () => {
    render(<InterfaceTrafficPane paneId="if-1" active />);
    fireEvent.click(screen.getByRole('button', { name: /Connect and monitor/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Enter the device host'));
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('starts a v2c watcher with the community at a 10s interval', async () => {
    render(<InterfaceTrafficPane paneId="if-1" active />);
    fillHost('192.0.2.20');
    fireEvent.change(document.querySelector('input[type="password"]')!, { target: { value: 'public' } });
    await connect();
    expect(mockStart).toHaveBeenCalledWith(
      'if-1',
      expect.objectContaining({ host: '192.0.2.20', port: 161, version: 'v2c', community: 'public' }),
      10000,
    );
  });

  it('sends the v3 fields once v3 is picked', async () => {
    render(<InterfaceTrafficPane paneId="if-1" active />);
    fillHost('sw-01');
    fireEvent.click(screen.getByRole('button', { name: 'v3' }));
    const passwords = document.querySelectorAll('input[type="password"]');
    // authPriv is the default level, so both auth and privacy fields are shown.
    expect(passwords).toHaveLength(2);
    fireEvent.change(passwords[0], { target: { value: 'authpass123' } });
    fireEvent.change(passwords[1], { target: { value: 'privpass123' } });
    await connect();
    expect(mockStart.mock.calls[0][1]).toMatchObject({
      version: 'v3',
      securityLevel: 'authPriv',
      authProtocol: 'sha256',
      authPassword: 'authpass123',
      privProtocol: 'aes128',
      privPassword: 'privpass123',
    });
  });

  it('hides the privacy fields at authNoPriv', () => {
    render(<InterfaceTrafficPane paneId="if-1" active />);
    fireEvent.click(screen.getByRole('button', { name: 'v3' }));
    fireEvent.change(screen.getByDisplayValue('authPriv'), { target: { value: 'authNoPriv' } });
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(1);
  });

  it('folds the form into one line naming the device while monitoring', async () => {
    render(<InterfaceTrafficPane paneId="if-1" active />);
    fillHost('192.0.2.10');
    await connect();
    expect(screen.queryByRole('button', { name: /Connect and monitor/ })).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Monitoring');
    expect(screen.getByText(/192\.0\.2\.10:161 · v2c/)).toBeTruthy();
  });

  it('stops and keeps the device view; Change goes back to the form', async () => {
    render(<InterfaceTrafficPane paneId="if-1" active />);
    fillHost('192.0.2.10');
    await connect();
    fireEvent.click(screen.getByRole('button', { name: /Stop/ }));
    await waitFor(() => expect(mockStop).toHaveBeenCalledWith('if-1'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Stopped'));
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Connect and monitor/ })).toBeTruthy());
  });

  it('changes the interval of the running watcher with one press', async () => {
    render(<InterfaceTrafficPane paneId="if-1" active />);
    fillHost('192.0.2.10');
    await connect();
    fireEvent.click(screen.getByRole('button', { name: '30s' }));
    await waitFor(() => expect(mockUpdateInterval).toHaveBeenCalledWith('if-1', 30000));
  });

  it('offers only intervals at or above the 5s SNMP floor', async () => {
    render(<InterfaceTrafficPane paneId="if-1" active />);
    fillHost('192.0.2.10');
    await connect();
    const labels = Array.from(screen.getByRole('group', { name: 'Interval' }).querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).toEqual(['5s', '10s', '30s', '60s']);
  });

  it('counts down to the second poll before rates exist', async () => {
    render(<InterfaceTrafficPane paneId="if-1" active />);
    fillHost('192.0.2.10');
    await connect();
    act(() => emitData!(snapshot([port(1, 'Gi0/1')])));
    expect(screen.getByText(/Measuring — next value in \d+s/)).toBeTruthy();
  });

  it('shows rates, an errors badge only when errors grew, and hides down ports by default', async () => {
    render(<InterfaceTrafficPane paneId="if-1" active />);
    fillHost('192.0.2.10');
    await connect();
    act(() => emitData!(snapshot([
      port(1, 'Gi0/1', { alias: 'Uplink', bpsIn: 420e6, bpsOut: 180e6, utilInPct: 42, utilOutPct: 18, inErrorsDelta: 3, outErrorsDelta: 2 }),
      port(2, 'Gi0/2', { bpsIn: 1e6, bpsOut: 1e6, inErrorsDelta: 0 }),
      port(3, 'Gi0/3', { operStatus: 2 }),
    ])));
    const rows = document.querySelectorAll('.itw-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Uplink');
    expect(rows[0].textContent).toContain('420 Mbps');
    expect(rows[0].textContent).toContain('Errors +5');
    expect(rows[1].textContent).not.toContain('Errors');
    fireEvent.click(screen.getByRole('button', { name: 'In use only' }));
    expect(document.querySelectorAll('.itw-row')).toHaveLength(3);
  });

  it('opens a port graph from its row', async () => {
    render(<InterfaceTrafficPane paneId="if-1" active />);
    fillHost('192.0.2.10');
    await connect();
    act(() => emitData!(snapshot([port(1, 'Gi0/1', { bpsIn: 1e6, bpsOut: 2e6 })])));
    fireEvent.click(screen.getByRole('button', { name: 'Show the graph for Gi0/1' }));
    expect(document.querySelector('.itw-trend')).toBeTruthy();
  });

  it('turns the status amber and fades the table while the device does not answer', async () => {
    render(<InterfaceTrafficPane paneId="if-1" active />);
    fillHost('192.0.2.10');
    await connect();
    act(() => emitData!(snapshot([port(1, 'Gi0/1', { bpsIn: 1e6, bpsOut: 1e6 })], { staleForMs: 30000, status: 'error', error: 'timeout' })));
    expect(screen.getByRole('status').textContent).toBe('No reply for 30s');
    expect(document.querySelector('.itw-table-wrapper.stale')).toBeTruthy();
  });

  describe('devices used before', () => {
    it('keeps the device without its secrets unless asked to', async () => {
      render(<InterfaceTrafficPane paneId="if-1" active />);
      fillHost('192.0.2.10');
      fireEvent.change(document.querySelector('input[type="password"]')!, { target: { value: 'super-secret' } });
      await connect();
      await waitFor(() => expect(useSettingsStore.getState().snmpDevices).toHaveLength(1));
      const saved = useSettingsStore.getState().snmpDevices[0];
      expect(saved.host).toBe('192.0.2.10');
      expect(JSON.stringify(saved)).not.toContain('super-secret');
      expect(mockEncrypt).not.toHaveBeenCalled();
    });

    it('DPAPI-encrypts the secrets when asked to remember them', async () => {
      render(<InterfaceTrafficPane paneId="if-1" active />);
      fillHost('192.0.2.10');
      fireEvent.change(document.querySelector('input[type="password"]')!, { target: { value: 'super-secret' } });
      fireEvent.click(screen.getByRole('checkbox', { name: /Remember the passwords/ }));
      await connect();
      await waitFor(() => expect(useSettingsStore.getState().snmpDevices[0]?.community).toBe('[SAFE]super-secret'));
    });

    it('fills the form from a device button in a new pane', async () => {
      act(() => useSettingsStore.getState().update('snmpDevices', [{
        host: '192.0.2.10', port: 161, version: 'v2c', username: '', securityLevel: 'authPriv',
        authProtocol: 'sha256', privProtocol: 'aes128', contextName: '', intervalMs: 10000,
        remember: true, sysName: 'sw-01', community: '[SAFE]public',
      }]));
      render(<InterfaceTrafficPane paneId="if-2" active />);
      fireEvent.click(screen.getByRole('button', { name: 'sw-01 · 192.0.2.10' }));
      await waitFor(() => expect((document.querySelector('input[type="password"]') as HTMLInputElement).value).toBe('public'));
      expect((screen.getByPlaceholderText('192.0.2.10') as HTMLInputElement).value).toBe('192.0.2.10');
    });

    it('forgets a device with its × button', () => {
      act(() => useSettingsStore.getState().update('snmpDevices', [{
        host: '192.0.2.10', port: 161, version: 'v2c', username: '', securityLevel: 'authPriv',
        authProtocol: 'sha256', privProtocol: 'aes128', contextName: '', intervalMs: 10000, remember: false,
      }]));
      render(<InterfaceTrafficPane paneId="if-1" active />);
      fireEvent.click(screen.getByRole('button', { name: 'Forget 192.0.2.10' }));
      expect(useSettingsStore.getState().snmpDevices).toEqual([]);
    });
  });
});
