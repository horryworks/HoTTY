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
    fireEvent.change(inputs[0], { target: { value: '20' } });
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
    expect(inputs[0]).toHaveProperty('disabled', true);
  });
});
