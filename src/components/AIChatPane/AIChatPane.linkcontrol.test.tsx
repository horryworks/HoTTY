import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// Phase 2: the header shows a ROW of watched-terminal chips (each with a remove ×)
// followed by a "+" picker that watches ANOTHER terminal, excluding those already
// watched. Adding calls onAddLink(id); removing a chip calls onRemoveLink(id).
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

    it('renders a chip per watched terminal; the chip × calls onRemoveLink(id)', async () => {
        const onRemoveLink = vi.fn();
        render(makePane({
            chatState: {
                selectedModel: 'gemini-pro',
                systemInstruction: 'x',
                activeTabId: 't1',
                tabs: [{ id: 't1', title: 'Local USG', ordinal: 1, linkedSessions: [{ sessionId: 'sess-1' }] }],
            },
            onRemoveLink,
        }));
        await act(async () => { useAiAuthStore.setState({ isAuthenticated: true }); });

        // One chip with the terminal name.
        const chips = document.querySelectorAll('.ai-chat-linked-chip');
        expect(chips.length).toBe(1);
        expect(chips[0].textContent).toContain('Local USG');
        // No "+" picker: no OTHER sessions to add (linkableSessions omitted).
        expect(screen.queryByRole('combobox', { name: 'Watch a terminal' })).toBeNull();

        // Removing the chip detaches via onRemoveLink(id).
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop watching Local USG' })); });
        expect(onRemoveLink).toHaveBeenCalledWith('sess-1');
    });

    it('shows the "+" picker (excluding watched); choosing a session calls onAddLink(id)', async () => {
        const onAddLink = vi.fn();
        render(makePane({
            chatState: {
                selectedModel: 'gemini-pro',
                systemInstruction: 'x',
                activeTabId: 't1',
                // Already watching sess-1; the picker must exclude it and offer sess-2.
                tabs: [{ id: 't1', title: 'Local USG', ordinal: 1, linkedSessions: [{ sessionId: 'sess-1' }] }],
            },
            linkableSessions: [
                { sessionId: 'sess-1', displayName: 'Local USG', ownerLabel: 'This window', isLocal: true, status: 'connected' },
                { sessionId: 'sess-2', displayName: 'Core SW', ownerLabel: 'This window', isLocal: true, status: 'connected' },
            ],
            onAddLink,
        }));
        await act(async () => { useAiAuthStore.setState({ isAuthenticated: true }); });

        const picker = screen.getByRole('combobox', { name: 'Watch a terminal' }) as HTMLSelectElement;
        expect(picker).toBeTruthy();
        // The already-watched sess-1 is excluded; only sess-2 is offered.
        const values = Array.from(picker.querySelectorAll('option')).map((o) => (o as HTMLOptionElement).value);
        expect(values).toContain('sess-2');
        expect(values).not.toContain('sess-1');

        await act(async () => { fireEvent.change(picker, { target: { value: 'sess-2' } }); });
        expect(onAddLink).toHaveBeenCalledWith('sess-2');
    });
});

describe('AIChatPane tab close', () => {
    beforeEach(() => {
        localStorage.clear();
        act(() => useAiAuthStore.setState({ isAuthenticated: false, isAuthLoading: false, authError: null }));
    });

    it('closing the LAST tab closes the whole pane (onClosePane), not the tab', async () => {
        const onCloseTab = vi.fn();
        const onClosePane = vi.fn();
        render(makePane({
            chatState: { selectedModel: 'gemini-pro', systemInstruction: 'x', activeTabId: 't1', tabs: [{ id: 't1', title: 'Tab 1', ordinal: 1 }] },
            onCloseTab,
            onClosePane,
        }));
        await act(async () => { useAiAuthStore.setState({ isAuthenticated: true }); });

        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close Tab 1' })); });
        expect(onClosePane).toHaveBeenCalledTimes(1);
        expect(onCloseTab).not.toHaveBeenCalled();
    });

    it('closing a tab when others remain closes just that conversation (onCloseTab)', async () => {
        const onCloseTab = vi.fn();
        const onClosePane = vi.fn();
        render(makePane({
            chatState: {
                selectedModel: 'gemini-pro', systemInstruction: 'x', activeTabId: 't1',
                tabs: [{ id: 't1', title: 'Tab 1', ordinal: 1 }, { id: 't2', title: 'Tab 2', ordinal: 2 }],
            },
            onCloseTab,
            onClosePane,
        }));
        await act(async () => { useAiAuthStore.setState({ isAuthenticated: true }); });

        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close Tab 2' })); });
        expect(onCloseTab).toHaveBeenCalledWith('t2');
        expect(onClosePane).not.toHaveBeenCalled();
    });
});
