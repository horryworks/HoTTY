import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InterfaceTrafficPane } from './InterfaceTrafficPane';
import { tauriService } from '../../services/tauriService';

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

vi.mock('../../hooks/useResize', () => ({
  useResize: () => ({ startResize: vi.fn(), isResizing: false }),
}));

const mockStart = vi.mocked(tauriService.snmpWatcherStart);
const mockStop = vi.mocked(tauriService.snmpWatcherStop);
const mockUpdateInterval = vi.mocked(tauriService.snmpWatcherUpdateInterval);
const mockEncrypt = vi.mocked(tauriService.dpapiEncrypt);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(tauriService.onSnmpWatcherData).mockResolvedValue(() => {});
  vi.mocked(tauriService.onSnmpWatcherStatus).mockResolvedValue(() => {});
  mockEncrypt.mockImplementation(async (v: string) => `[SAFE]${v}`);
});

describe('InterfaceTrafficPane', () => {
  it('renders the toolbar and the empty-state prompt', () => {
    render(<InterfaceTrafficPane paneId="if-1" active />);
    expect(screen.getByText('Interface Traffic')).toBeTruthy();
    expect(screen.getByText(/Enter the device details/)).toBeTruthy();
  });

  it('refuses to start without a host', async () => {
    render(<InterfaceTrafficPane paneId="if-1" active />);
    fireEvent.click(screen.getByText('Start'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('starts a v2c watcher with the entered community', async () => {
    render(<InterfaceTrafficPane paneId="if-1" active />);
    fireEvent.change(screen.getByPlaceholderText('192.0.2.10'), {
      target: { value: '192.0.2.20' },
    });
    const community = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(community, { target: { value: 'public' } });
    fireEvent.click(screen.getByText('Start'));

    await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
    expect(mockStart).toHaveBeenCalledWith(
      'if-1',
      expect.objectContaining({ host: '192.0.2.20', port: 161, version: 'v2c', community: 'public' }),
      60000
    );
  });

  it('sends the v3 fields once the version is switched', async () => {
    render(<InterfaceTrafficPane paneId="if-1" active />);
    fireEvent.change(screen.getByPlaceholderText('192.0.2.10'), {
      target: { value: 'switch-01' },
    });
    const versionSelect = screen.getByDisplayValue('SNMPv2c');
    fireEvent.change(versionSelect, { target: { value: 'v3' } });

    const passwords = document.querySelectorAll('input[type="password"]');
    // authPriv is the default level, so both auth and privacy fields are shown.
    expect(passwords).toHaveLength(2);
    fireEvent.change(passwords[0], { target: { value: 'authpass123' } });
    fireEvent.change(passwords[1], { target: { value: 'privpass123' } });

    fireEvent.click(screen.getByText('Start'));
    await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
    expect(mockStart.mock.calls[0][1]).toMatchObject({
      version: 'v3',
      securityLevel: 'authPriv',
      authProtocol: 'sha256',
      authPassword: 'authpass123',
      privProtocol: 'aes128',
      privPassword: 'privpass123',
    });
  });

  it('hides the privacy fields at authNoPriv', async () => {
    render(<InterfaceTrafficPane paneId="if-1" active />);
    fireEvent.change(screen.getByDisplayValue('SNMPv2c'), { target: { value: 'v3' } });
    fireEvent.change(screen.getByDisplayValue('authPriv'), { target: { value: 'authNoPriv' } });
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(1);
  });

  it('stops the watcher and restores the Start button', async () => {
    render(<InterfaceTrafficPane paneId="if-1" active />);
    fireEvent.change(screen.getByPlaceholderText('192.0.2.10'), { target: { value: 'sw1' } });
    fireEvent.click(screen.getByText('Start'));
    await waitFor(() => expect(screen.getByText('Stop')).toBeTruthy());

    fireEvent.click(screen.getByText('Stop'));
    await waitFor(() => expect(mockStop).toHaveBeenCalledWith('if-1'));
    expect(screen.getByText('Start')).toBeTruthy();
  });

  it('only pushes an interval change to the backend while running', async () => {
    render(<InterfaceTrafficPane paneId="if-1" active />);
    const select = document.querySelector('.itw-interval-select') as HTMLSelectElement;

    fireEvent.change(select, { target: { value: '30000' } });
    await waitFor(() => expect(select.value).toBe('30000'));
    expect(mockUpdateInterval).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('192.0.2.10'), { target: { value: 'sw1' } });
    fireEvent.click(screen.getByText('Start'));
    await waitFor(() => expect(mockStart).toHaveBeenCalled());

    fireEvent.change(select, { target: { value: '60000' } });
    await waitFor(() => expect(mockUpdateInterval).toHaveBeenCalledWith('if-1', 60000));
  });

  it('offers only intervals at or above the 5s SNMP floor', () => {
    render(<InterfaceTrafficPane paneId="if-1" active />);
    const select = document.querySelector('.itw-interval-select') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => Number(o.value));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(5000);
  });

  describe('credential persistence', () => {
    it('does not write secrets to localStorage unless "remember" is ticked', async () => {
      render(<InterfaceTrafficPane paneId="if-1" active />);
      fireEvent.change(screen.getByPlaceholderText('192.0.2.10'), { target: { value: 'sw1' } });
      const community = document.querySelector('input[type="password"]') as HTMLInputElement;
      fireEvent.change(community, { target: { value: 'super-secret' } });
      fireEvent.click(screen.getByText('Start'));

      await waitFor(() => expect(mockStart).toHaveBeenCalled());
      const stored = localStorage.getItem('hotty_snmp_target_if-1') ?? '';
      expect(stored).not.toContain('super-secret');
      expect(stored).toContain('sw1');
      expect(mockEncrypt).not.toHaveBeenCalled();
    });

    it('DPAPI-encrypts secrets before storing them when "remember" is ticked', async () => {
      render(<InterfaceTrafficPane paneId="if-1" active />);
      fireEvent.change(screen.getByPlaceholderText('192.0.2.10'), { target: { value: 'sw1' } });
      const community = document.querySelector('input[type="password"]') as HTMLInputElement;
      fireEvent.change(community, { target: { value: 'super-secret' } });
      fireEvent.click(
        screen.getByRole('checkbox', { name: 'Remember these connection settings' })
      );
      fireEvent.click(screen.getByText('Start'));

      await waitFor(() => expect(mockStart).toHaveBeenCalled());
      await waitFor(() => expect(mockEncrypt).toHaveBeenCalledWith('super-secret'));
      const stored = localStorage.getItem('hotty_snmp_target_if-1') ?? '';
      expect(stored).toContain('[SAFE]super-secret');
      // The plaintext must never be the stored form.
      expect(stored).not.toMatch(/"community":"super-secret"/);
    });
  });
});
