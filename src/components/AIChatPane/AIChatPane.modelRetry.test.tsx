import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

// Regression cover for the model-list retry/backoff: a transient empty or
// failed fetch right after sign-in must NOT pin the "Failed to retrieve the
// AI model list" banner (previously one-shot → stuck until restart). The
// banner may only appear after every retry in MODEL_LOAD_RETRY_DELAYS_MS
// has been exhausted, and a retry that succeeds must load models silently.

const h = vi.hoisted(() => ({
    settings: {
        activeAiProvider: 'gemini',
        commandExecutionMode: 'ask-before-execute',
        whitelistCommands: [] as string[],
        blacklistCommands: [] as string[],
        maxConsecutiveAutoExecutions: 5,
        classifierStrategy: 'hybrid',
        aiClassifyConfidenceThreshold: 0.7,
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
        logDebug: vi.fn().mockResolvedValue(undefined),
        onAiChatResponse: vi.fn(() => Promise.resolve(() => {})),
        onAiAuthResult: vi.fn(() => Promise.resolve(() => {})),
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
const { tauriService } = await import('../../services/tauriService');
const { useAiAuthStore } = await import('../../stores/aiAuthStore');

const BANNER = 'Failed to retrieve the AI model list. Please check your authentication and network connection.';

const unspecifiedChatState = {
    selectedModel: 'Unspecified',
    systemInstruction: 'You are a helpful assistant.',
    activeTabId: 't1',
    tabs: [{ id: 't1', title: 'T', ordinal: 1 }],
};

const baseProps = {
    paneId: 'ai-1',
    active: true,
    aiPersonas: [{ id: 'default', label: 'Network Expert', systemPrompt: 'You are a network expert.' }],
    chatState: unspecifiedChatState,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const renderPane = () => render(<AIChatPane {...(baseProps as any)} />);

async function authenticate() {
    await act(async () => {
        useAiAuthStore.setState({ isAuthenticated: true });
    });
    await act(async () => { await Promise.resolve(); });
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
    vi.useFakeTimers();
    act(() => {
        useAiAuthStore.setState({ isAuthenticated: false, isAuthLoading: false, authError: null });
    });
    vi.mocked(tauriService.aiListModels).mockReset();
    localStorage.clear();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('AIChatPane model-list retry with backoff', () => {
    it('recovers silently when a transient empty result succeeds on retry', async () => {
        vi.mocked(tauriService.aiListModels)
            .mockResolvedValueOnce([]) // transient blip (e.g. token not ready)
            .mockResolvedValue([{ name: 'gemini-pro', displayName: 'Gemini Pro' }]);

        renderPane();
        await authenticate();
        await flush();

        // First attempt failed → still loading, no banner.
        expect(screen.queryByText(BANNER)).toBeNull();
        expect(tauriService.aiListModels).toHaveBeenCalledTimes(1);

        await act(async () => { vi.advanceTimersByTime(MODEL_LOAD_RETRY_DELAYS_MS[0]); });
        await flush();

        // Second attempt succeeded → models available, banner never shown.
        expect(tauriService.aiListModels).toHaveBeenCalledTimes(2);
        expect(screen.queryByText(BANNER)).toBeNull();
        expect(screen.getByText('Select a model in the header to send messages')).toBeTruthy();
    });

    it('recovers when the fetch rejects (network error) then succeeds', async () => {
        vi.mocked(tauriService.aiListModels)
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValue([{ name: 'gemini-pro', displayName: 'Gemini Pro' }]);

        renderPane();
        await authenticate();
        await flush();

        expect(screen.queryByText(BANNER)).toBeNull();

        await act(async () => { vi.advanceTimersByTime(MODEL_LOAD_RETRY_DELAYS_MS[0]); });
        await flush();

        expect(screen.queryByText(BANNER)).toBeNull();
        expect(screen.getByText('Select a model in the header to send messages')).toBeTruthy();
    });

    it('shows the banner only after every retry is exhausted', async () => {
        vi.mocked(tauriService.aiListModels).mockResolvedValue([]);

        renderPane();
        await authenticate();
        await flush();

        for (const delay of MODEL_LOAD_RETRY_DELAYS_MS) {
            // Banner must not appear while retries remain.
            expect(screen.queryByText(BANNER)).toBeNull();
            await act(async () => { vi.advanceTimersByTime(delay); });
            await flush();
        }

        // 1 initial + one per backoff step, then the terminal failure.
        expect(tauriService.aiListModels).toHaveBeenCalledTimes(1 + MODEL_LOAD_RETRY_DELAYS_MS.length);
        expect(screen.getByText(BANNER)).toBeTruthy();
    });

    it('stops retrying once unmounted (no timer leak)', async () => {
        vi.mocked(tauriService.aiListModels).mockResolvedValue([]);

        const { unmount } = renderPane();
        await authenticate();
        await flush();
        expect(tauriService.aiListModels).toHaveBeenCalledTimes(1);

        unmount();
        await act(async () => {
            vi.advanceTimersByTime(MODEL_LOAD_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0) + 1000);
        });
        await flush();

        // The scheduled retry was cancelled by the effect cleanup.
        expect(tauriService.aiListModels).toHaveBeenCalledTimes(1);
    });
});
