import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGeminiChat } from './useGeminiChat';
import * as electronService from '../services/electronService';
import type { Session } from './useSessionManager';
import type { AskGeminiCommand, PersonaDefinition } from '../types/appTypes';

// ── Mocks ──

vi.mock('../App', () => ({}));

vi.mock('../services/electronService', () => ({
    geminiChatSend: vi.fn(),
    logDebug: vi.fn(),
    showContextMenu: vi.fn(),
    onAskGemini: vi.fn(() => vi.fn()),
}));

// ── Helpers ──

const makeAISession = (id: string): Session => ({
    id,
    title: 'Gemini AI',
    type: 'ai' as const,
    aiChatState: {
        messages: [],
        inputText: '',
        selectedModel: 'gemini-1.5-flash',
        selectedLanguage: 'English',
        textareaHeight: 0,
        systemInstruction: 'You are helpful.',
        lastTargetSessionId: undefined,
    },
});

const makeTerminalSession = (id: string): Session => ({
    id,
    title: 'Terminal',
    type: 'ssh' as const,
});

const makeOptions = (
    sessions: Session[] = [],
    overrides: Partial<Parameters<typeof useGeminiChat>[0]> = {}
): Parameters<typeof useGeminiChat>[0] => ({
    sessions,
    askGeminiCommands: [] as AskGeminiCommand[],
    aiPersonas: [] as PersonaDefinition[],
    proactiveInstruction: '',
    getWatchBuffer: vi.fn(() => ''),
    clearWatchBuffer: vi.fn(),
    updateSessionState: vi.fn(),
    toggleWatch: vi.fn(),
    createAISession: vi.fn(() => undefined),
    lastTerminalSessionId: null,
    paneAllocations: {},
    activePaneId: null,
    setActivePaneId: vi.fn(),
    ...overrides,
});

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
});

// ── askGeminiFreeFormatData ──

describe('useGeminiChat — askGeminiFreeFormatData', () => {
    it('is null initially', () => {
        const { result } = renderHook(() => useGeminiChat(makeOptions()));
        expect(result.current.askGeminiFreeFormatData).toBeNull();
    });

    it('setAskGeminiFreeFormatData updates the state', () => {
        const { result } = renderHook(() => useGeminiChat(makeOptions()));

        act(() => {
            result.current.setAskGeminiFreeFormatData({ selection: 'hello world' });
        });

        expect(result.current.askGeminiFreeFormatData).toEqual({ selection: 'hello world' });
    });

    it('setAskGeminiFreeFormatData can reset to null', () => {
        const { result } = renderHook(() => useGeminiChat(makeOptions()));

        act(() => {
            result.current.setAskGeminiFreeFormatData({ selection: 'text' });
        });
        act(() => {
            result.current.setAskGeminiFreeFormatData(null);
        });

        expect(result.current.askGeminiFreeFormatData).toBeNull();
    });
});

// ── sendMessage ──

describe('useGeminiChat — sendMessage', () => {
    it('calls electronService.geminiChatSend with correct args when session is AI type', () => {
        const aiSession = makeAISession('ai-1');
        const { result } = renderHook(() => useGeminiChat(makeOptions([aiSession])));

        act(() => {
            result.current.sendMessage('ai-1', 'Hello Gemini');
        });

        expect(electronService.geminiChatSend).toHaveBeenCalledTimes(1);
        expect(electronService.geminiChatSend).toHaveBeenCalledWith(
            'ai-1',
            'Hello Gemini',
            'gemini-1.5-flash',
            'You are helpful.'
        );
    });

    it('does nothing when the session id does not exist in sessions', () => {
        const { result } = renderHook(() => useGeminiChat(makeOptions([])));

        act(() => {
            result.current.sendMessage('nonexistent', 'Hello');
        });

        expect(electronService.geminiChatSend).not.toHaveBeenCalled();
    });

    it('does nothing when the session is not an AI type', () => {
        const termSession = makeTerminalSession('term-1');
        const { result } = renderHook(() => useGeminiChat(makeOptions([termSession])));

        act(() => {
            result.current.sendMessage('term-1', 'Hello');
        });

        expect(electronService.geminiChatSend).not.toHaveBeenCalled();
    });

    it('prepends watched buffer context when the linked terminal is watching', () => {
        const aiSession: Session = {
            ...makeAISession('ai-1'),
            aiChatState: {
                ...makeAISession('ai-1').aiChatState!,
                lastTargetSessionId: 'term-1',
            },
        };
        const termSession: Session = {
            ...makeTerminalSession('term-1'),
            isWatching: true,
        };

        const getWatchBuffer = vi.fn(() => 'watched output');
        const clearWatchBuffer = vi.fn();

        const { result } = renderHook(() =>
            useGeminiChat(
                makeOptions([aiSession, termSession], { getWatchBuffer, clearWatchBuffer })
            )
        );

        act(() => {
            result.current.sendMessage('ai-1', 'Analyze this');
        });

        expect(electronService.geminiChatSend).toHaveBeenCalledTimes(1);
        const [, message] = (electronService.geminiChatSend as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(message).toContain('watched output');
        expect(message).toContain('Analyze this');
        expect(clearWatchBuffer).toHaveBeenCalledWith('term-1');
    });
});

// ── showPromptMenu ──

describe('useGeminiChat — showPromptMenu', () => {
    it('calls electronService.showContextMenu when the session is AI type', () => {
        const aiSession = makeAISession('ai-1');
        const { result } = renderHook(() => useGeminiChat(makeOptions([aiSession])));

        act(() => {
            result.current.showPromptMenu('ai-1');
        });

        expect(electronService.showContextMenu).toHaveBeenCalledTimes(1);
    });

    it('passes __WATCH_BUFFER__ as the first arg to showContextMenu', () => {
        const aiSession = makeAISession('ai-1');
        const { result } = renderHook(() => useGeminiChat(makeOptions([aiSession])));

        act(() => {
            result.current.showPromptMenu('ai-1');
        });

        const [firstArg] = (electronService.showContextMenu as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(firstArg).toBe('__WATCH_BUFFER__');
    });

    it('does nothing when session is not found', () => {
        const { result } = renderHook(() => useGeminiChat(makeOptions([])));

        act(() => {
            result.current.showPromptMenu('nonexistent');
        });

        expect(electronService.showContextMenu).not.toHaveBeenCalled();
    });

    it('does nothing when session is not AI type', () => {
        const termSession = makeTerminalSession('term-1');
        const { result } = renderHook(() => useGeminiChat(makeOptions([termSession])));

        act(() => {
            result.current.showPromptMenu('term-1');
        });

        expect(electronService.showContextMenu).not.toHaveBeenCalled();
    });

    it('includes askGeminiCommands labels in the context menu items', () => {
        const aiSession = makeAISession('ai-1');
        const commands: AskGeminiCommand[] = [
            { id: 'explain', label: 'Explain this', promptTemplate: 'Explain: {selection}' },
        ];
        const { result } = renderHook(() =>
            useGeminiChat(makeOptions([aiSession], { askGeminiCommands: commands }))
        );

        act(() => {
            result.current.showPromptMenu('ai-1');
        });

        const [, menuItems] = (electronService.showContextMenu as ReturnType<typeof vi.fn>).mock.calls[0];
        const labels = (menuItems as { id: string; label: string }[]).map(m => m.label);
        expect(labels).toContain('Explain this');
    });
});

// ── handleFreeFormatSubmit ──

describe('useGeminiChat — handleFreeFormatSubmit', () => {
    it('calls updateSessionState with pendingMessage and systemInstruction', () => {
        const aiSession = makeAISession('ai-1');
        const updateSessionState = vi.fn();
        const setActivePaneId = vi.fn();

        const { result } = renderHook(() =>
            useGeminiChat(makeOptions([aiSession], { updateSessionState, setActivePaneId }))
        );

        act(() => {
            result.current.handleFreeFormatSubmit('What is this?', 'some selected text');
        });

        expect(updateSessionState).toHaveBeenCalledTimes(1);
        const [sessionId, newState] = updateSessionState.mock.calls[0];
        expect(sessionId).toBe('ai-1');
        expect(newState).toHaveProperty('pendingMessage');
        expect(newState).toHaveProperty('systemInstruction');
        expect(newState.pendingMessage).toContain('What is this?');
        expect(newState.pendingMessage).toContain('some selected text');
    });

    it('clears askGeminiFreeFormatData after submit', () => {
        const aiSession = makeAISession('ai-1');
        const { result } = renderHook(() => useGeminiChat(makeOptions([aiSession])));

        act(() => {
            result.current.setAskGeminiFreeFormatData({ selection: 'text' });
        });
        expect(result.current.askGeminiFreeFormatData).not.toBeNull();

        act(() => {
            result.current.handleFreeFormatSubmit('My prompt', 'text');
        });

        expect(result.current.askGeminiFreeFormatData).toBeNull();
    });

    it('does nothing when no AI session exists', () => {
        const updateSessionState = vi.fn();
        const { result } = renderHook(() =>
            useGeminiChat(makeOptions([], { updateSessionState }))
        );

        act(() => {
            result.current.handleFreeFormatSubmit('prompt', 'selection');
        });

        expect(updateSessionState).not.toHaveBeenCalled();
    });

    it('calls setActivePaneId with the AI session id', () => {
        const aiSession = makeAISession('ai-1');
        const setActivePaneId = vi.fn();

        const { result } = renderHook(() =>
            useGeminiChat(makeOptions([aiSession], { setActivePaneId }))
        );

        act(() => {
            result.current.handleFreeFormatSubmit('prompt', 'text');
        });

        expect(setActivePaneId).toHaveBeenCalledWith('ai-1');
    });
});
