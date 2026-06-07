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
    settings: {
        activeAiProvider: 'gemini',
        commandExecutionMode: 'auto-execute-safe',
        customSafeCommands: [] as string[],
        maxConsecutiveAutoExecutions: 5,
        watchBufferLimit: 500000,
        terminalBackground: '#000',
        theme: 'dark',
        update: vi.fn(),
    },
}));

vi.mock('../../services/tauriService', () => ({
    tauriService: {
        aiAuthLogout: vi.fn().mockResolvedValue(undefined),
        aiAuthAuto: vi.fn().mockResolvedValue(false),
        aiSetProvider: vi.fn().mockResolvedValue(undefined),
        aiChatSend: vi.fn().mockResolvedValue(undefined),
        aiChatCancel: vi.fn().mockResolvedValue(undefined),
        aiChatClear: vi.fn().mockResolvedValue(undefined),
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
const { NETWORK_EXPERT_KICKOFF, NETWORK_EXPERT_RECONNECT_PREP } = await import('../../constants/aiPrompts');

// A safe Huawei command (`display` is in the builtin safe list) wrapped in an
// execute fence — the canonical "identify the device first" opener.
const MODEL_CONTENT = 'Identifying the device first.\n\n```execute\ndisplay version\n```';

const baseProps = {
    paneId: 'ai-1',
    active: true,
    aiPersonas: [
        { id: 'default', label: 'Network Expert', systemPrompt: 'You are a network expert.', askAiCommands: [] },
    ],
    chatState: {
        selectedModel: 'gemini-pro',
        systemInstruction: 'You are a helpful assistant.',
        activeTabId: 't1',
        tabs: [{ id: 't1', title: 'Local USG', ordinal: 1, linkedSessionId: 'sess-1' }],
    },
    sessions: new Map([['sess-1', { id: 'sess-1', displayName: 'Local USG', status: 'connected' }]]),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makePane = (extra: Record<string, unknown>) => <AIChatPane {...(baseProps as any)} {...(extra as any)} />;
const renderPane = (extra: Record<string, unknown>) => render(makePane(extra));

async function authenticate() {
    await act(async () => {
        h.onAiAuthResultCb.current?.({ success: true });
    });
}

async function sendAndComplete(text: string) {
    const textarea = screen.getByPlaceholderText('Type a message...');
    await act(async () => {
        fireEvent.change(textarea, { target: { value: text } });
    });
    await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter' });
    });
    // Drive the streamed response to completion so the auto-execute effect fires.
    await act(async () => {
        h.onAiChatResponseCb.current?.({ sessionId: 'ai-1', responseType: 'done', content: MODEL_CONTENT });
    });
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
            expect(h.onUpdateTabById).toHaveBeenCalledWith(
                't1',
                expect.objectContaining({
                    pendingMessage: expect.stringContaining('not connected (disconnected)'),
                }),
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
        { id: 'network-expert', label: 'Network Expert', systemPrompt: 'You are a network expert.', askAiCommands: [] },
    ];

    beforeEach(() => {
        h.onUpdateTabById.mockClear();
        h.onRunCommand.mockClear();
        h.onAiChatResponseCb.current = null;
        h.onAiAuthResultCb.current = null;
        localStorage.clear();
    });

    it('injects the kickoff pending message when a Network Expert chat links to a live terminal', async () => {
        renderPane({ aiPersonas: networkExpertPersonas, onUpdateTabById: h.onUpdateTabById });
        // Before auth nothing should fire (the auto-send loop can't dispatch yet).
        expect(h.onUpdateTabById).not.toHaveBeenCalled();

        await authenticate();

        expect(h.onUpdateTabById).toHaveBeenCalledWith(
            't1',
            { pendingMessage: NETWORK_EXPERT_KICKOFF },
        );
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
        expect(h.onUpdateTabById).toHaveBeenCalledTimes(1); // kicked for device A

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
        expect(h.onUpdateTabById).toHaveBeenCalledTimes(2);
        expect(h.onUpdateTabById).toHaveBeenLastCalledWith('t1', { pendingMessage: NETWORK_EXPERT_KICKOFF });
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
        expect(h.onUpdateTabById).toHaveBeenCalledTimes(1); // initial full kickoff

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
        expect(h.onUpdateTabById).toHaveBeenCalledTimes(1); // no New chat, no re-prep
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
        h.onUpdateTabById.mockClear();

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
        expect(h.onUpdateTabById).toHaveBeenCalledWith('t1', { pendingMessage: NETWORK_EXPERT_RECONNECT_PREP });
        expect(h.onUpdateTabById).not.toHaveBeenCalledWith('t1', { pendingMessage: NETWORK_EXPERT_KICKOFF });
    });

    it('does NOT re-kick when the same link is re-rendered (id unchanged)', async () => {
        const { rerender } = renderPane({ aiPersonas: networkExpertPersonas, onUpdateTabById: h.onUpdateTabById });
        await authenticate();
        expect(h.onUpdateTabById).toHaveBeenCalledTimes(1);

        await act(async () => {
            rerender(makePane({ aiPersonas: networkExpertPersonas, onUpdateTabById: h.onUpdateTabById }));
        });
        expect(h.onUpdateTabById).toHaveBeenCalledTimes(1); // unchanged link → no re-kick
    });

    it('does NOT kick off for a non-Network-Expert persona', async () => {
        // baseProps persona has id 'default' (label "Network Expert" but not the id).
        renderPane({ onUpdateTabById: h.onUpdateTabById });
        await authenticate();
        expect(h.onUpdateTabById).not.toHaveBeenCalledWith(
            't1',
            expect.objectContaining({ pendingMessage: NETWORK_EXPERT_KICKOFF }),
        );
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
        expect(h.onUpdateTabById).not.toHaveBeenCalledWith(
            't1',
            expect.objectContaining({ pendingMessage: NETWORK_EXPERT_KICKOFF }),
        );
    });

    it('does NOT kick off when no model is selected', async () => {
        renderPane({
            aiPersonas: networkExpertPersonas,
            onUpdateTabById: h.onUpdateTabById,
            chatState: { ...baseProps.chatState, selectedModel: 'Unspecified' },
        });
        await authenticate();
        expect(h.onUpdateTabById).not.toHaveBeenCalledWith(
            't1',
            expect.objectContaining({ pendingMessage: NETWORK_EXPERT_KICKOFF }),
        );
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
