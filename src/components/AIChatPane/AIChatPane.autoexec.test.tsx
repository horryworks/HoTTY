import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// Shared, mutable holders captured by the mocks below. `vi.hoisted` runs before
// the module mocks are evaluated, so the holders exist when the factories close
// over them.
const h = vi.hoisted(() => ({
    onAiChatResponseCb: { current: null as null | ((d: unknown) => void) },
    onAiAuthResultCb: { current: null as null | ((r: { success: boolean }) => void) },
    onRunCommand: vi.fn(),
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
    sessions: new Map([['sess-1', { id: 'sess-1', displayName: 'Local USG' }]]),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const renderPane = (extra: Record<string, unknown>) => render(<AIChatPane {...(baseProps as any)} {...(extra as any)} />);

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
