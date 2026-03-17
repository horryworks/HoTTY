import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { SettingsModal } from './SettingsModal';

vi.mock('../../services/electronService', () => ({
    getThemes: vi.fn(() => Promise.resolve({})),
    getSshAlgorithms: vi.fn(() => Promise.resolve({ kex: [], cipher: [], mac: [], compress: [] })),
    saveSshAlgorithms: vi.fn(),
    saveCustomTheme: vi.fn(),
    deleteCustomTheme: vi.fn(),
    selectImage: vi.fn(),
    selectFolder: vi.fn(),
    updateLogging: vi.fn(),
    openDebugLogFolder: vi.fn(),
    logDebug: vi.fn(),
    getAppVersion: vi.fn(() => Promise.resolve('1.0.0')),
    aiAuthStatus: vi.fn(() => Promise.resolve(false)),
    aiAuthLogout: vi.fn(),
    openExternal: vi.fn(),
}));

vi.mock('../../hooks/useDraggable', () => ({
    useDraggable: vi.fn(() => ({
        position: { x: 0, y: 0 },
        onMouseDown: vi.fn(),
    })),
}));

vi.mock('../../hooks/useFocusTrap', () => ({
    useFocusTrap: vi.fn(),
}));

const baseProps = {
    isOpen: true,
    onClose: vi.fn(),
    onLogout: vi.fn(),
    encoding: 'utf8',
    onEncodingChange: vi.fn(),
    fontSize: 14,
    onFontSizeChange: vi.fn(),
    fontFamily: 'Consolas',
    onFontFamilyChange: vi.fn(),
    sshKeepAliveEnabled: false,
    onSshKeepAliveEnabledChange: vi.fn(),
    sshKeepAliveInterval: 30,
    onSshKeepAliveIntervalChange: vi.fn(),
    telnetKeepAliveEnabled: false,
    onTelnetKeepAliveEnabledChange: vi.fn(),
    telnetKeepAliveInterval: 30,
    onTelnetKeepAliveIntervalChange: vi.fn(),
    themesData: { dark: { name: 'Dark', variables: {}, terminal: {} } },
    paneBackground: '#1e1e1e',
    onPaneBackgroundChange: vi.fn(),
    paneBackgroundMode: 'color' as const,
    onPaneBackgroundModeChange: vi.fn(),
    paneBackgroundImage: '',
    onPaneBackgroundImageChange: vi.fn(),
    loggingEnabled: false,
    onLoggingEnabledChange: vi.fn(),
    loggingPath: '',
    onLoggingPathChange: vi.fn(),
    scrollback: 1000,
    onScrollbackChange: vi.fn(),
    theme: 'dark',
    onThemeChange: vi.fn(),
    onOpenCustomThemeCreator: vi.fn(),
    onDeleteTheme: vi.fn(),
    sidebarPosition: 'right' as const,
    onSidebarPositionChange: vi.fn(),
    showSystemPrompt: false,
    onShowSystemPromptChange: vi.fn(),
    askAiCommands: [],
    onAskAiCommandsChange: vi.fn(),
    aiPersonas: [],
    onAiPersonasChange: vi.fn(),
    backspaceSendsDel: false,
    onBackspaceSendsDelChange: vi.fn(),
    rightClickPaste: false,
    onRightClickPasteChange: vi.fn(),
    enablePromptHighlight: false,
    onEnablePromptHighlightChange: vi.fn(),
    promptHighlightColor: '#ffff00',
    onPromptHighlightColorChange: vi.fn(),
    promptPatterns: [],
    onPromptPatternsChange: vi.fn(),
    watchBufferLimit: 100000,
    onWatchBufferLimitChange: vi.fn(),
    proactiveInstruction: '',
    onProactiveInstructionChange: vi.fn(),
    interactiveStabilizationTimeout: 400,
    onInteractiveStabilizationTimeoutChange: vi.fn(),
};

// Helper to render and let async effects settle
const renderAndSettle = async (ui: React.ReactElement) => {
    let result!: ReturnType<typeof render>;
    await act(async () => {
        result = render(ui);
    });
    return result;
};

describe('SettingsModal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders nothing when isOpen is false', () => {
        const { container } = render(<SettingsModal {...baseProps} isOpen={false} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders the Settings heading when open', async () => {
        await renderAndSettle(<SettingsModal {...baseProps} />);
        expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    it('renders all tab buttons', async () => {
        await renderAndSettle(<SettingsModal {...baseProps} />);
        expect(screen.getByText('System')).toBeInTheDocument();
        expect(screen.getByText('Appearance')).toBeInTheDocument();
        expect(screen.getByText('SSH')).toBeInTheDocument();
        expect(screen.getByText('Telnet')).toBeInTheDocument();
        expect(screen.getByText('AI')).toBeInTheDocument();
        expect(screen.getByText('About')).toBeInTheDocument();
    });

    it('shows System tab content by default', async () => {
        await renderAndSettle(<SettingsModal {...baseProps} />);
        expect(screen.getByText('Logging')).toBeInTheDocument();
    });

    it('switches to Appearance tab when clicked', async () => {
        await renderAndSettle(<SettingsModal {...baseProps} />);
        fireEvent.click(screen.getByText('Appearance'));
        expect(screen.getByText('Theme')).toBeInTheDocument();
    });

    it('switches to SSH tab when clicked', async () => {
        await renderAndSettle(<SettingsModal {...baseProps} />);
        fireEvent.click(screen.getByText('SSH'));
        expect(screen.getByText('SSH KeepAlive')).toBeInTheDocument();
    });

    it('switches to Telnet tab when clicked', async () => {
        await renderAndSettle(<SettingsModal {...baseProps} />);
        fireEvent.click(screen.getByText('Telnet'));
        expect(screen.getByText('Telnet KeepAlive')).toBeInTheDocument();
    });

    it('switches to AI tab when clicked', async () => {
        await renderAndSettle(<SettingsModal {...baseProps} />);
        fireEvent.click(screen.getByText('AI'));
        expect(screen.getByText('AI Provider Authentication')).toBeInTheDocument();
    });

    it('switches to About tab when clicked', async () => {
        await renderAndSettle(<SettingsModal {...baseProps} />);
        fireEvent.click(screen.getByText('About'));
        expect(screen.getByText('HoTTY')).toBeInTheDocument();
    });

    it('calls onClose when close button is clicked and logging is not enabled without a path', async () => {
        const onClose = vi.fn();
        await renderAndSettle(<SettingsModal {...baseProps} onClose={onClose} loggingEnabled={false} />);
        const closeBtn = screen.getByText('✕');
        fireEvent.click(closeBtn);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls getAppVersion on mount when isOpen is true', async () => {
        const { getAppVersion } = await import('../../services/electronService');
        await renderAndSettle(<SettingsModal {...baseProps} />);
        await waitFor(() => {
            expect(getAppVersion).toHaveBeenCalled();
        });
    });

    it('shows download button in About tab when updateInfo is provided', async () => {
        const updateInfo = { version: '2.0.0', releaseUrl: 'https://example.com/release' };
        await renderAndSettle(<SettingsModal {...baseProps} updateInfo={updateInfo} />);
        fireEvent.click(screen.getByText('About'));
        expect(screen.getByText(/Download v2\.0\.0/)).toBeInTheDocument();
    });

    it('does not show download button in About tab when updateInfo is null', async () => {
        await renderAndSettle(<SettingsModal {...baseProps} updateInfo={null} />);
        fireEvent.click(screen.getByText('About'));
        expect(screen.queryByText(/Download v/)).not.toBeInTheDocument();
    });

    it('calls openExternal with releaseUrl when download button is clicked', async () => {
        const { openExternal } = await import('../../services/electronService');
        const updateInfo = { version: '2.0.0', releaseUrl: 'https://example.com/release' };
        await renderAndSettle(<SettingsModal {...baseProps} updateInfo={updateInfo} />);
        fireEvent.click(screen.getByText('About'));
        fireEvent.click(screen.getByText(/Download v2\.0\.0/));
        expect(openExternal).toHaveBeenCalledWith('https://example.com/release');
    });
});
