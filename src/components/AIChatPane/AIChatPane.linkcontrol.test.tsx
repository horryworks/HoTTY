import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// 2.7b② rethink: the header link control is state-dependent — a LINKED tab shows
// the chip + an explicit unlink button; an UNLINKED tab shows a "Link a terminal"
// picker so a "+"-opened blank tab can be attached. There is no re-link dropdown
// on a linked tab (no silent mid-conversation context switch).
const h = vi.hoisted(() => ({
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
        onAiChatResponse: vi.fn(() => Promise.resolve(() => {})),
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

const baseProps = {
    paneId: 'ai-1',
    active: true,
    aiPersonas: [{ id: 'default', label: 'Assistant', systemPrompt: 'You are an assistant.' }],
    sessions: new Map([['sess-1', { id: 'sess-1', displayName: 'Local USG', status: 'connected' }]]),
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makePane = (extra: Record<string, unknown>) => <AIChatPane {...(baseProps as any)} {...(extra as any)} />;

describe('AIChatPane link control (state-dependent)', () => {
    beforeEach(() => {
        localStorage.clear();
        act(() => useAiAuthStore.setState({ isAuthenticated: false, isAuthLoading: false, authError: null }));
    });

    it('a LINKED tab shows the chip + an unlink button; unlink calls onLinkSession(undefined)', async () => {
        const onLinkSession = vi.fn();
        render(makePane({
            chatState: {
                selectedModel: 'gemini-pro',
                systemInstruction: 'x',
                activeTabId: 't1',
                tabs: [{ id: 't1', title: 'Local USG', ordinal: 1, linkedSessionId: 'sess-1' }],
            },
            onLinkSession,
        }));
        await act(async () => { useAiAuthStore.setState({ isAuthenticated: true }); });

        // Chip present with the terminal name.
        const chip = document.querySelector('.ai-chat-linked-chip');
        expect(chip?.textContent).toContain('Local USG');
        // No "Link a terminal" picker on a linked tab.
        expect(screen.queryByRole('combobox', { name: 'Link a terminal' })).toBeNull();

        // Unlink detaches via onLinkSession(undefined).
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Unlink terminal' })); });
        expect(onLinkSession).toHaveBeenCalledWith(undefined);
    });

    it('an UNLINKED tab shows the "Link a terminal" picker; choosing a session links it', async () => {
        const onLinkSession = vi.fn();
        render(makePane({
            chatState: {
                selectedModel: 'gemini-pro',
                systemInstruction: 'x',
                activeTabId: 't1',
                tabs: [{ id: 't1', title: 'Tab 1', ordinal: 1 }], // no linkedSessionId → unlinked
            },
            linkableSessions: [
                { sessionId: 'sess-1', displayName: 'Local USG', ownerLabel: 'This window', isLocal: true, status: 'connected' },
            ],
            onLinkSession,
        }));
        await act(async () => { useAiAuthStore.setState({ isAuthenticated: true }); });

        // No chip (nothing linked); the attach picker is shown instead.
        expect(document.querySelector('.ai-chat-linked-chip')).toBeNull();
        const picker = screen.getByRole('combobox', { name: 'Link a terminal' });
        expect(picker).toBeTruthy();

        await act(async () => { fireEvent.change(picker, { target: { value: 'sess-1' } }); });
        expect(onLinkSession).toHaveBeenCalledWith('sess-1');
    });
});
