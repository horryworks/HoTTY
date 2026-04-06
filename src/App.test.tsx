import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

// ── Mock external dependencies ────────────────────────────────────────────────

vi.mock('./services/electronService', () => ({
    isAvailable: vi.fn(() => !!(window as any).electronAPI),
    connectSession: vi.fn(),
    disconnectSession: vi.fn(),
    sendInput: vi.fn(),
    resize: vi.fn(),
    updateSessionEncoding: vi.fn(),
    setWindowSize: vi.fn(),
    writeClipboard: vi.fn(),
    focusWindow: vi.fn(),
    onSessionData: vi.fn(() => vi.fn()),
    onSessionStatus: vi.fn(() => vi.fn()),
    onSessionError: vi.fn(() => vi.fn()),
    listSerialPorts: vi.fn(),
    selectImage: vi.fn(),
    selectFolder: vi.fn(),
    getAppVersion: vi.fn(() => Promise.resolve('0.0.0')),
    logDebug: vi.fn(),
    openExternal: vi.fn(),
    aiAuthStart: vi.fn(),
    aiAuthAuto: vi.fn(() => Promise.resolve(false)),
    aiAuthStatus: vi.fn(() => Promise.resolve(false)),
    aiAuthLogout: vi.fn(),
    aiChatSend: vi.fn(),
    aiListModels: vi.fn(() => Promise.resolve([])),
    aiListLocations: vi.fn(() => Promise.resolve([])),
    aiChatCancel: vi.fn(),
    aiChatClear: vi.fn(),
    aiSetLocation: vi.fn(),
    aiSetProvider: vi.fn(),
    selectServiceAccountKeyFile: vi.fn(),
    onAiAuthResult: vi.fn(() => vi.fn()),
    onAiChatResponse: vi.fn(() => vi.fn()),
    showContextMenu: vi.fn(),
    onAskGemini: vi.fn(() => vi.fn()),
    onTerminalContextPaste: vi.fn(() => vi.fn()),
    getSshAlgorithms: vi.fn(() => Promise.resolve({})),
    saveSshAlgorithms: vi.fn(),
    getThemes: vi.fn(() => Promise.resolve({})),
    saveCustomTheme: vi.fn(),
    deleteCustomTheme: vi.fn(),
    encryptSecret: vi.fn(),
    decryptSecret: vi.fn(),
    encryptSecrets: vi.fn(),
    decryptSecrets: vi.fn(),
    updateLogging: vi.fn(),
    listLogFiles: vi.fn(() => Promise.resolve([])),
    readLogFile: vi.fn(() => Promise.resolve('')),
    openDebugLogFolder: vi.fn(),
    onUpdateAvailable: vi.fn(() => vi.fn()),
    onOpenFileInEditor: vi.fn(() => vi.fn()),
}));

vi.mock('@xterm/xterm', () => ({
    Terminal: vi.fn(function () {
        return {
            write: vi.fn(),
            loadAddon: vi.fn(),
            onSelectionChange: vi.fn(),
            attachCustomKeyEventHandler: vi.fn(),
            onData: vi.fn(),
            getSelection: vi.fn(() => ''),
            hasSelection: vi.fn(() => false),
            dispose: vi.fn(),
            options: { scrollback: 1000 },
        };
    }),
}));

vi.mock('@xterm/addon-fit', () => ({
    FitAddon: vi.fn(function () { return {}; }),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('App', () => {
    beforeEach(() => {
        delete (window as any).electronAPI;
        localStorage.clear();
        vi.clearAllMocks();
    });

    it('renders loading state when Electron API is not available', () => {
        render(<App />);
        expect(screen.getByText('Loading Electron API...')).toBeTruthy();
    });

    it('renders loading state with correct style', () => {
        const { container } = render(<App />);
        const div = container.querySelector('div');
        expect(div).toBeTruthy();
        expect(div!.textContent).toBe('Loading Electron API...');
    });
});
