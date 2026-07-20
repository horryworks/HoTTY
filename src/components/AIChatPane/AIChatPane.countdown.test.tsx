import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// 2.7b — the auto-execute pre-run countdown. Verified in its own file (with a
// positive `aiAutoExecCountdownSecs`) so the existing AIChatPane.autoexec.test.tsx,
// which asserts *immediate* auto-run, stays untouched.
const h = vi.hoisted(() => ({
    onAiChatResponseCb: { current: null as null | ((d: unknown) => void) },
    onRunCommand: vi.fn(),
    settings: {
        activeAiProvider: 'gemini',
        commandExecutionMode: 'auto-execute-safe',
        // `display` is whitelisted → decideAutoExec resolves auto-run synchronously
        // (no AI classify), so the only async gate is the countdown itself.
        whitelistCommands: ['display', 'show', 'ls'] as string[],
        blacklistCommands: ['reboot'] as string[],
        maxConsecutiveAutoExecutions: 5,
        classifierStrategy: 'hybrid',
        aiClassifyConfidenceThreshold: 0.7,
        aiDataConsentAccepted: true,
        aiAutoExecCountdownSecs: 2,
        watchBufferLimit: 500000,
        terminalBackground: '#000',
        theme: 'dark',
        update: vi.fn(),
    },
    aiClassifyCommand: vi.fn().mockResolvedValue({ modifiesState: false, confidence: 0.95, reason: 'read-only' }),
}));

vi.mock('../../services/tauriService', () => ({
    tauriService: {
        aiChatSend: vi.fn().mockResolvedValue(undefined),
        aiChatCancel: vi.fn().mockResolvedValue(undefined),
        aiChatClear: vi.fn().mockResolvedValue(undefined),
        aiClassifyCommand: h.aiClassifyCommand,
        aiListModels: vi.fn().mockResolvedValue([{ name: 'gemini-pro', displayName: 'Gemini Pro' }]),
        aiListLocations: vi.fn().mockResolvedValue([]),
        aiSetLocation: vi.fn().mockResolvedValue(undefined),
        focusWindow: vi.fn().mockResolvedValue(undefined),
        onAiChatResponse: vi.fn((cb: (d: unknown) => void) => {
            h.onAiChatResponseCb.current = cb;
            return Promise.resolve(() => {});
        }),
        onAiAuthResult: vi.fn(() => Promise.resolve(() => {})),
    },
}));

vi.mock('../../utils/applyTheme', () => ({ applyTheme: vi.fn() }));
vi.mock('../../themes/defaults', () => ({
    getTheme: () => ({ terminal: { foreground: '#fff', background: '#000', backgroundInactive: '#111', paneBackground: '#222' } }),
    DEFAULT_THEMES: {},
    DEFAULT_THEME_IDS: [],
}));
vi.mock('../../stores/settingsStore', () => ({
    useSettingsStore: Object.assign(
        (selector: (s: Record<string, unknown>) => unknown) => selector(h.settings),
        { getState: () => h.settings },
    ),
}));

Element.prototype.scrollIntoView = vi.fn();

const { AIChatPane } = await import('./AIChatPane');
const { useAiAuthStore } = await import('../../stores/aiAuthStore');
const { _clearVerdictCache } = await import('../../utils/aiCommandClassifier');

// A whitelisted Huawei command wrapped in an execute fence.
const MODEL_CONTENT = 'Identifying the device.\n\n```execute\ndisplay version\n```';

const baseProps = {
    paneId: 'ai-1',
    active: true,
    aiPersonas: [{ id: 'default', label: 'Assistant', systemPrompt: 'You are an assistant.' }],
    chatState: {
        selectedModel: 'gemini-pro',
        systemInstruction: 'You are a helpful assistant.',
        activeTabId: 't1',
        tabs: [{ id: 't1', title: 'USG', ordinal: 1, linkedSessionId: 'sess-1' }],
    },
    sessions: new Map([['sess-1', { id: 'sess-1', displayName: 'USG', status: 'connected' }]]),
    ensureConsent: vi.fn().mockResolvedValue(true),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makePane = (extra: Record<string, unknown>) => <AIChatPane {...(baseProps as any)} {...(extra as any)} />;
const renderPane = (extra: Record<string, unknown>) => render(makePane(extra));

async function authenticate() {
    await act(async () => { useAiAuthStore.setState({ isAuthenticated: true }); });
}

async function sendAndComplete(text: string, content: string = MODEL_CONTENT) {
    const textarea = screen.getByPlaceholderText('Type a message...');
    await act(async () => { fireEvent.change(textarea, { target: { value: text } }); });
    await act(async () => { fireEvent.keyDown(textarea, { key: 'Enter' }); });
    await act(async () => {
        h.onAiChatResponseCb.current?.({ sessionId: 'ai-1', responseType: 'done', content });
    });
    // Flush the classify microtask chain (whitelist verdict → schedule).
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
}

describe('AIChatPane auto-run countdown (2.7b)', () => {
    beforeEach(() => {
        h.onRunCommand.mockClear();
        h.aiClassifyCommand.mockClear();
        _clearVerdictCache();
        h.onAiChatResponseCb.current = null;
        localStorage.clear();
        h.settings.commandExecutionMode = 'auto-execute-safe';
        h.settings.aiAutoExecCountdownSecs = 2;
        act(() => {
            useAiAuthStore.setState({ isAuthenticated: false, isAuthLoading: false, authError: null });
        });
    });

    it('schedules a safe command with a countdown instead of running it immediately', async () => {
        vi.useFakeTimers();
        try {
            renderPane({ onRunCommand: h.onRunCommand });
            await authenticate();
            await sendAndComplete('check');

            // The command is scheduled (countdown ticking), not yet sent.
            expect(h.onRunCommand).not.toHaveBeenCalled();
            expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
            expect(screen.queryByRole('button', { name: /Run in Terminal/i })).toBeNull();

            // Advance past the 2s grace period → it auto-runs.
            await act(async () => { vi.advanceTimersByTime(2000); });
            expect(h.onRunCommand).toHaveBeenCalledWith('sess-1', 'display version', 't1');
        } finally {
            vi.useRealTimers();
        }
    });

    it('cancelling the countdown prevents the run and restores the manual Run button', async () => {
        vi.useFakeTimers();
        try {
            renderPane({ onRunCommand: h.onRunCommand });
            await authenticate();
            await sendAndComplete('check');
            expect(h.onRunCommand).not.toHaveBeenCalled();

            await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); });

            // Even past the would-be deadline, nothing runs; the block is manual again.
            await act(async () => { vi.advanceTimersByTime(5000); });
            expect(h.onRunCommand).not.toHaveBeenCalled();
            expect(screen.getByRole('button', { name: /Run in Terminal/i })).toBeTruthy();
        } finally {
            vi.useRealTimers();
        }
    });

    it('runs immediately when the countdown is 0 (feature disabled)', async () => {
        h.settings.aiAutoExecCountdownSecs = 0;
        renderPane({ onRunCommand: h.onRunCommand });
        await authenticate();
        await sendAndComplete('check');
        expect(h.onRunCommand).toHaveBeenCalledWith('sess-1', 'display version', 't1');
    });
});
