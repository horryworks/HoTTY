import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

/**
 * The AI answer language reaching the model.
 *
 * Regression home for the bug where switching the language mid-conversation
 * changed nothing: the directive was empty for English/Auto, and the app UI
 * language was never wired to the AI at all.
 *
 * Unlike the sibling AIChatPane suites this one uses the REAL settings store:
 * AIChatPane is `React.memo`, so a props-identical re-render is a no-op and only
 * a genuine store subscription can prove that changing a setting re-authors the
 * system prompt of an already-mounted pane — which is the whole bug.
 */
const h = vi.hoisted(() => ({
    onAiChatResponseCb: { current: null as null | ((d: unknown) => void) },
    onChatStateChange: vi.fn(),
    ensureConsent: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../services/tauriService', () => ({
    tauriService: {
        aiAuthLogout: vi.fn().mockResolvedValue(undefined),
        aiAuthAuto: vi.fn().mockResolvedValue(false),
        aiSetProvider: vi.fn().mockResolvedValue(undefined),
        aiChatSend: vi.fn().mockResolvedValue(undefined),
        aiChatCancel: vi.fn().mockResolvedValue(undefined),
        aiChatClear: vi.fn().mockResolvedValue(undefined),
        aiClassifyCommand: vi.fn().mockResolvedValue({ modifiesState: false, confidence: 0.95, reason: 'read-only' }),
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
        onAiAuthResult: vi.fn(() => Promise.resolve(() => {})),
        selectServiceAccountKeyFile: vi.fn().mockResolvedValue(null),
    },
}));

vi.mock('../../utils/applyTheme', () => ({ applyTheme: vi.fn() }));

Element.prototype.scrollIntoView = vi.fn();

const { AIChatPane } = await import('./AIChatPane');
const { tauriService } = await import('../../services/tauriService');
const { useAiAuthStore } = await import('../../stores/aiAuthStore');
const { useSettingsStore } = await import('../../stores/settingsStore');

const baseProps = {
    paneId: 'ai-1',
    active: true,
    aiPersonas: [{ id: 'default', label: 'General Helper', systemPrompt: 'You are a helper.' }],
    chatState: {
        selectedModel: 'gemini-pro',
        systemInstruction: 'You are a helpful assistant.',
        activeTabId: 't1',
        tabs: [{ id: 't1', title: 'Tab 1', ordinal: 1, linkedSessions: [] }],
    },
    sessions: new Map(),
    onChatStateChange: h.onChatStateChange,
    ensureConsent: h.ensureConsent,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const renderPane = () => render(<AIChatPane {...(baseProps as any)} />);

const setSetting = (key: 'language' | 'aiResponseLanguage', value: string) => {
    act(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useSettingsStore.getState().update(key as any, value as any);
    });
};

/** The system instruction the pane last published to its owner. */
function lastSystemInstruction(): string {
    const calls = h.onChatStateChange.mock.calls.filter(
        (c) => typeof (c[0] as { systemInstruction?: string })?.systemInstruction === 'string',
    );
    return (calls[calls.length - 1][0] as { systemInstruction: string }).systemInstruction;
}

async function authenticate() {
    await act(async () => {
        useAiAuthStore.setState({ isAuthenticated: true });
    });
}

async function openSettings() {
    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'AI settings' }));
    });
}

async function typeAndSend(text: string) {
    const textarea = screen.getByPlaceholderText('Type a message...');
    await act(async () => {
        fireEvent.change(textarea, { target: { value: text } });
    });
    await act(async () => {
        fireEvent.keyDown(textarea, { key: 'Enter' });
    });
}

/** Finish the in-flight stream so the next send isn't queued behind it. */
async function completeStream(content = 'ok') {
    await act(async () => {
        h.onAiChatResponseCb.current?.({ sessionId: 'ai-1::t1', responseType: 'done', content });
    });
    await act(async () => { await Promise.resolve(); });
}

describe('AIChatPane answer language', () => {
    beforeEach(() => {
        h.onChatStateChange.mockClear();
        h.onAiChatResponseCb.current = null;
        vi.mocked(tauriService.aiChatSend).mockClear();
        act(() => {
            useAiAuthStore.setState({ isAuthenticated: false, isAuthLoading: false, authError: null });
            useSettingsStore.getState().reset();
            useSettingsStore.getState().update('language', 'ja');
            useSettingsStore.getState().update('aiDataConsentAccepted', true);
        });
        localStorage.clear();
    });

    it('labels the Auto option with the app UI language it resolves to', async () => {
        renderPane();
        await authenticate();
        await openSettings();
        // i18next itself stays English in tests (App drives changeLanguage), so the
        // label comes from the en resource while the interpolated name is the
        // app-language setting's own native label.
        expect(screen.getByRole('option', { name: 'Auto (日本語)' })).toBeTruthy();
    });

    it('writes the picked language to the shared setting, not pane-local state', async () => {
        renderPane();
        await authenticate();
        await openSettings();
        const select = screen.getByDisplayValue('Auto (日本語)');
        await act(async () => {
            fireEvent.change(select, { target: { value: 'French' } });
        });
        expect(useSettingsStore.getState().aiResponseLanguage).toBe('French');
    });

    it('resolves Auto to the app UI language in the system instruction', async () => {
        renderPane();
        expect(lastSystemInstruction()).toContain('Japanese');
    });

    it('re-authors a mounted pane\'s system instruction when the app UI language changes', async () => {
        // Regression: the prompt effect had no app-language input, so an Auto
        // conversation could never follow Settings → General.
        renderPane();
        expect(lastSystemInstruction()).toContain('Japanese');

        setSetting('language', 'fr');
        expect(lastSystemInstruction()).toContain('French');
        expect(lastSystemInstruction()).not.toContain('Japanese');
    });

    it('re-authors a mounted pane\'s system instruction when the AI language changes', async () => {
        renderPane();
        setSetting('aiResponseLanguage', 'Korean');
        expect(lastSystemInstruction()).toContain('Korean');
    });

    it('lets an explicit choice beat the app UI language', async () => {
        setSetting('aiResponseLanguage', 'German');
        renderPane();
        expect(lastSystemInstruction()).toContain('German');
        expect(lastSystemInstruction()).not.toContain('Japanese');
    });

    it('emits a directive for English too', async () => {
        // Regression: English used to produce an EMPTY directive, so switching to
        // it mid-conversation left the model anchored to the existing history.
        setSetting('aiResponseLanguage', 'English');
        renderPane();
        const instruction = lastSystemInstruction();
        expect(instruction).toContain('English');
        expect(instruction).toContain('overrides');
    });

    it('appends the switch notice to exactly one message per tab after a change', async () => {
        renderPane();
        await authenticate();

        setSetting('aiResponseLanguage', 'French');

        await typeAndSend('bonjour');
        const first = vi.mocked(tauriService.aiChatSend).mock.calls.at(-1)!;
        expect(first[1]).toContain('bonjour');
        expect(first[1]).toContain('[Language switched]');
        expect(first[1]).toContain('French');
        // The rendered transcript keeps the clean text.
        expect(screen.getByText('bonjour')).toBeTruthy();

        await completeStream();
        await typeAndSend('encore');
        const second = vi.mocked(tauriService.aiChatSend).mock.calls.at(-1)!;
        expect(second[1]).toBe('encore');
    });

    it('does not append the switch notice on the first send of a fresh pane', async () => {
        renderPane();
        await authenticate();
        await typeAndSend('hello');
        const call = vi.mocked(tauriService.aiChatSend).mock.calls.at(-1)!;
        expect(call[1]).toBe('hello');
    });
});
