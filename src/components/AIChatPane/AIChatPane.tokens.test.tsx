import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// 2.5c — per-tab token/cost accounting. A `done` event's usage is added to the
// tab that streamed it, so a tab switch shows that tab's running total (not the
// pane-global sum that used to leak across tabs / survive a wrong "New chat").
const h = vi.hoisted(() => ({
    onAiChatResponseCb: { current: null as null | ((d: unknown) => void) },
    settings: {
        activeAiProvider: 'gemini',
        commandExecutionMode: 'ask-before-execute',
        whitelistCommands: [] as string[],
        blacklistCommands: [] as string[],
        maxConsecutiveAutoExecutions: 5,
        classifierStrategy: 'hybrid',
        aiClassifyConfidenceThreshold: 0.7,
        aiDataConsentAccepted: true,
        aiAutoExecCountdownSecs: 0,
        watchBufferLimit: 500000,
        terminalBackground: '#000',
        theme: 'dark',
        update: vi.fn(),
    },
}));

vi.mock('../../services/tauriService', () => ({
    tauriService: {
        aiChatSend: vi.fn().mockResolvedValue(undefined),
        aiChatCancel: vi.fn().mockResolvedValue(undefined),
        aiChatClear: vi.fn().mockResolvedValue(undefined),
        aiClassifyCommand: vi.fn().mockResolvedValue({ modifiesState: true, confidence: 0.5, reason: 'x' }),
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

const twoTabState = {
    selectedModel: 'gemini-pro',
    systemInstruction: 'You are a helpful assistant.',
    activeTabId: 't1',
    tabs: [
        { id: 't1', title: 'Tab 1', ordinal: 1 },
        { id: 't2', title: 'Tab 2', ordinal: 2 },
    ],
};

const baseProps = {
    paneId: 'ai-1',
    active: true,
    aiPersonas: [{ id: 'default', label: 'Assistant', systemPrompt: 'You are an assistant.' }],
    chatState: twoTabState,
    sessions: new Map(),
    ensureConsent: vi.fn().mockResolvedValue(true),
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makePane = (extra: Record<string, unknown>) => <AIChatPane {...(baseProps as any)} {...(extra as any)} />;

describe('AIChatPane per-tab token accounting (2.5c)', () => {
    beforeEach(() => {
        h.onAiChatResponseCb.current = null;
        localStorage.clear();
        act(() => useAiAuthStore.setState({ isAuthenticated: false, isAuthLoading: false, authError: null }));
    });

    it('scopes a done event\'s token usage to the streaming tab, and a tab switch shows that tab\'s total', async () => {
        const { rerender } = render(makePane({}));
        await act(async () => { useAiAuthStore.setState({ isAuthenticated: true }); });

        // Send on t1 and complete with usage.
        const textarea = screen.getByPlaceholderText('Type a message...');
        await act(async () => { fireEvent.change(textarea, { target: { value: 'hi' } }); });
        await act(async () => { fireEvent.keyDown(textarea, { key: 'Enter' }); });
        await act(async () => {
            h.onAiChatResponseCb.current?.({
                sessionId: 'ai-1::t1',
                responseType: 'done',
                content: 'ok',
                usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30 },
            });
        });
        await act(async () => { await Promise.resolve(); });

        // t1 shows its running total.
        expect(screen.getByText('120 in / 30 out tokens')).toBeTruthy();

        // Switch to t2 (no tokens) → the t1 total must NOT be shown.
        await act(async () => {
            rerender(makePane({ chatState: { ...twoTabState, activeTabId: 't2' } }));
        });
        expect(screen.queryByText('120 in / 30 out tokens')).toBeNull();

        // Back to t1 → the total is still there (per-tab, not lost).
        await act(async () => {
            rerender(makePane({ chatState: { ...twoTabState, activeTabId: 't1' } }));
        });
        expect(screen.getByText('120 in / 30 out tokens')).toBeTruthy();
    });
});
