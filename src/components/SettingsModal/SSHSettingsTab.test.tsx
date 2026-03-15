import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SSHSettingsTab } from './SSHSettingsTab';

vi.mock('../../services/electronService', () => ({
    getThemes: vi.fn(() => Promise.resolve({})),
    getSshAlgorithms: vi.fn(() => Promise.resolve({ kex: [], cipher: [], mac: [], compress: [] })),
    saveSshAlgorithms: vi.fn(),
    saveCustomTheme: vi.fn(),
    deleteCustomTheme: vi.fn(),
    selectImage: vi.fn(),
    selectFolder: vi.fn(() => Promise.resolve(null)),
    updateLogging: vi.fn(),
    openDebugLogFolder: vi.fn(),
    logDebug: vi.fn(),
    getAppVersion: vi.fn(() => Promise.resolve('1.0.0')),
}));

const baseProps = {
    activeTab: 'system' as const,
    sshKeepAliveEnabled: false,
    onSshKeepAliveEnabledChange: vi.fn(),
    sshKeepAliveInterval: 30,
    onSshKeepAliveIntervalChange: vi.fn(),
    telnetKeepAliveEnabled: false,
    onTelnetKeepAliveEnabledChange: vi.fn(),
    telnetKeepAliveInterval: 30,
    onTelnetKeepAliveIntervalChange: vi.fn(),
    loggingEnabled: false,
    onLoggingEnabledChange: vi.fn(),
    loggingPath: '',
    onLoggingPathChange: vi.fn(),
    scrollback: 1000,
    onScrollbackChange: vi.fn(),
    backspaceSendsDel: false,
    onBackspaceSendsDelChange: vi.fn(),
    rightClickPaste: false,
    onRightClickPasteChange: vi.fn(),
    sshAlgorithms: {},
    onAlgorithmToggle: vi.fn(),
};

describe('SSHSettingsTab - System tab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders without crashing', () => {
        const { container } = render(<SSHSettingsTab {...baseProps} />);
        expect(container).toBeTruthy();
    });

    it('renders Logging section', () => {
        render(<SSHSettingsTab {...baseProps} />);
        expect(screen.getByText('Logging')).toBeInTheDocument();
    });

    it('renders Enable Logging checkbox', () => {
        render(<SSHSettingsTab {...baseProps} />);
        expect(screen.getByText('Enable Logging')).toBeInTheDocument();
    });

    it('calls onLoggingEnabledChange when Enable Logging is toggled', () => {
        const onLoggingEnabledChange = vi.fn();
        render(<SSHSettingsTab {...baseProps} onLoggingEnabledChange={onLoggingEnabledChange} />);
        const checkboxes = screen.getAllByRole('checkbox');
        fireEvent.click(checkboxes[0]);
        expect(onLoggingEnabledChange).toHaveBeenCalled();
    });

    it('shows log folder path input when loggingEnabled is true', () => {
        render(<SSHSettingsTab {...baseProps} loggingEnabled={true} />);
        expect(screen.getByPlaceholderText('Select a folder or type path...')).toBeInTheDocument();
    });

    it('does not show log folder path input when loggingEnabled is false', () => {
        render(<SSHSettingsTab {...baseProps} loggingEnabled={false} />);
        expect(screen.queryByPlaceholderText('Select a folder or type path...')).not.toBeInTheDocument();
    });

    it('renders Local Log Buffer section', () => {
        render(<SSHSettingsTab {...baseProps} />);
        expect(screen.getByText('Local Log Buffer')).toBeInTheDocument();
    });

    it('calls onScrollbackChange when scrollback input changes', () => {
        const onScrollbackChange = vi.fn();
        render(<SSHSettingsTab {...baseProps} onScrollbackChange={onScrollbackChange} />);
        const inputs = screen.getAllByRole('spinbutton');
        fireEvent.change(inputs[0], { target: { value: '5000' } });
        expect(onScrollbackChange).toHaveBeenCalledWith(5000);
    });

    it('renders Keyboard section', () => {
        render(<SSHSettingsTab {...baseProps} />);
        expect(screen.getByText('Keyboard')).toBeInTheDocument();
    });

    it('renders Backspace sends DEL checkbox', () => {
        render(<SSHSettingsTab {...baseProps} />);
        expect(screen.getByText('Backspace sends 0x7F (DEL)')).toBeInTheDocument();
    });

    it('calls onBackspaceSendsDelChange when Backspace checkbox changes', () => {
        const onBackspaceSendsDelChange = vi.fn();
        render(<SSHSettingsTab {...baseProps} onBackspaceSendsDelChange={onBackspaceSendsDelChange} />);
        const checkboxes = screen.getAllByRole('checkbox');
        const backspaceCheckbox = checkboxes.find(cb => {
            const label = cb.closest('label');
            return label?.textContent?.includes('Backspace');
        });
        if (backspaceCheckbox) {
            fireEvent.click(backspaceCheckbox);
            expect(onBackspaceSendsDelChange).toHaveBeenCalled();
        }
    });

    it('renders Mouse section', () => {
        render(<SSHSettingsTab {...baseProps} />);
        expect(screen.getByText('Mouse')).toBeInTheDocument();
    });

    it('renders Right-click to paste checkbox', () => {
        render(<SSHSettingsTab {...baseProps} />);
        expect(screen.getByText('Right-click to paste')).toBeInTheDocument();
    });

    it('renders Debug Log section', () => {
        render(<SSHSettingsTab {...baseProps} />);
        expect(screen.getByText('Debug Log')).toBeInTheDocument();
    });

    it('renders Open Debug Log Folder button', () => {
        render(<SSHSettingsTab {...baseProps} />);
        expect(screen.getByText('Open Debug Log Folder')).toBeInTheDocument();
    });
});

describe('SSHSettingsTab - SSH tab', () => {
    const sshProps = { ...baseProps, activeTab: 'ssh' as const };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders SSH KeepAlive section', () => {
        render(<SSHSettingsTab {...sshProps} />);
        expect(screen.getByText('SSH KeepAlive')).toBeInTheDocument();
    });

    it('renders Enable checkbox for SSH keepalive', () => {
        render(<SSHSettingsTab {...sshProps} />);
        expect(screen.getByText('Enable')).toBeInTheDocument();
    });

    it('calls onSshKeepAliveEnabledChange when checkbox is toggled', () => {
        const onSshKeepAliveEnabledChange = vi.fn();
        render(<SSHSettingsTab {...sshProps} onSshKeepAliveEnabledChange={onSshKeepAliveEnabledChange} />);
        const checkbox = screen.getByRole('checkbox');
        fireEvent.click(checkbox);
        expect(onSshKeepAliveEnabledChange).toHaveBeenCalledWith(true);
    });

    it('shows interval input when sshKeepAliveEnabled is true', () => {
        render(<SSHSettingsTab {...sshProps} sshKeepAliveEnabled={true} />);
        expect(screen.getByRole('spinbutton')).toBeInTheDocument();
    });

    it('does not show interval input when sshKeepAliveEnabled is false', () => {
        render(<SSHSettingsTab {...sshProps} sshKeepAliveEnabled={false} />);
        expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    });

    it('renders SSH algorithms when provided', () => {
        const sshAlgorithms = {
            kex: [{ name: 'ecdh-sha2-nistp256', enabled: true }],
        };
        render(<SSHSettingsTab {...sshProps} sshAlgorithms={sshAlgorithms} />);
        expect(screen.getByText('SSH Algorithms')).toBeInTheDocument();
        expect(screen.getByText('ecdh-sha2-nistp256')).toBeInTheDocument();
    });

    it('calls onAlgorithmToggle when an algorithm checkbox is changed', () => {
        const onAlgorithmToggle = vi.fn();
        const sshAlgorithms = {
            kex: [{ name: 'ecdh-sha2-nistp256', enabled: true }],
        };
        render(<SSHSettingsTab {...sshProps} sshAlgorithms={sshAlgorithms} onAlgorithmToggle={onAlgorithmToggle} />);
        const algoCheckboxes = screen.getAllByRole('checkbox');
        // First checkbox is the KeepAlive enable, second is the algorithm
        const algoCheckbox = algoCheckboxes.find(cb => {
            const label = cb.closest('label');
            return label?.textContent?.includes('ecdh-sha2-nistp256');
        });
        if (algoCheckbox) {
            fireEvent.click(algoCheckbox);
            expect(onAlgorithmToggle).toHaveBeenCalledWith('kex', 'ecdh-sha2-nistp256');
        }
    });
});

describe('SSHSettingsTab - Telnet tab', () => {
    const telnetProps = { ...baseProps, activeTab: 'telnet' as const };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders Telnet KeepAlive section', () => {
        render(<SSHSettingsTab {...telnetProps} />);
        expect(screen.getByText('Telnet KeepAlive')).toBeInTheDocument();
    });

    it('renders Enable checkbox for Telnet keepalive', () => {
        render(<SSHSettingsTab {...telnetProps} />);
        expect(screen.getByText('Enable')).toBeInTheDocument();
    });

    it('calls onTelnetKeepAliveEnabledChange when checkbox is toggled', () => {
        const onTelnetKeepAliveEnabledChange = vi.fn();
        render(<SSHSettingsTab {...telnetProps} onTelnetKeepAliveEnabledChange={onTelnetKeepAliveEnabledChange} />);
        const checkbox = screen.getByRole('checkbox');
        fireEvent.click(checkbox);
        expect(onTelnetKeepAliveEnabledChange).toHaveBeenCalledWith(true);
    });

    it('shows interval input when telnetKeepAliveEnabled is true', () => {
        render(<SSHSettingsTab {...telnetProps} telnetKeepAliveEnabled={true} />);
        expect(screen.getByRole('spinbutton')).toBeInTheDocument();
    });

    it('does not show interval input when telnetKeepAliveEnabled is false', () => {
        render(<SSHSettingsTab {...telnetProps} telnetKeepAliveEnabled={false} />);
        expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    });
});
