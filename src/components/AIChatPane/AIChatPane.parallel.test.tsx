import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';

// Parallel streaming: a pane may stream up to `maxConcurrentStreams` conversation
// tabs at once (per-tab session id `paneId::tabId`), extra sends queue and start as
// slots free up. Stop cancels only the active tab's stream; the rest keep going.
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
        maxConcurrentStreams: 3,
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
const { tauriService } = await import('../../services/tauriService');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyState = any;

const baseProps = {
    paneId: 'ai-1',
    active: true,
    aiPersonas: [{ id: 'default', label: 'Assistant', systemPrompt: 'You are an assistant.' }],
    sessions: new Map(),
    ensureConsent: vi.fn().mockResolvedValue(true),
};

/** Stateful host: owns chatState so onDequeue* actually drain the queues (as the
 *  real useAiChat does), letting the send loop advance across completions. */
function Harness({ initial }: { initial: AnyState }) {
    const [state, setState] = useState<AnyState>(initial);
    const dequeueUser = (tabId: string) =>
        setState((s: AnyState) => ({
            ...s,
            tabs: s.tabs.map((t: AnyState) => (t.id === tabId ? { ...t, pendingUserMessages: (t.pendingUserMessages ?? []).slice(1) } : t)),
        }));
    const dequeueMachine = (tabId: string) =>
        setState((s: AnyState) => ({
            ...s,
            tabs: s.tabs.map((t: AnyState) => (t.id === tabId ? { ...t, pendingMessages: (t.pendingMessages ?? []).slice(1) } : t)),
        }));
    return (
        <AIChatPane
            {...(baseProps as AnyState)}
            chatState={state}
            onDequeuePendingUser={dequeueUser}
            onDequeuePending={dequeueMachine}
            onSelectTab={(id: string) => setState((s: AnyState) => ({ ...s, activeTabId: id }))}
        />
    );
}

const twoQueuedTabs = (): AnyState => ({
    selectedModel: 'gemini-pro',
    systemInstruction: 'You are a helpful assistant.',
    activeTabId: 't1',
    tabs: [
        { id: 't1', title: 'Tab 1', ordinal: 1, linkedSessions: [], pendingUserMessages: [{ text: 'q1' }] },
        { id: 't2', title: 'Tab 2', ordinal: 2, linkedSessions: [], pendingUserMessages: [{ text: 'q2' }] },
    ],
});

const done = (tabId: string, content = 'ok') =>
    act(() => { h.onAiChatResponseCb.current?.({ sessionId: `ai-1::${tabId}`, responseType: 'done', content }); });

describe('AIChatPane parallel streaming', () => {
    beforeEach(() => {
        h.onAiChatResponseCb.current = null;
        h.settings.maxConcurrentStreams = 3;
        vi.mocked(tauriService.aiChatSend).mockClear();
        vi.mocked(tauriService.aiChatCancel).mockClear();
        localStorage.clear();
        act(() => useAiAuthStore.setState({ isAuthenticated: false, isAuthLoading: false, authError: null }));
    });

    it('dispatches two tabs concurrently when the cap allows', async () => {
        render(<Harness initial={twoQueuedTabs()} />);
        await act(async () => { useAiAuthStore.setState({ isAuthenticated: true }); });

        await waitFor(() => {
            expect(tauriService.aiChatSend).toHaveBeenCalledWith('ai-1::t1', 'q1', 'gemini-pro', expect.anything(), undefined);
            expect(tauriService.aiChatSend).toHaveBeenCalledWith('ai-1::t2', 'q2', 'gemini-pro', expect.anything(), undefined);
        });

        // Both tabs are shown streaming in the strip (aria-busy).
        const tabs = screen.getAllByRole('tab');
        expect(tabs.every((el) => el.getAttribute('aria-busy') === 'true')).toBe(true);
    });

    it('serializes when the cap is 1: the second tab starts only after the first completes', async () => {
        h.settings.maxConcurrentStreams = 1;
        render(<Harness initial={twoQueuedTabs()} />);
        await act(async () => { useAiAuthStore.setState({ isAuthenticated: true }); });

        // Only the first tab starts.
        await waitFor(() => {
            expect(tauriService.aiChatSend).toHaveBeenCalledWith('ai-1::t1', 'q1', 'gemini-pro', expect.anything(), undefined);
        });
        expect(tauriService.aiChatSend).not.toHaveBeenCalledWith('ai-1::t2', 'q2', 'gemini-pro', expect.anything(), undefined);

        // Completing t1 frees the single slot → t2 dispatches.
        await done('t1');
        await waitFor(() => {
            expect(tauriService.aiChatSend).toHaveBeenCalledWith('ai-1::t2', 'q2', 'gemini-pro', expect.anything(), undefined);
        });
    });

    it('Stop cancels only the active tab; the other keeps streaming', async () => {
        render(<Harness initial={twoQueuedTabs()} />);
        await act(async () => { useAiAuthStore.setState({ isAuthenticated: true }); });
        await waitFor(() => {
            expect(tauriService.aiChatSend).toHaveBeenCalledWith('ai-1::t2', 'q2', 'gemini-pro', expect.anything(), undefined);
        });

        // Active tab is t1; press Stop.
        const stop = screen.getByLabelText('Stop');
        await act(async () => { stop.click(); });

        expect(tauriService.aiChatCancel).toHaveBeenCalledWith('ai-1::t1');
        expect(tauriService.aiChatCancel).not.toHaveBeenCalledWith('ai-1::t2');

        // t2 is still streaming (its tab keeps aria-busy).
        const t2 = screen.getAllByRole('tab').find((el) => el.textContent?.includes('Tab 2'));
        expect(t2?.getAttribute('aria-busy')).toBe('true');
    });
});
