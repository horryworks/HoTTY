import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProtocolsTab } from './ProtocolsTab';
import { useSettingsStore } from '../../stores/settingsStore';

vi.mock('../../services/tauriService', () => ({
  tauriService: {
    getSshAlgorithms: vi.fn().mockResolvedValue({
      serverHostKey: [
        { name: 'ssh-ed25519', enabled: true },
        { name: 'ssh-rsa', enabled: false },
      ],
    }),
    saveSshAlgorithms: vi.fn().mockResolvedValue(true),
  },
}));

describe('ProtocolsTab', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
  });

  it('renders SSH and Telnet keepalive sections', () => {
    render(<ProtocolsTab />);
    expect(screen.getByText('SSH')).toBeTruthy();
    expect(screen.getByText('Telnet')).toBeTruthy();
    expect(screen.getAllByText('KeepAlive').length).toBeGreaterThanOrEqual(2);
  });

  it('toggles SSH keepalive', () => {
    render(<ProtocolsTab />);
    const labels = screen.getAllByText('Enable');
    const sshCheckbox = labels[0].querySelector('input[type="checkbox"]') as HTMLInputElement;
    const before = useSettingsStore.getState().sshKeepAliveEnabled;
    fireEvent.click(sshCheckbox);
    expect(useSettingsStore.getState().sshKeepAliveEnabled).toBe(!before);
  });

  it('edits SSH keepalive interval', () => {
    render(<ProtocolsTab />);
    const inputs = screen.getAllByRole('spinbutton');
    // inputs[0] is SSH Connect Timeout; inputs[1] is SSH Keepalive Interval.
    fireEvent.change(inputs[1], { target: { value: '20' } });
    expect(useSettingsStore.getState().sshKeepAliveInterval).toBe(20);
  });

  it('toggles Telnet keepalive', () => {
    render(<ProtocolsTab />);
    const labels = screen.getAllByText('Enable');
    const telnetCheckbox = labels[1].querySelector('input[type="checkbox"]') as HTMLInputElement;
    const before = useSettingsStore.getState().telnetKeepAliveEnabled;
    fireEvent.click(telnetCheckbox);
    expect(useSettingsStore.getState().telnetKeepAliveEnabled).toBe(!before);
  });

  it('disables interval input when keepalive is disabled', () => {
    useSettingsStore.getState().update('sshKeepAliveEnabled', false);
    render(<ProtocolsTab />);
    const inputs = screen.getAllByRole('spinbutton');
    // After adding Connect Timeout inputs, the SSH keepalive interval is the
    // second spinbutton (Connect Timeout, then KeepAlive Interval).
    expect(inputs[1]).toHaveProperty('disabled', true);
  });

  it('renders SSH and Telnet connect timeout inputs with default 5', () => {
    render(<ProtocolsTab />);
    const labels = screen.getAllByText('Timeout (seconds)');
    expect(labels.length).toBe(2);
    const inputs = screen.getAllByRole('spinbutton');
    // Order in the DOM: SSH Timeout, SSH Interval, Telnet Timeout, Telnet Interval
    expect((inputs[0] as HTMLInputElement).value).toBe('5');
    expect((inputs[2] as HTMLInputElement).value).toBe('5');
  });

  it('edits SSH connect timeout', () => {
    render(<ProtocolsTab />);
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '7' } });
    expect(useSettingsStore.getState().sshConnectTimeoutSecs).toBe(7);
  });

  it('edits Telnet connect timeout', () => {
    render(<ProtocolsTab />);
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[2], { target: { value: '12' } });
    expect(useSettingsStore.getState().telnetConnectTimeoutSecs).toBe(12);
  });
});
