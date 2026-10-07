import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// Shared, mutable holders captured by the mocks below. `vi.hoisted` runs before
// the module mocks are evaluated, so the holders exist when the factories close
// over them.
const h = vi.hoisted(() => ({
    onAiChatResponseCb: { current: null as null | ((d: unknown) => void) },
    onAiAuthResultCb: { current: null as null | ((r: { success: boolean }) => void) },
    onRunCommand: vi.fn(),
    onUpdateTabById: vi.fn(),
    onEnqueuePending: vi.fn(),
    onDequeuePending: vi.fn(),
    onEnqueuePendingUser: vi.fn(),
    onDequeuePendingUser: vi.fn(),
    ensureConsent: vi.fn().mockResolvedValue(true),
    settings: {
        activeAiProvider: 'gemini',
        commandExecutionMode: 'auto-execute-safe',
        whitelistCommands: ['display', 'show', 'ls', 'cat', 'ping', 'git'] as string[],
        blacklistCommands: ['sudo', 'rm -rf', 'reboot', 'shutdown', 'mkfs'] as string[],
        maxConsecutiveAutoExecutions: 5,
        classifierStrategy: 'hybrid',
        aiClassifyConfidenceThreshold: 0.7,
        aiDataConsentAccepted: true,
        watchBufferLimit: 500000,
        terminalBackground: '#000',
        theme: 'dark',
        update: vi.fn(),
    },
    // Default AI verdict for gray-zone commands; individual tests override.
    aiClassifyCommand: vi.fn().mockResolvedValue({ modifiesState: false, confidence: 0.95, reason: 'read-only' }),
}));

vi.mock('../../services/tauriService', () => ({
    tauriService: {
        aiAuthLogout: vi.fn().mockResolvedValue(undefined),
        aiAuthAuto: vi.fn().mockResolvedValue(false),
        aiSetProvider: vi.fn().mockResolvedValue(undefined),
        aiChatSend: vi.fn().mockResolvedValue(undefined),
        aiChatCancel: vi.fn().mockResolvedValue(undefined),
        aiChatClear: vi.fn().mockResolvedValue(undefined),
        aiClassifyCommand: h.aiClassifyCommand,
        aiListModels: vi.fn().mockResolvedValue([]),
        aiListLocations: vi.fn().mockResolvedValue([]),
        aiSetLocation: vi.fn().mockResolvedValue(undefined),
        dpapiDecrypt: vi.fn().mockResolvedValue(''),
        dpapiEncrypt: vi.fn().mockResolvedValue(''),
        logDebug: vi.fn().mockResolvedValue(undefined),
        focusWindow: vi.fn().mockResolvedValue(undefined),
        onAiChatResponse: vi.fn((cb: (d: unknown) => void) => {
            h.onAiChatResponseCb.current = cb;
            return Promise.resolve(() => {});
        }),
        onAiAuthResult: vi.fn((cb: (r: { success: boolean }) => void) => {
            h.onAiAuthResultCb.current = cb;
            return Promise.resolve(() => {});
        }),
        selectServiceAccountKeyFile: vi.fn().mockResolvedValue(null),
    },
}));

vi.mock('../../utils/applyTheme', () => ({ applyTheme: vi.fn() }));

vi.mock('../../themes/defaults', () => ({
    getTheme: () => ({
        terminal: { foreground: '#fff', background: '#000', backgroundInactive: '#111', paneBackground: '#222' },
    }),
    DEFAULT_THEMES: {},
    DEFAULT_THEME_IDS: [],
}));

vi.mock('../../stores/settingsStore', () => ({
    useSettingsStore: Object.assign(
        (selector: (s: Record<string, unknown>) => unknown) => selector(h.settings),
        { getState: () => h.settings },
    ),
}));

// jsdom doesn't implement scrollIntoView, which the message-list auto-scroll calls.
Element.prototype.scrollIntoView = vi.fn();

const { AIChatPane } = await import('./AIChatPane');
const { _clearVerdictCache } = await import('../../utils/aiCommandClassifier');
const { tauriService } = await import('../../services/tauriService');
const { useAiAuthStore } = await import('../../stores/aiAuthStore');

// The auth store is module-global; reset it between tests so a prior test's
// authenticated state can't leak into the next one.
beforeEach(() => {
    act(() => {
        useAiAuthStore.setState({ isAuthenticated: false, isAuthLoading: false, authError: null });
    });
});


const baseProps = {
    paneId: 'ai-1',
    active: true,
    aiPersonas: [
        { id: 'default', label: 'Network Expert', systemPrompt: 'You are a network expert.' },
    ],
    chatState: {
        selectedModel: 'gemini-pro',
        systemInstruction: 'You are a helpful assistant.',
        activeTabId: 't1',
        tabs: [{ id: 't1', title: 'Local USG', ordinal: 1, linkedSessions: [{ sessionId: 'sess-1' }] }],
    },
    sessions: new Map([['sess-1', { id: 'sess-1', displayName: 'Local USG', status: 'connected' }]]),
    onEnqueuePending: h.onEnqueuePending,
    onDequeuePending: h.onDequeuePending,
    onEnqueuePendingUser: h.onEnqueuePendingUser,
    onDequeuePendingUser: h.onDequeuePendingUser,
    ensureConsent: h.ensureConsent,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makePane = (extra: Record<string, unknown>) => <AIChatPane {...(baseProps as any)} {...(extra as any)} />;
const renderPane = (extra: Record<string, unknown>) => render(makePane(extra));

async function authenticate() {
    // Auth is window-global now (aiAuthStore, fed by useAiAuthOwner in App);
    // the pane just consumes the store, so flip it directly.
    await act(async () => {
        useAiAuthStore.setState({ isAuthenticated: true });
    });
}

/** Send `text` and stream `chunks` without finishing (no `done`). */
async function sendAndStream(text: string, chunks: string[]) {
    const textarea = screen.getByPlaceholderText('Type a message...');
    await act(async () => { fireEvent.change(textarea, { target: { value: text } }); });
    await act(async () => { fireEvent.keyDown(textarea, { key: 'Enter' }); });
    for (const content of chunks) {
        await act(async () => {
            h.onAiChatResponseCb.current?.({ sessionId: 'ai-1::t1', responseType: 'chunk', content });
        });
    }
    await act(async () => { await Promise.resolve(); });
}

describe('AIChatPane Stop (■)', () => {
    beforeEach(() => {
        h.onRunCommand.mockClear();
        h.onAiChatResponseCb.current = null;
        h.onAiAuthResultCb.current = null;
        vi.mocked(tauriService.aiChatSend).mockReset().mockResolvedValue(undefined);
        localStorage.clear();
        _clearVerdictCache();
    });

    it('does NOT auto-execute a command that arrived in the stopped partial answer', async () => {
        renderPane({ onRunCommand: h.onRunCommand });
        await authenticate();
        // The partial already holds a closed, whitelisted execute fence; the
        // model was still talking when the user stopped it.
        await sendAndStream('check', ['Identifying.\n\n```execute\ndisplay version\n```\nand then']);

        await act(async () => { fireEvent.click(screen.getByLabelText('Stop')); });
        await act(async () => { await Promise.resolve(); });

        expect(tauriService.aiChatCancel).toHaveBeenCalledWith('ai-1::t1');
        expect(h.onRunCommand).not.toHaveBeenCalled();
        // The block stays, with its manual Run button.
        expect(screen.getByRole('button', { name: /Run in Terminal/i })).toBeTruthy();
    });

    it('keeps a draft typed during the stream; restores the sent text only into an empty box', async () => {
        renderPane({});
        await authenticate();
        await sendAndStream('first question', ['thinking']);
        const textarea = screen.getByPlaceholderText('Type a message...') as HTMLTextAreaElement;
        await act(async () => { fireEvent.change(textarea, { target: { value: 'my draft' } }); });

        await act(async () => { fireEvent.click(screen.getByLabelText('Stop')); });
        expect(textarea.value).toBe('my draft');

        // Empty box → the stopped question comes back for editing.
        await act(async () => { fireEvent.change(textarea, { target: { value: '' } }); });
        await act(async () => { fireEvent.keyDown(textarea, { key: 'Enter' }); }); // nothing to send
        await sendAndStream('second question', []);
        await act(async () => { fireEvent.click(screen.getByLabelText('Stop')); });
        expect(textarea.value).toBe('second question');
    });

    it('a send the backend refuses ends the stream with an error bubble instead of "Thinking…"', async () => {
        vi.mocked(tauriService.aiChatSend).mockRejectedValueOnce(new Error('message exceeds maximum length'));
        renderPane({});
        await authenticate();
        await sendAndStream('huge', []);
        await act(async () => { await Promise.resolve(); });

        expect(screen.queryByLabelText('Stop')).toBeNull();
        expect(screen.getByText(/message exceeds maximum length/)).toBeTruthy();
    });
});
