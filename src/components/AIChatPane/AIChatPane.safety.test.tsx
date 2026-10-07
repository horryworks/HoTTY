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
const { NETWORK_EXPERT_KICKOFF, NETWORK_EXPERT_SAME_DEVICE_PREP } = await import('../../constants/aiPrompts');
const { useAiWorkerSessionStore } = await import('../../stores/aiWorkerSessionStore');
const { _clearVerdictCache } = await import('../../utils/aiCommandClassifier');
const { useAiAuthStore } = await import('../../stores/aiAuthStore');
const { tauriService } = await import('../../services/tauriService');
const { applySessionNames, buildSessionNames, resetSessionNames } = await import('../../utils/sessionNameShare');

// The auth store is module-global; reset it between tests so a prior test's
// authenticated state can't leak into the next one.
beforeEach(() => {
    act(() => {
        useAiAuthStore.setState({ isAuthenticated: false, isAuthLoading: false, authError: null });
    });
});

// A safe Huawei command (`display` is in the builtin safe list) wrapped in an
// execute fence — the canonical "identify the device first" opener.
const MODEL_CONTENT = 'Identifying the device first.\n\n```execute\ndisplay version\n```';

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

async function sendAndComplete(text: string, content: string = MODEL_CONTENT) {
    const textarea = screen.getByPlaceholderText('Type a message...');
    await act(async () => {
        fireEvent.change(textarea, { target: { value: text } });
    });
    await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter' });
    });
    // Drive the streamed response to completion so the auto-execute effect fires.
    // The classifier runs asynchronously after `done`; awaiting the act flushes
    // the microtask so the auto-exec (or its verdict) settles before assertions.
    await act(async () => {
        h.onAiChatResponseCb.current?.({ sessionId: 'ai-1::t1', responseType: 'done', content });
    });
    await act(async () => { await Promise.resolve(); });
}

/** A classify call the test resolves by hand, to act while "Checking safety…" is up. */
function deferredClassify() {
    let resolve!: (v: { modifiesState: boolean; confidence: number; reason: string }) => void;
    const promise = new Promise<{ modifiesState: boolean; confidence: number; reason: string }>((r) => { resolve = r; });
    h.aiClassifyCommand.mockReturnValueOnce(promise);
    return { resolve };
}

// A gray-zone command: neither whitelisted nor blacklisted, so the AI verdict decides.
const GRAY_CONTENT = 'Checking uptime.\n\n```execute\nuptime\n```';

describe('AIChatPane auto-execute safety guards', () => {
    beforeEach(() => {
        h.onRunCommand.mockClear();
        h.onEnqueuePending.mockClear();
        h.onAiChatResponseCb.current = null;
        h.onAiAuthResultCb.current = null;
        h.settings.commandExecutionMode = 'auto-execute-safe';
        h.aiClassifyCommand.mockReset().mockResolvedValue({ modifiesState: false, confidence: 0.95, reason: 'read-only' });
        localStorage.clear();
        _clearVerdictCache();
    });

    it('does not run when the mode switches to ask-before-execute while the verdict is in flight', async () => {
        const { rerender } = renderPane({ onRunCommand: h.onRunCommand });
        await authenticate();
        const classify = deferredClassify();
        await sendAndComplete('check', GRAY_CONTENT);
        expect(screen.getByText(/Checking safety/)).toBeTruthy();

        // The user flips to ask mode (the setting is cross-window synced, so it
        // may even come from another window) before the verdict lands.
        // (The mocked settings store is not reactive and the pane is memoized, so
        // a prop change stands in for the store notification a real switch sends.)
        h.settings.commandExecutionMode = 'ask-before-execute';
        await act(async () => { rerender(makePane({ onRunCommand: h.onRunCommand, active: false })); });
        await act(async () => { classify.resolve({ modifiesState: false, confidence: 0.99, reason: 'read-only' }); });
        await act(async () => { await Promise.resolve(); });

        expect(h.onRunCommand).not.toHaveBeenCalled();
    });

    it('a manual Run pressed during "Checking safety…" runs the command exactly once', async () => {
        renderPane({ onRunCommand: h.onRunCommand });
        await authenticate();
        const classify = deferredClassify();
        await sendAndComplete('check', GRAY_CONTENT);

        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Run in Terminal/i })); });
        expect(h.onRunCommand).toHaveBeenCalledTimes(1);

        // The verdict arrives safe afterwards: it must not run the block again.
        await act(async () => { classify.resolve({ modifiesState: false, confidence: 0.99, reason: 'read-only' }); });
        await act(async () => { await Promise.resolve(); });
        expect(h.onRunCommand).toHaveBeenCalledTimes(1);
        // No "Auto-executed" badge for a manual run; the buttons stay.
        expect(screen.queryByText('Auto-executed')).toBeNull();
    });
});

describe('AIChatPane Network Expert kickoff bookkeeping', () => {
    const networkExpertPersonas = [
        { id: 'network-expert', label: 'Network Expert', systemPrompt: 'You are a network expert.' },
    ];
    const sameDevice = (id: string, name: string) => [id, { id, displayName: name, status: 'connected' }] as const;

    beforeEach(() => {
        h.onRunCommand.mockClear();
        h.onEnqueuePending.mockClear();
        h.onAiChatResponseCb.current = null;
        h.onAiAuthResultCb.current = null;
        h.settings.commandExecutionMode = 'ask-before-execute';
        localStorage.clear();
    });

    it('re-runs the start-of-session protocol after "Clear conversation"', async () => {
        renderPane({ aiPersonas: networkExpertPersonas });
        await authenticate();
        expect(h.onEnqueuePending).toHaveBeenCalledTimes(1);
        expect(h.onEnqueuePending).toHaveBeenLastCalledWith('t1', NETWORK_EXPERT_KICKOFF);

        // A conversation happens, then the user clears it: the backend history is
        // gone too, so the model no longer knows the device → identify it again.
        await sendAndComplete('what is this box?', 'A router.');
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clear this conversation' })); });
        await act(async () => { fireEvent.click(screen.getByText('Clear conversation')); });

        expect(h.onEnqueuePending).toHaveBeenCalledTimes(2);
        expect(h.onEnqueuePending).toHaveBeenLastCalledWith('t1', NETWORK_EXPERT_KICKOFF);
    });

    it('preps each of two sessions to the same device once, without ping-ponging', async () => {
        const key = 'ssh:admin@192.0.2.1:22';
        renderPane({
            aiPersonas: networkExpertPersonas,
            sessions: new Map([sameDevice('sess-a', 'core-a'), sameDevice('sess-b', 'core-b')]),
            chatState: {
                ...baseProps.chatState,
                tabs: [{
                    id: 't1', title: 'core-a +1', ordinal: 1,
                    linkedSessions: [{ sessionId: 'sess-a', bindingKey: key }, { sessionId: 'sess-b', bindingKey: key }],
                }],
            },
        });
        await authenticate();
        // Session A: full kickoff (targeted, since two terminals are watched).
        expect(h.onEnqueuePending).toHaveBeenCalledTimes(1);
        expect(h.onEnqueuePending.mock.calls[0][1]).toContain(NETWORK_EXPERT_KICKOFF);

        // The conversation now has turns → session B (same device) gets the
        // lightweight paging re-disable, once — worded as an added session,
        // since A is still live (it is not a reconnect).
        await sendAndComplete('hi', 'hello');
        expect(h.onEnqueuePending).toHaveBeenCalledTimes(2);
        expect(h.onEnqueuePending.mock.calls[1][1]).toContain(NETWORK_EXPERT_SAME_DEVICE_PREP);
        expect(h.onEnqueuePending.mock.calls[1][1]).not.toContain('reconnected');

        // Further turns must not flip back to A, then B, then A…
        await sendAndComplete('again', 'sure');
        await sendAndComplete('and again', 'ok');
        expect(h.onEnqueuePending).toHaveBeenCalledTimes(2);
    });
});

describe('AIChatPane Network Expert prep ordering', () => {
    const networkExpertPersonas = [
        { id: 'network-expert', label: 'Network Expert', systemPrompt: 'You are a network expert.' },
    ];
    const live = (id: string, name: string) => [id, { id, displayName: name, status: 'connected' }] as const;

    beforeEach(() => {
        h.onEnqueuePending.mockClear();
        h.onAiChatResponseCb.current = null;
        h.settings.commandExecutionMode = 'ask-before-execute';
        vi.mocked(tauriService.aiChatSend).mockClear();
        vi.mocked(tauriService.aiChatClear).mockReset().mockResolvedValue(undefined);
        useAiWorkerSessionStore.getState().clear();
        localStorage.clear();
    });

    it('holds the second session’s prep until the device has been identified', async () => {
        const key = 'ssh:admin@192.0.2.1:22';
        renderPane({
            aiPersonas: networkExpertPersonas,
            sessions: new Map([live('sess-a', 'core-a'), live('sess-b', 'core-b')]),
            chatState: {
                ...baseProps.chatState,
                tabs: [{
                    id: 't1', title: 'core-a +1', ordinal: 1,
                    linkedSessions: [{ sessionId: 'sess-a', bindingKey: key }, { sessionId: 'sess-b', bindingKey: key }],
                }],
            },
        });
        await authenticate();
        expect(h.onEnqueuePending).toHaveBeenCalledTimes(1);

        // A turn that ends without any answer (cancelled before the first word):
        // nothing was identified, so B must not be told "the platform you identified".
        const textarea = screen.getByPlaceholderText('Type a message...');
        await act(async () => { fireEvent.change(textarea, { target: { value: 'hi' } }); });
        await act(async () => { fireEvent.keyDown(textarea, { key: 'Enter' }); });
        await act(async () => {
            h.onAiChatResponseCb.current?.({ sessionId: 'ai-1::t1', responseType: 'cancelled', content: '' });
        });
        expect(h.onEnqueuePending).toHaveBeenCalledTimes(1);

        // Once an answer exists, B gets its paging-disable.
        await sendAndComplete('again', 'A Huawei VRP.');
        expect(h.onEnqueuePending).toHaveBeenCalledTimes(2);
        expect(h.onEnqueuePending.mock.calls[1][1]).toContain(NETWORK_EXPERT_SAME_DEVICE_PREP);
    });

    it('holds the second session’s prep while the first one’s identification is still running', async () => {
        const key = 'ssh:admin@192.0.2.1:22';
        const tabBase = {
            id: 't1', title: 'core-a +1', ordinal: 1,
            linkedSessions: [{ sessionId: 'sess-a', bindingKey: key }, { sessionId: 'sess-b', bindingKey: key }],
        };
        const props = (extra: Record<string, unknown>) => ({
            aiPersonas: networkExpertPersonas,
            sessions: new Map([live('sess-a', 'core-a'), live('sess-b', 'core-b')]),
            ...extra,
        });
        // A's kickoff is enqueued, comes back as the tab's queue, and the send
        // loop dispatches it.
        const { rerender } = renderPane(props({ chatState: { ...baseProps.chatState, tabs: [tabBase] } }));
        await authenticate();
        expect(h.onEnqueuePending).toHaveBeenCalledTimes(1);
        const kickoff = h.onEnqueuePending.mock.calls[0][1] as string;
        await act(async () => {
            rerender(makePane(props({ chatState: { ...baseProps.chatState, tabs: [{ ...tabBase, pendingMessages: [kickoff] }] } })));
        });
        expect(tauriService.aiChatSend).toHaveBeenCalledTimes(1);
        const settled = { ...baseProps.chatState, tabs: [{ ...tabBase, pendingMessages: [] }] };
        await act(async () => { rerender(makePane(props({ chatState: settled }))); });
        h.onEnqueuePending.mockClear();

        // The first reply only starts the identification: it carries a command.
        // Nothing may slip in — not even in the render before the auto-exec
        // bookkeeping marks the chain busy.
        await act(async () => {
            h.onAiChatResponseCb.current?.({ sessionId: 'ai-1::t1', responseType: 'done', content: MODEL_CONTENT });
        });
        expect(h.onEnqueuePending).not.toHaveBeenCalled();
        await act(async () => { rerender(makePane(props({ chatState: settled, commandRunning: true }))); });
        expect(h.onEnqueuePending).not.toHaveBeenCalled();

        // The command's output goes back; the model answers without a command.
        const output = 'Terminal Output (Command: display version):\nHuawei VRP';
        await act(async () => {
            rerender(makePane(props({ chatState: { ...settled, tabs: [{ ...tabBase, pendingMessages: [output] }] } })));
        });
        await act(async () => { rerender(makePane(props({ chatState: settled }))); });
        expect(h.onEnqueuePending).not.toHaveBeenCalled();
        await act(async () => {
            h.onAiChatResponseCb.current?.({ sessionId: 'ai-1::t1', responseType: 'done', content: 'A Huawei VRP. Paging is off.' });
        });

        // The chain is over → B gets its paging-disable.
        expect(h.onEnqueuePending).toHaveBeenCalledTimes(1);
        expect(h.onEnqueuePending.mock.calls[0][1]).toContain(NETWORK_EXPERT_SAME_DEVICE_PREP);
    });

    it('does not kick off a terminal this conversation’s AI opened itself', async () => {
        act(() => {
            useAiWorkerSessionStore.getState().upsert({
                id: 'h-w1', key: 'local:powershell', displayName: 'PowerShell (AI)', protocol: 'powershell',
                host: '', status: 'connected', paneId: 'ai-1', tabId: 't1',
                openedAt: 0, lastUsedAt: 0, manualLogin: false,
            });
        });
        renderPane({
            aiPersonas: networkExpertPersonas,
            sessions: new Map(),
            chatState: {
                ...baseProps.chatState,
                tabs: [{ id: 't1', title: 'Tab 1', ordinal: 1, linkedSessions: [{ sessionId: 'h-w1' }] }],
            },
        });
        await authenticate();
        expect(h.onEnqueuePending).not.toHaveBeenCalled();
    });

    it('sends nothing on a cleared conversation until the backend clear has finished', async () => {
        let finishClear!: () => void;
        vi.mocked(tauriService.aiChatClear).mockReturnValueOnce(new Promise<void>((r) => { finishClear = r; }));
        const props = { aiPersonas: networkExpertPersonas, onUpdateTabById: vi.fn() };
        const { rerender } = renderPane(props);
        await authenticate();
        await sendAndComplete('what is this box?', 'A router.');
        vi.mocked(tauriService.aiChatSend).mockClear();

        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clear this conversation' })); });
        await act(async () => { fireEvent.click(screen.getByText('Clear conversation')); });

        // The kickoff is queued right away, but must not go out yet.
        const queued = {
            ...props,
            chatState: { ...baseProps.chatState, tabs: [{ ...baseProps.chatState.tabs[0], pendingMessages: [NETWORK_EXPERT_KICKOFF] }] },
        };
        await act(async () => { rerender(makePane(queued)); });
        expect(tauriService.aiChatSend).not.toHaveBeenCalled();

        await act(async () => { finishClear(); });
        await act(async () => { await Promise.resolve(); });
        expect(tauriService.aiChatSend).toHaveBeenCalledTimes(1);
        expect(vi.mocked(tauriService.aiChatSend).mock.calls[0][1]).toContain(NETWORK_EXPERT_KICKOFF);
    });
});

describe('AIChatPane discards stale work with the conversation', () => {
    beforeEach(() => {
        h.onRunCommand.mockClear();
        h.onEnqueuePending.mockClear();
        h.onUpdateTabById.mockClear();
        h.onAiChatResponseCb.current = null;
        h.settings.commandExecutionMode = 'auto-execute-safe';
        h.settings.aiDataConsentAccepted = true;
        h.ensureConsent.mockReset().mockResolvedValue(true);
        vi.mocked(tauriService.aiChatSend).mockClear();
        localStorage.clear();
    });

    it('"Clear conversation" stops the tab’s command runs and empties its queues', async () => {
        const onCancelRuns = vi.fn();
        renderPane({
            onCancelRuns,
            onUpdateTabById: h.onUpdateTabById,
            chatState: {
                ...baseProps.chatState,
                tabs: [{ ...baseProps.chatState.tabs[0], pendingMessages: ['Terminal Output (Command: x):\nlate'] }],
            },
        });
        await authenticate();
        await sendAndComplete('q', 'a');

        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clear this conversation' })); });
        await act(async () => { fireEvent.click(screen.getByText('Clear conversation')); });

        expect(onCancelRuns).toHaveBeenCalledWith('t1');
        expect(h.onUpdateTabById).toHaveBeenCalledWith('t1', expect.objectContaining({ pendingMessages: [], pendingUserMessages: [] }));
    });

    it('Pause stops a pending client-side sleep wait', async () => {
        renderPane({
            onUpdateTabById: h.onUpdateTabById,
            chatState: {
                ...baseProps.chatState,
                tabs: [{ ...baseProps.chatState.tabs[0], sleepDelay: { command: 'sleep 30', untilTs: Date.now() + 30_000, wasClamped: false, token: 1 } }],
            },
        });
        await authenticate();
        await act(async () => { fireEvent.click(screen.getByTestId('execution-mode-bar').querySelector('button')!); });
        await act(async () => { fireEvent.click(screen.getByText('Pause auto-execution')); });

        expect(h.onUpdateTabById).toHaveBeenCalledWith('t1', { sleepDelay: null });
    });

    it('declining the data-sharing consent drops the queued messages instead of asking again', async () => {
        h.settings.aiDataConsentAccepted = false;
        h.ensureConsent.mockResolvedValue(false);
        try {
            renderPane({
                onUpdateTabById: h.onUpdateTabById,
                chatState: {
                    ...baseProps.chatState,
                    tabs: [{ ...baseProps.chatState.tabs[0], pendingUserMessages: [{ text: 'queued' }] }],
                },
            });
            await authenticate();
            await act(async () => { await Promise.resolve(); });

            expect(h.ensureConsent).toHaveBeenCalledTimes(1);
            expect(h.onUpdateTabById).toHaveBeenCalledWith('t1', { pendingMessages: [], pendingUserMessages: [] });
            expect(tauriService.aiChatSend).not.toHaveBeenCalled();
        } finally {
            h.settings.aiDataConsentAccepted = true;
        }
    });

    it('a queued human message is sent through onSendMessage for its tab (so it carries terminal output)', async () => {
        const onSendMessage = vi.fn().mockResolvedValue(undefined);
        renderPane({
            onSendMessage,
            chatState: {
                ...baseProps.chatState,
                tabs: [{ ...baseProps.chatState.tabs[0], pendingUserMessages: [{ text: 'what happened?' }] }],
            },
        });
        await authenticate();
        await act(async () => { await Promise.resolve(); });

        expect(onSendMessage).toHaveBeenCalledWith('what happened?', undefined, 't1');
        expect(tauriService.aiChatSend).not.toHaveBeenCalled();
    });
});

describe('AIChatPane resolves another window\u2019s terminal by its shared name', () => {
    beforeEach(() => {
        h.onRunCommand.mockClear();
        h.onEnqueuePending.mockClear();
        h.onAiChatResponseCb.current = null;
        h.settings.commandExecutionMode = 'auto-execute-safe';
        localStorage.clear();
        _clearVerdictCache();
        resetSessionNames();
    });

    it('runs a target= command on a cross-window terminal under the alias its owner published', async () => {
        // The owning window calls the terminal core-sw01; the backend only knows its host.
        applySessionNames(buildSessionNames('win-2', { far: { displayName: 'core-sw01' } }));
        renderPane({
            onRunCommand: h.onRunCommand,
            crossWindowSessions: [{ sessionId: 'far', host: '192.0.2.1', protocol: 'ssh', ownerLabel: 'win-2' }],
            chatState: {
                ...baseProps.chatState,
                tabs: [{ id: 't1', title: 'Local USG +1', ordinal: 1, linkedSessions: [{ sessionId: 'sess-1' }, { sessionId: 'far' }] }],
            },
        });
        await authenticate();

        // The alias the model was taught (via useAiChat / the envelopes) is the
        // shared name, not the host — and the pane must accept exactly that.
        await sendAndComplete('check far', 'On it.\n\n```execute target=core-sw01\nshow clock\n```');
        expect(h.onRunCommand).toHaveBeenCalledTimes(1);
        expect(h.onRunCommand).toHaveBeenLastCalledWith('far', 'show clock', 't1');
        // The chip shows the owner's name as well.
        expect(screen.getByText('core-sw01')).toBeTruthy();
    });
});

describe('AIChatPane survives being re-created (drag to another cell, layout switch)', () => {
    const networkExpertPersonas = [
        { id: 'network-expert', label: 'Network Expert', systemPrompt: 'You are a network expert.' },
    ];
    beforeEach(() => {
        h.onRunCommand.mockClear();
        h.onEnqueuePending.mockClear();
        h.onAiChatResponseCb.current = null;
        h.settings.commandExecutionMode = 'ask-before-execute';
        localStorage.clear();
    });

    it('keeps the conversation and does not identify the device again', async () => {
        const first = renderPane({ aiPersonas: networkExpertPersonas });
        await authenticate();
        expect(h.onEnqueuePending).toHaveBeenCalledTimes(1); // the kickoff
        await sendAndComplete('what is this box?', 'A Huawei USG.');
        expect(screen.getByText('A Huawei USG.')).toBeTruthy();

        // The grid re-creates the pane: a brand-new component instance, same pane id.
        first.unmount();
        renderPane({ aiPersonas: networkExpertPersonas });
        await act(async () => { await Promise.resolve(); });

        expect(screen.getByText('A Huawei USG.')).toBeTruthy();
        // A re-created pane used to start empty and re-send the whole
        // start-of-session protocol into a history that already had it.
        expect(h.onEnqueuePending).toHaveBeenCalledTimes(1);
    });

    it('writes the chosen persona back so it survives the re-creation', async () => {
        const onChatStateChange = vi.fn();
        renderPane({
            aiPersonas: [
                { id: 'default', label: 'Assistant', systemPrompt: 'You are an assistant.' },
                ...networkExpertPersonas,
            ],
            onChatStateChange,
        });
        await authenticate();
        await act(async () => { fireEvent.click(screen.getByLabelText('AI settings')); });
        const persona = screen.getByDisplayValue('Assistant');
        await act(async () => { fireEvent.change(persona, { target: { value: 'Network Expert' } }); });

        expect(onChatStateChange).toHaveBeenCalledWith({ selectedExpertise: 'Network Expert' });
    });
});
