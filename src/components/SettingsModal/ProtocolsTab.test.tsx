import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProtocolsTab } from './ProtocolsTab';

const baseProps = {
    enabledProtocols: {
        ssh: true, telnet: true, serial: true,
        wsl: true, cmd: true, powershell: true, 'git-bash': true,
    } as Record<import('../../types/appTypes').ProtocolId, boolean>,
    onProtocolToggle: vi.fn(),
    sshKeepAliveEnabled: true,
    onSshKeepAliveEnabledChange: vi.fn(),
    sshKeepAliveInterval: 10,
    onSshKeepAliveIntervalChange: vi.fn(),
    telnetKeepAliveEnabled: true,
    onTelnetKeepAliveEnabledChange: vi.fn(),
    telnetKeepAliveInterval: 30,
    onTelnetKeepAliveIntervalChange: vi.fn(),
    sshAlgorithms: {},
    onAlgorithmToggle: vi.fn(),
};

describe('ProtocolsTab', () => {
    it('renders all protocol toggles', () => {
        render(<ProtocolsTab {...baseProps} />);
        expect(screen.getByText('SSH')).toBeInTheDocument();
        expect(screen.getByText('Telnet')).toBeInTheDocument();
        expect(screen.getByText('Serial')).toBeInTheDocument();
        expect(screen.getByText('WSL')).toBeInTheDocument();
        expect(screen.getByText('Command Prompt')).toBeInTheDocument();
        expect(screen.getByText('PowerShell')).toBeInTheDocument();
        expect(screen.getByText('Git Bash')).toBeInTheDocument();
    });

    it('shows SSH settings when SSH is enabled', () => {
        render(<ProtocolsTab {...baseProps} />);
        expect(screen.getByText('SSH KeepAlive')).toBeInTheDocument();
    });

    it('hides SSH settings when SSH is disabled', () => {
        render(<ProtocolsTab {...baseProps} enabledProtocols={{ ...baseProps.enabledProtocols, ssh: false }} />);
        expect(screen.queryByText('SSH KeepAlive')).not.toBeInTheDocument();
    });

    it('shows Telnet settings when Telnet is enabled', () => {
        render(<ProtocolsTab {...baseProps} />);
        expect(screen.getByText('Telnet KeepAlive')).toBeInTheDocument();
    });

    it('hides Telnet settings when Telnet is disabled', () => {
        render(<ProtocolsTab {...baseProps} enabledProtocols={{ ...baseProps.enabledProtocols, telnet: false }} />);
        expect(screen.queryByText('Telnet KeepAlive')).not.toBeInTheDocument();
    });

    it('calls onProtocolToggle when a protocol checkbox is clicked', () => {
        const fn = vi.fn();
        render(<ProtocolsTab {...baseProps} onProtocolToggle={fn} />);
        const sshCheckbox = screen.getByText('SSH').closest('label')!.querySelector('input')!;
        fireEvent.click(sshCheckbox);
        expect(fn).toHaveBeenCalledWith('ssh', false);
    });
});
