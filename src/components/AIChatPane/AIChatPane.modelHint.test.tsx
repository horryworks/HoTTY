import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

// Regression cover for the "Select a model in the header…" hint: it must NOT
// flash while the model list is still loading (the previously-used model
// auto-selects a moment later), and must NOT show when loading fails (that
// case has its own error banner). It SHOULD show once loading finishes with
// models available but none selected.

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
const { tauriService } = await import('../../services/tauriService');
const { useAiAuthStore } = await import('../../stores/aiAuthStore');

const HINT = 'Select a model in the header to send messages';

// chatState with no persisted model → selectedModel starts 'Unspecified'.
// No pendingMessage on the tab, so the send effect stays a no-op.
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

beforeEach(() => {
    act(() => {
        useAiAuthStore.setState({ isAuthenticated: false, isAuthLoading: false, authError: null });
    });
    vi.mocked(tauriService.aiListModels).mockReset();
    localStorage.clear();
});

describe('AIChatPane model-select hint', () => {
    it('does NOT show the hint while the model list is still loading', async () => {
        // A previously-used model exists and will auto-select once loading finishes.
        localStorage.setItem('hotty_ai_selected_model_gemini', 'gemini-pro');
        // Hold model resolution so we observe the loading window.
        vi.mocked(tauriService.aiListModels).mockReturnValue(new Promise(() => {}));

        renderPane();
        await authenticate();

        // Authenticated + still 'Unspecified' (placeholder confirms the state)…
        expect(screen.getByPlaceholderText('Select a model to start...')).toBeTruthy();
        // …but the hint must not flash during the load.
        expect(screen.queryByText(HINT)).toBeNull();
    });

    it('auto-selects the saved model and shows no hint once loading finishes', async () => {
        localStorage.setItem('hotty_ai_selected_model_gemini', 'gemini-pro');
        let resolveModels: (m: { name: string; displayName: string }[]) => void = () => {};
        vi.mocked(tauriService.aiListModels).mockReturnValue(new Promise((res) => { resolveModels = res; }));

        renderPane();
        await authenticate();

        await act(async () => {
            resolveModels([{ name: 'gemini-pro', displayName: 'Gemini Pro' }]);
        });
        await act(async () => { await Promise.resolve(); });

        // Model auto-selected → normal placeholder, no hint.
        expect(screen.getByPlaceholderText('Type a message...')).toBeTruthy();
        expect(screen.queryByText(HINT)).toBeNull();
    });

    it('SHOWS the hint once loading finishes with models available but none selected', async () => {
        // No saved model → nothing to auto-select even though models exist.
        vi.mocked(tauriService.aiListModels).mockResolvedValue([
            { name: 'gemini-pro', displayName: 'Gemini Pro' },
        ]);

        renderPane();
        await authenticate();
        await act(async () => { await Promise.resolve(); });

        expect(screen.getByPlaceholderText('Select a model to start...')).toBeTruthy();
        expect(screen.getByText(HINT)).toBeTruthy();
    });

    it('does NOT show the hint when the model list fails to load (empty)', async () => {
        // Empty result → the fetch keeps retrying with backoff (and eventually
        // surfaces the modelLoadError banner); either way the hint would be
        // pointless (nothing to select), so it stays hidden.
        vi.mocked(tauriService.aiListModels).mockResolvedValue([]);

        renderPane();
        await authenticate();
        await act(async () => { await Promise.resolve(); });

        expect(screen.queryByText(HINT)).toBeNull();
    });
});
