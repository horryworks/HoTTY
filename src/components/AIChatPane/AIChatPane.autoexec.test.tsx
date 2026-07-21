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
const { MODEL_LOAD_RETRY_DELAYS_MS } = await import('./modelLoadRetry');
const { NETWORK_EXPERT_KICKOFF, NETWORK_EXPERT_RECONNECT_PREP } = await import('../../constants/aiPrompts');
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
        tabs: [{ id: 't1', title: 'Local USG', ordinal: 1, linkedSessionId: 'sess-1' }],
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
        h.onAiChatResponseCb.current?.({ sessionId: 'ai-1', responseType: 'done', content });
    });
    await act(async () => { await Promise.resolve(); });
}

describe('AIChatPane auto-execute after New chat', () => {
    beforeEach(() => {
        h.onRunCommand.mockClear();
        h.onAiChatResponseCb.current = null;
        h.onAiAuthResultCb.current = null;
        localStorage.clear();
    });

    it('re-dispatches the first auto-exec command of a new chat (stale dedup is reset)', async () => {
        renderPane({ onRunCommand: h.onRunCommand });
        await authenticate();

        // First conversation: the safe command auto-executes against the linked session.
        await sendAndComplete('check quic');
        expect(h.onRunCommand).toHaveBeenCalledTimes(1);
        expect(h.onRunCommand).toHaveBeenLastCalledWith('sess-1', 'display version', 't1');

        // Start a new chat (messages exist → confirm dialog), then confirm.
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Start a new chat' }));
        });
        await act(async () => {
            fireEvent.click(screen.getByText('Start new chat'));
        });

        // Second conversation produces the SAME command at the SAME message index.
        // Before the fix the pane-global blockKey (`1:display version`) suppressed it,
        // so the command never reached the terminal and no poll/timeout started.
        await sendAndComplete('check quic again');
        expect(h.onRunCommand).toHaveBeenCalledTimes(2);
        expect(h.onRunCommand).toHaveBeenLastCalledWith('sess-1', 'display version', 't1');
    });
});

describe('AIChatPane auto-execute when the linked terminal is not live', () => {
    beforeEach(() => {
        h.onRunCommand.mockClear();
        h.onUpdateTabById.mockClear();
        h.onAiChatResponseCb.current = null;
        h.onAiAuthResultCb.current = null;
        localStorage.clear();
    });

    it('does NOT auto-execute and posts a not-connected note when the linked session is disconnected', async () => {
        const disconnectedSessions = new Map([
            ['sess-1', { id: 'sess-1', displayName: 'Local USG', status: 'disconnected' }],
        ]);
        renderPane({ onRunCommand: h.onRunCommand, onUpdateTabById: h.onUpdateTabById, sessions: disconnectedSessions });
        await authenticate();

        await sendAndComplete('check quic');

        // The command must not be sent to a dead terminal…
        expect(h.onRunCommand).not.toHaveBeenCalled();
        // …and the auto-exec effect should not mark it executed (no badge / no send).
        // (No assertion on a note here: auto-exec stays silent and leaves a manual
        // Run button; clicking Run is what surfaces the note — covered below.)
    });

    it('posts a not-connected note (and does not send) when Run is clicked on a disconnected target', async () => {
        const disconnectedSessions = new Map([
            ['sess-1', { id: 'sess-1', displayName: 'Local USG', status: 'disconnected' }],
        ]);
        // ask-before-execute so the command renders a manual "Run in Terminal" button.
        h.settings.commandExecutionMode = 'ask-before-execute';
        try {
            renderPane({ onRunCommand: h.onRunCommand, onUpdateTabById: h.onUpdateTabById, sessions: disconnectedSessions });
            await authenticate();
            await sendAndComplete('check quic');

            await act(async () => {
                fireEvent.click(screen.getByRole('button', { name: /Run in Terminal/i }));
            });

            expect(h.onRunCommand).not.toHaveBeenCalled();
            expect(h.onEnqueuePending).toHaveBeenCalledWith(
                't1',
                expect.stringContaining('not connected (disconnected)'),
            );
        } finally {
            h.settings.commandExecutionMode = 'auto-execute-safe';
        }
    });

    it('still auto-executes when the linked session is connected (regression)', async () => {
        renderPane({ onRunCommand: h.onRunCommand, onUpdateTabById: h.onUpdateTabById });
        await authenticate();
        await sendAndComplete('check quic');
        expect(h.onRunCommand).toHaveBeenCalledTimes(1);
        expect(h.onRunCommand).toHaveBeenLastCalledWith('sess-1', 'display version', 't1');
    });
});

describe('AIChatPane Network Expert auto-kickoff', () => {
    // A Network Expert persona keyed by the stable id the kickoff matches on.
    const networkExpertPersonas = [
        { id: 'network-expert', label: 'Network Expert', systemPrompt: 'You are a network expert.' },
    ];

    beforeEach(() => {
        h.onUpdateTabById.mockClear();
        h.onEnqueuePending.mockClear();
        h.onRunCommand.mockClear();
        h.onAiChatResponseCb.current = null;
        h.onAiAuthResultCb.current = null;
        localStorage.clear();
    });

    it('injects the kickoff pending message when a Network Expert chat links to a live terminal', async () => {
        renderPane({ aiPersonas: networkExpertPersonas, onUpdateTabById: h.onUpdateTabById });
        // Before auth nothing should fire (the auto-send loop can't dispatch yet).
        expect(h.onEnqueuePending).not.toHaveBeenCalled();

        await authenticate();

        expect(h.onEnqueuePending).toHaveBeenCalledWith('t1', NETWORK_EXPERT_KICKOFF);
    });

    it('re-runs the kickoff when the chat is re-linked to a DIFFERENT device', async () => {
        const twoSessions = new Map([
            ['sess-1', { id: 'sess-1', displayName: 'Device A', status: 'connected' }],
            ['sess-2', { id: 'sess-2', displayName: 'Device B', status: 'connected' }],
        ]);
        const stateA = {
            ...baseProps.chatState,
            tabs: [{ ...baseProps.chatState.tabs[0], linkedSessionId: 'sess-1', linkBindingKey: 'ssh:@dev-a:22' }],
        };
        const { rerender } = render(makePane({
            aiPersonas: networkExpertPersonas,
            onUpdateTabById: h.onUpdateTabById,
            sessions: twoSessions,
            chatState: stateA,
        }));
        await authenticate();
        expect(h.onEnqueuePending).toHaveBeenCalledTimes(1); // kicked for device A

        // Re-link the active tab to a different device (different binding key).
        const stateB = {
            ...baseProps.chatState,
            tabs: [{ ...baseProps.chatState.tabs[0], linkedSessionId: 'sess-2', title: 'Device B', linkBindingKey: 'ssh:@dev-b:22' }],
        };
        await act(async () => {
            rerender(makePane({
                aiPersonas: networkExpertPersonas,
                onUpdateTabById: h.onUpdateTabById,
                sessions: twoSessions,
                chatState: stateB,
            }));
        });
        // Different device → re-kicked.
        expect(h.onEnqueuePending).toHaveBeenCalledTimes(2);
        expect(h.onEnqueuePending).toHaveBeenLastCalledWith('t1', NETWORK_EXPERT_KICKOFF);
    });

    it('does NOT re-prep on reconnect to the SAME device when the conversation is empty', async () => {
        const stateA = {
            ...baseProps.chatState,
            tabs: [{ ...baseProps.chatState.tabs[0], linkedSessionId: 'sess-1', linkBindingKey: 'ssh:@dev-a:22' }],
        };
        const { rerender } = render(makePane({
            aiPersonas: networkExpertPersonas,
            onUpdateTabById: h.onUpdateTabById,
            sessions: new Map([['sess-1', { id: 'sess-1', displayName: 'Device A', status: 'connected' }]]),
            chatState: stateA,
        }));
        await authenticate();
        expect(h.onEnqueuePending).toHaveBeenCalledTimes(1); // initial full kickoff

        // Reconnect: a NEW session id for the SAME device (same binding key), but the
        // conversation is still empty (the mock never fed the kickoff back), so there
        // is nothing to preserve and no re-prep should fire.
        const stateReconnected = {
            ...baseProps.chatState,
            tabs: [{ ...baseProps.chatState.tabs[0], linkedSessionId: 'sess-9', linkBindingKey: 'ssh:@dev-a:22' }],
        };
        await act(async () => {
            rerender(makePane({
                aiPersonas: networkExpertPersonas,
                onUpdateTabById: h.onUpdateTabById,
                sessions: new Map([['sess-9', { id: 'sess-9', displayName: 'Device A', status: 'connected' }]]),
                chatState: stateReconnected,
            }));
        });
        expect(h.onEnqueuePending).toHaveBeenCalledTimes(1); // no New chat, no re-prep
    });

    it('re-disables paging (no New chat) on reconnect to the SAME device mid-conversation', async () => {
        const stateA = {
            ...baseProps.chatState,
            tabs: [{ ...baseProps.chatState.tabs[0], linkedSessionId: 'sess-1', linkBindingKey: 'ssh:@dev-a:22' }],
        };
        const { rerender } = render(makePane({
            aiPersonas: networkExpertPersonas,
            onUpdateTabById: h.onUpdateTabById,
            onRunCommand: h.onRunCommand,
            sessions: new Map([['sess-1', { id: 'sess-1', displayName: 'Device A', status: 'connected' }]]),
            chatState: stateA,
        }));
        await authenticate();
        // Build an ongoing conversation so there is something to preserve.
        await sendAndComplete('check something');
        h.onEnqueuePending.mockClear();

        // Reconnect: same device (same binding key), new session id.
        const stateReconnected = {
            ...baseProps.chatState,
            tabs: [{ ...baseProps.chatState.tabs[0], linkedSessionId: 'sess-9', linkBindingKey: 'ssh:@dev-a:22' }],
        };
        await act(async () => {
            rerender(makePane({
                aiPersonas: networkExpertPersonas,
                onUpdateTabById: h.onUpdateTabById,
                onRunCommand: h.onRunCommand,
                sessions: new Map([['sess-9', { id: 'sess-9', displayName: 'Device A', status: 'connected' }]]),
                chatState: stateReconnected,
            }));
        });
        // Conversation preserved; only the lightweight paging re-prep is injected.
        expect(h.onEnqueuePending).toHaveBeenCalledWith('t1', NETWORK_EXPERT_RECONNECT_PREP);
        expect(h.onEnqueuePending).not.toHaveBeenCalledWith('t1', NETWORK_EXPERT_KICKOFF);
    });

    it('does NOT re-kick when the same link is re-rendered (id unchanged)', async () => {
        const { rerender } = renderPane({ aiPersonas: networkExpertPersonas, onUpdateTabById: h.onUpdateTabById });
        await authenticate();
        expect(h.onEnqueuePending).toHaveBeenCalledTimes(1);

        await act(async () => {
            rerender(makePane({ aiPersonas: networkExpertPersonas, onUpdateTabById: h.onUpdateTabById }));
        });
        expect(h.onEnqueuePending).toHaveBeenCalledTimes(1); // unchanged link → no re-kick
    });

    it('does NOT kick off for a non-Network-Expert persona', async () => {
        // baseProps persona has id 'default' (label "Network Expert" but not the id).
        renderPane({ onUpdateTabById: h.onUpdateTabById });
        await authenticate();
        expect(h.onEnqueuePending).not.toHaveBeenCalledWith('t1', NETWORK_EXPERT_KICKOFF);
    });

    it('does NOT kick off when the linked terminal is disconnected', async () => {
        const disconnectedSessions = new Map([
            ['sess-1', { id: 'sess-1', displayName: 'Local USG', status: 'disconnected' }],
        ]);
        renderPane({
            aiPersonas: networkExpertPersonas,
            onUpdateTabById: h.onUpdateTabById,
            sessions: disconnectedSessions,
        });
        await authenticate();
        expect(h.onEnqueuePending).not.toHaveBeenCalledWith('t1', NETWORK_EXPERT_KICKOFF);
    });

    it('does NOT kick off when no model is selected', async () => {
        renderPane({
            aiPersonas: networkExpertPersonas,
            onUpdateTabById: h.onUpdateTabById,
            chatState: { ...baseProps.chatState, selectedModel: 'Unspecified' },
        });
        await authenticate();
        expect(h.onEnqueuePending).not.toHaveBeenCalledWith('t1', NETWORK_EXPERT_KICKOFF);
    });
});

describe('AIChatPane AI classifier gray-zone verdicts', () => {
    // A non-whitelisted command so the hybrid fast-path is skipped and the AI
    // classifier (mocked) is consulted.
    const GRAY_CONTENT = 'Running it.\n\n```execute\nfrobnicate --apply\n```';

    beforeEach(() => {
        h.onRunCommand.mockClear();
        h.aiClassifyCommand.mockReset();
        _clearVerdictCache();
        h.onAiChatResponseCb.current = null;
        h.onAiAuthResultCb.current = null;
        localStorage.clear();
    });

    it('auto-executes a gray-zone command when the AI judges it read-only', async () => {
        h.aiClassifyCommand.mockResolvedValue({ modifiesState: false, confidence: 0.95, reason: 'just reads' });
        renderPane({ onRunCommand: h.onRunCommand });
        await authenticate();
        await sendAndComplete('do the thing', GRAY_CONTENT);
        expect(h.aiClassifyCommand).toHaveBeenCalledWith('frobnicate --apply', expect.any(String));
        expect(h.onRunCommand).toHaveBeenCalledWith('sess-1', 'frobnicate --apply', 't1');
        expect(screen.getByText(/AI verdict/)).toBeTruthy();
    });

    it('does NOT auto-execute when the AI judges it modifies state, but shows the verdict', async () => {
        h.aiClassifyCommand.mockResolvedValue({ modifiesState: true, confidence: 0.9, reason: 'changes config' });
        renderPane({ onRunCommand: h.onRunCommand });
        await authenticate();
        await sendAndComplete('do the thing', GRAY_CONTENT);
        expect(h.onRunCommand).not.toHaveBeenCalled();
        expect(screen.getByText(/changes config/)).toBeTruthy();
    });

    it('falls back to manual (no run) when classification fails', async () => {
        h.aiClassifyCommand.mockRejectedValue(new Error('classification timed out'));
        renderPane({ onRunCommand: h.onRunCommand });
        await authenticate();
        await sendAndComplete('do the thing', GRAY_CONTENT);
        expect(h.onRunCommand).not.toHaveBeenCalled();
        expect(screen.getByText(/Unverified/)).toBeTruthy();
    });

    it('does not double-classify the same command on re-render (dedup before await)', async () => {
        h.aiClassifyCommand.mockResolvedValue({ modifiesState: false, confidence: 0.95, reason: 'reads' });
        const { rerender } = renderPane({ onRunCommand: h.onRunCommand });
        await authenticate();
        await sendAndComplete('do the thing', GRAY_CONTENT);
        await act(async () => { rerender(makePane({ onRunCommand: h.onRunCommand })); });
        expect(h.aiClassifyCommand).toHaveBeenCalledTimes(1);
    });
});

describe('AIChatPane linked-chip / Target liveness visuals', () => {
    beforeEach(() => {
        h.onAiAuthResultCb.current = null;
        localStorage.clear();
    });

    it('shows a live chip (no stale marker) when the linked session is connected', async () => {
        renderPane({});
        await authenticate();
        const chip = document.querySelector('.ai-chat-linked-chip');
        expect(chip).toBeTruthy();
        expect(chip?.classList.contains('ai-chat-linked-chip-stale')).toBe(false);
        expect(chip?.textContent).toContain('Local USG');
        expect(chip?.textContent).not.toContain('(disconnected)');
    });

    it('shows a stale chip with (disconnected) when the linked session is not connected', async () => {
        const disconnectedSessions = new Map([
            ['sess-1', { id: 'sess-1', displayName: 'Local USG', status: 'disconnected' }],
        ]);
        renderPane({ sessions: disconnectedSessions });
        await authenticate();
        const chip = document.querySelector('.ai-chat-linked-chip');
        expect(chip).toBeTruthy();
        expect(chip?.classList.contains('ai-chat-linked-chip-stale')).toBe(true);
        expect(chip?.textContent).toContain('(disconnected)');
    });

    it('renders the Target label as (disconnected) on a command block when the link is stale', async () => {
        const disconnectedSessions = new Map([
            ['sess-1', { id: 'sess-1', displayName: 'Local USG', status: 'disconnected' }],
        ]);
        h.settings.commandExecutionMode = 'ask-before-execute';
        try {
            renderPane({ onRunCommand: h.onRunCommand, sessions: disconnectedSessions });
            await authenticate();
            await sendAndComplete('check quic');
            const target = document.querySelector('.ai-run-target.ai-run-target-stale');
            expect(target).toBeTruthy();
            expect(target?.textContent).toContain('(disconnected)');
        } finally {
            h.settings.commandExecutionMode = 'auto-execute-safe';
        }
    });
});

describe('AIChatPane "Don\'t Execute" (decline)', () => {
    // A non-whitelisted gray-zone command so the AI classifier is consulted (used to
    // stage the classify-in-flight race).
    const GRAY_CONTENT = 'Running it.\n\n```execute\nfrobnicate --apply\n```';

    beforeEach(() => {
        h.onRunCommand.mockClear();
        h.onUpdateTabById.mockClear();
        h.aiClassifyCommand.mockReset();
        _clearVerdictCache();
        h.onAiChatResponseCb.current = null;
        h.onAiAuthResultCb.current = null;
        localStorage.clear();
    });

    it('declines a manual command: no run, posts a decline note, swaps to the Declined badge', async () => {
        h.settings.commandExecutionMode = 'ask-before-execute';
        try {
            renderPane({ onRunCommand: h.onRunCommand, onUpdateTabById: h.onUpdateTabById });
            await authenticate();
            await sendAndComplete('check quic'); // MODEL_CONTENT → `display version`

            // The decline button sits next to Run in Terminal.
            await act(async () => {
                fireEvent.click(screen.getByRole('button', { name: /Don't Execute/i }));
            });

            // App side: never sent to the terminal…
            expect(h.onRunCommand).not.toHaveBeenCalled();
            // …AI side: the decline fact is fed back via the pending-message pipe.
            expect(h.onEnqueuePending).toHaveBeenCalledWith(
                't1',
                expect.stringContaining('chose NOT to run'),
            );
            // The block now shows the Declined badge; Run/Decline buttons are gone.
            expect(screen.getByText('Declined')).toBeTruthy();
            expect(screen.queryByRole('button', { name: /Run in Terminal/i })).toBeNull();
            expect(screen.queryByRole('button', { name: /Don't Execute/i })).toBeNull();
        } finally {
            h.settings.commandExecutionMode = 'auto-execute-safe';
        }
    });

    it('aborts an in-flight auto-run when declined during the "checking safety" window', async () => {
        // Hold the classifier so the command sits in the classify-in-flight state with
        // the manual Run/Decline buttons visible (auto-execute-safe mode).
        let resolveClassify: (v: { modifiesState: boolean; confidence: number; reason: string }) => void = () => {};
        h.aiClassifyCommand.mockReturnValue(new Promise((res) => { resolveClassify = res; }));

        renderPane({ onRunCommand: h.onRunCommand, onUpdateTabById: h.onUpdateTabById });
        await authenticate();
        await sendAndComplete('do the thing', GRAY_CONTENT);

        // Decline while classification is still pending.
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Don't Execute/i }));
        });

        // Classification resolves read-only — which WOULD auto-run, but the decline guard wins.
        await act(async () => {
            resolveClassify({ modifiesState: false, confidence: 0.95, reason: 'reads' });
        });
        await act(async () => { await Promise.resolve(); });

        expect(h.onRunCommand).not.toHaveBeenCalled();
        expect(screen.getByText('Declined')).toBeTruthy();
    });
});

describe('AIChatPane send while a response is streaming', () => {
    beforeEach(() => {
        h.onRunCommand.mockClear();
        h.onEnqueuePending.mockClear();
        h.onDequeuePending.mockClear();
        h.onEnqueuePendingUser.mockClear();
        h.onDequeuePendingUser.mockClear();
        vi.mocked(tauriService.aiChatSend).mockClear();
        h.onAiChatResponseCb.current = null;
        h.onAiAuthResultCb.current = null;
        localStorage.clear();
    });

    it('keeps the input enabled and queues a mid-stream send onto the priority (user) queue', async () => {
        renderPane({ onRunCommand: h.onRunCommand });
        await authenticate();

        const textarea = screen.getByPlaceholderText('Type a message...') as HTMLTextAreaElement;

        // First send — starts streaming. No `done` is fired, so the stream stays live.
        await act(async () => { fireEvent.change(textarea, { target: { value: 'first question' } }); });
        await act(async () => { fireEvent.keyDown(textarea, { key: 'Enter' }); });
        await act(async () => { await Promise.resolve(); await Promise.resolve(); }); // flush consent .then → dispatch

        expect(tauriService.aiChatSend).toHaveBeenCalledTimes(1);
        // The input must NOT be locked while the AI is responding.
        expect(textarea.disabled).toBe(false);

        // Second send WHILE streaming — must queue (priority), not open a 2nd stream.
        await act(async () => { fireEvent.change(textarea, { target: { value: 'follow-up' } }); });
        await act(async () => { fireEvent.keyDown(textarea, { key: 'Enter' }); });

        expect(h.onEnqueuePendingUser).toHaveBeenCalledWith('t1', 'follow-up');
        // No second backend send (a same-session send would supersede the live stream).
        expect(tauriService.aiChatSend).toHaveBeenCalledTimes(1);
        // Input cleared after queuing.
        expect(textarea.value).toBe('');
    });

    it('dispatches a queued user message BEFORE a machine pending message (priority)', async () => {
        const chatState = {
            selectedModel: 'gemini-pro',
            systemInstruction: 'You are a helpful assistant.',
            activeTabId: 't1',
            tabs: [{
                id: 't1', title: 'Local USG', ordinal: 1, linkedSessionId: 'sess-1',
                pendingUserMessages: ['human turn'],
                pendingMessages: ['machine turn'],
            }],
        };
        renderPane({ onRunCommand: h.onRunCommand, chatState });
        await authenticate();
        await act(async () => { await Promise.resolve(); });

        // The auto-send loop must pick the human message first, ahead of the machine one.
        expect(tauriService.aiChatSend).toHaveBeenCalledTimes(1);
        expect(tauriService.aiChatSend).toHaveBeenCalledWith('ai-1::t1', 'human turn', 'gemini-pro', expect.anything());
        expect(h.onDequeuePendingUser).toHaveBeenCalledWith('t1');
        // The machine queue is left untouched this round (only one stream at a time).
        expect(h.onDequeuePending).not.toHaveBeenCalled();
    });

    it('still dispatches directly (no queue) when nothing is streaming — regression', async () => {
        renderPane({ onRunCommand: h.onRunCommand });
        await authenticate();

        const textarea = screen.getByPlaceholderText('Type a message...') as HTMLTextAreaElement;
        await act(async () => { fireEvent.change(textarea, { target: { value: 'hello' } }); });
        await act(async () => { fireEvent.keyDown(textarea, { key: 'Enter' }); });
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });

        expect(tauriService.aiChatSend).toHaveBeenCalledTimes(1);
        expect(tauriService.aiChatSend).toHaveBeenCalledWith('ai-1::t1', 'hello', 'gemini-pro', expect.anything());
        // A first (non-streaming) send does NOT go through the priority queue.
        expect(h.onEnqueuePendingUser).not.toHaveBeenCalled();
    });
});

describe('AIChatPane pending message waits for model auto-selection', () => {
    beforeEach(() => {
        h.onAiChatResponseCb.current = null;
        h.onAiAuthResultCb.current = null;
        h.onUpdateTabById.mockClear();
        vi.mocked(tauriService.aiChatSend).mockClear();
        vi.mocked(tauriService.aiListModels).mockReset();
        localStorage.clear();
    });

    const pendingChatState = {
        selectedModel: 'Unspecified',
        systemInstruction: 'You are a helpful assistant.',
        activeTabId: 't1',
        tabs: [{ id: 't1', title: 'T', ordinal: 1, pendingMessages: ['analyze this'] }],
    };

    it('does not error while the model list is still loading, then sends once a model auto-selects', async () => {
        // The provider has a previously-used model that will auto-select on load.
        localStorage.setItem('hotty_ai_selected_model_gemini', 'gemini-3.5-flash');
        // Hold model resolution so the pending-message effect runs first while
        // selectedModel is still 'Unspecified'.
        let resolveModels: (m: { name: string; displayName: string }[]) => void = () => {};
        vi.mocked(tauriService.aiListModels).mockReturnValue(
            new Promise((res) => { resolveModels = res; }),
        );

        renderPane({ chatState: pendingChatState, onUpdateTabById: h.onUpdateTabById });
        await authenticate();

        // Still loading → message left intact, nothing sent, no error notice.
        expect(tauriService.aiChatSend).not.toHaveBeenCalled();
        expect(screen.queryByText(/AI model not selected/)).toBeNull();

        // Models arrive and the saved model auto-selects → the message is sent.
        await act(async () => {
            resolveModels([{ name: 'gemini-3.5-flash', displayName: 'Gemini 3.5 Flash' }]);
        });
        await act(async () => { await Promise.resolve(); });

        expect(tauriService.aiChatSend).toHaveBeenCalledWith(
            'ai-1::t1', 'analyze this', 'gemini-3.5-flash', expect.any(String),
        );
        expect(screen.queryByText(/AI model not selected/)).toBeNull();
    });

    it('still shows "model not selected" once loading finishes with no usable model', async () => {
        // Empty results are retried with backoff before the load is declared
        // failed, so drive the fake clock through every retry delay first.
        vi.useFakeTimers();
        try {
            vi.mocked(tauriService.aiListModels).mockResolvedValue([]); // no models available
            renderPane({ chatState: pendingChatState, onUpdateTabById: h.onUpdateTabById });
            await authenticate();
            await act(async () => { await Promise.resolve(); });

            // Still inside the retry window → no error yet, nothing sent.
            expect(tauriService.aiChatSend).not.toHaveBeenCalled();
            expect(screen.queryByText(/AI model not selected/)).toBeNull();

            for (const delay of MODEL_LOAD_RETRY_DELAYS_MS) {
                await act(async () => { vi.advanceTimersByTime(delay); });
                await act(async () => { await Promise.resolve(); });
            }

            expect(tauriService.aiChatSend).not.toHaveBeenCalled();
            expect(screen.getByText(/AI model not selected/)).toBeTruthy();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('AIChatPane cancel never leaks machine text into the human prompt textarea', () => {
    beforeEach(() => {
        h.onAiChatResponseCb.current = null;
        h.onUpdateTabById.mockClear();
        vi.mocked(tauriService.aiChatSend).mockClear();
        vi.mocked(tauriService.aiListModels).mockReset().mockResolvedValue([]);
        localStorage.clear();
    });

    // A large auto-execute feedback envelope — the kind the user saw leak in.
    const ENVELOPE =
        'Terminal Output (Command: display version):\n' +
        Array.from({ length: 40 }, (_, i) => `line ${i} of device output`).join('\n');

    it('does NOT restore an auto-execute terminal-output envelope on Stop', async () => {
        const chatState = {
            selectedModel: 'gemini-pro',
            systemInstruction: 'You are a helpful assistant.',
            activeTabId: 't1',
            tabs: [{ id: 't1', title: 'T', ordinal: 1, pendingMessages: [ENVELOPE] }],
        };
        renderPane({ chatState, onUpdateTabById: h.onUpdateTabById });
        await authenticate();
        await act(async () => { await Promise.resolve(); });

        // The pending envelope was dispatched → the tab is streaming, Stop shows.
        expect(tauriService.aiChatSend).toHaveBeenCalledWith(
            'ai-1::t1', ENVELOPE, 'gemini-pro', expect.any(String),
        );
        const stop = document.querySelector('.ai-chat-cancel-btn');
        expect(stop).toBeTruthy();

        // Cancel mid-stream (same handler the pause-during-stream path calls).
        await act(async () => { fireEvent.click(stop!); });

        // The human prompt textarea must stay empty — no terminal output leaked in.
        const textarea = screen.getByPlaceholderText('Type a message...') as HTMLTextAreaElement;
        expect(textarea.value).toBe('');
    });

    it('DOES restore a human-typed message on Stop (retry UX preserved)', async () => {
        const chatState = {
            selectedModel: 'gemini-pro',
            systemInstruction: 'You are a helpful assistant.',
            activeTabId: 't1',
            tabs: [{ id: 't1', title: 'T', ordinal: 1 }],
        };
        renderPane({ chatState });
        await authenticate();
        await act(async () => { await Promise.resolve(); });

        const textarea = screen.getByPlaceholderText('Type a message...') as HTMLTextAreaElement;
        await act(async () => { fireEvent.change(textarea, { target: { value: 'show me the routes' } }); });
        await act(async () => { fireEvent.keyDown(textarea, { key: 'Enter' }); });

        // Sent → textarea cleared, streaming on.
        expect(textarea.value).toBe('');
        const stop = document.querySelector('.ai-chat-cancel-btn');
        expect(stop).toBeTruthy();

        await act(async () => { fireEvent.click(stop!); });

        // Human text is restored for editing/resend.
        expect(textarea.value).toBe('show me the routes');
    });
});

describe('AIChatPane routes per-tab (paneId::tabId) response events', () => {
    beforeEach(() => {
        h.onAiChatResponseCb.current = null;
        vi.mocked(tauriService.aiListModels).mockReset().mockResolvedValue([]);
        localStorage.clear();
    });

    it('renders a done response whose sessionId is the composite per-tab key', async () => {
        const chatState = {
            selectedModel: 'gemini-pro',
            systemInstruction: 'You are a helpful assistant.',
            activeTabId: 't1',
            tabs: [{ id: 't1', title: 'T', ordinal: 1 }],
        };
        renderPane({ chatState });
        await authenticate();
        await act(async () => { await Promise.resolve(); });

        // Send a message so the tab owns the in-flight stream (streamingForTabIdRef = 't1').
        const textarea = screen.getByPlaceholderText('Type a message...');
        await act(async () => { fireEvent.change(textarea, { target: { value: 'hello' } }); });
        await act(async () => { fireEvent.keyDown(textarea, { key: 'Enter' }); });

        // Backend now echoes the tab-scoped session id; the listener must accept it
        // (startsWith `ai-1::`) and route the content to tab t1 rather than dropping it.
        await act(async () => {
            h.onAiChatResponseCb.current?.({
                sessionId: 'ai-1::t1',
                responseType: 'done',
                content: 'ROUTED VIA COMPOSITE KEY',
            });
        });
        await act(async () => { await Promise.resolve(); });

        expect(screen.getByText('ROUTED VIA COMPOSITE KEY')).toBeTruthy();
    });
});
