import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAiChat } from './useAiChat';
import type { SessionRecord } from './useSessionManager';
import type { FeaturePaneInfo } from '../utils/paneTypes';
import type { PersonaDefinition } from '../types/appTypes';

vi.mock('../services/tauriService', () => ({
  tauriService: {
    aiChatSend: vi.fn(),
    showContextMenu: vi.fn().mockResolvedValue(null),
    logDebug: vi.fn(),
  },
}));

function makeSessionRecord(id: string, overrides?: Partial<SessionRecord>): SessionRecord {
  return {
    id,
    displayName: `Session ${id}`,
    protocol: 'ssh',
    status: 'connected',
    term: {} as SessionRecord['term'],
    fitAddon: {} as SessionRecord['fitAddon'],
    ...overrides,
  };
}

const defaultPersonas: PersonaDefinition[] = [
  {
    id: 'default',
    label: 'General Assistant',
    systemPrompt: 'You are a helpful assistant.',
    askAiCommands: [
      { id: 'explain', label: 'Explain', promptTemplate: 'Please explain:\n\n{selection}' },
      { id: 'root-cause', label: 'Root Cause', promptTemplate: 'Root cause:\n\n{selection}' },
    ],
  },
];

function makeDefaultOptions(overrides: Partial<Parameters<typeof useAiChat>[0]> = {}) {
  return {
    sessions: new Map<string, SessionRecord>(),
    featurePanes: new Map<string, FeaturePaneInfo>(),
    aiPersonas: defaultPersonas,
    getWatchBuffer: vi.fn().mockReturnValue(''),
    clearWatchBuffer: vi.fn(),
    toggleWatch: vi.fn(),
    createAiChatPane: vi.fn().mockReturnValue('ai-new-1'),
    lastTerminalSessionId: null,
    paneAllocations: {} as Record<string, string | null>,
    activePaneId: null,
    setActivePaneId: vi.fn(),
    ...overrides,
  };
}

describe('useAiChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns initial state', () => {
    const opts = makeDefaultOptions();
    const { result } = renderHook(() => useAiChat(opts));

    expect(result.current.aiChatStates.size).toBe(0);
    expect(result.current.askAiFreeFormatData).toBeNull();
  });

  it('updateAiChatState creates and updates state', () => {
    const opts = makeDefaultOptions();
    const { result } = renderHook(() => useAiChat(opts));

    act(() => {
      result.current.updateAiChatState('ai-1', { selectedModel: 'gpt-4o' });
    });

    expect(result.current.aiChatStates.get('ai-1')?.selectedModel).toBe('gpt-4o');

    act(() => {
      result.current.updateAiChatState('ai-1', { selectedExpertise: 'General Assistant' });
    });

    const state = result.current.aiChatStates.get('ai-1');
    expect(state?.selectedModel).toBe('gpt-4o');
    expect(state?.selectedExpertise).toBe('General Assistant');
  });

  it('askAi creates new AI pane when none exists', () => {
    const sessions = new Map<string, SessionRecord>();
    sessions.set('s1', makeSessionRecord('s1'));

    const opts = makeDefaultOptions({
      sessions,
      paneAllocations: { pane1: 's1' },
      activePaneId: 'pane1',
    });

    const { result } = renderHook(() => useAiChat(opts));

    act(() => {
      result.current.askAi('some text', 'explain');
    });

    expect(opts.createAiChatPane).toHaveBeenCalled();
  });

  it('askAi reuses existing AI pane', () => {
    const sessions = new Map<string, SessionRecord>();
    sessions.set('s1', makeSessionRecord('s1'));

    const featurePanes = new Map<string, FeaturePaneInfo>();
    featurePanes.set('ai-existing', { id: 'ai-existing', type: 'ai-chat', displayName: 'AI Chat' });

    const opts = makeDefaultOptions({
      sessions,
      featurePanes,
      paneAllocations: { pane1: 's1', pane2: 'ai-existing' },
      activePaneId: 'pane1',
    });

    const { result } = renderHook(() => useAiChat(opts));

    act(() => {
      result.current.askAi('some text', 'explain');
    });

    expect(opts.createAiChatPane).not.toHaveBeenCalled();
    expect(opts.setActivePaneId).toHaveBeenCalledWith('ai-existing');
  });

  it('askAi ignores empty selection', () => {
    const opts = makeDefaultOptions();
    const { result } = renderHook(() => useAiChat(opts));

    act(() => {
      result.current.askAi('', 'explain');
    });

    expect(opts.createAiChatPane).not.toHaveBeenCalled();
  });

  it('askAi with free-format opens modal data', () => {
    const sessions = new Map<string, SessionRecord>();
    sessions.set('s1', makeSessionRecord('s1'));

    const opts = makeDefaultOptions({
      sessions,
      paneAllocations: { pane1: 's1' },
      activePaneId: 'pane1',
    });

    const { result } = renderHook(() => useAiChat(opts));

    act(() => {
      result.current.askAi('some code', 'free-format');
    });

    expect(result.current.askAiFreeFormatData).toEqual({ selection: 'some code' });
  });

  it('sendMessage calls tauriService.aiChatSend', async () => {
    const { tauriService } = await import('../services/tauriService');

    const opts = makeDefaultOptions();
    const { result } = renderHook(() => useAiChat(opts));

    act(() => {
      result.current.updateAiChatState('ai-1', {
        selectedModel: 'gpt-4o',
        systemInstruction: 'Be helpful.',
      });
    });

    act(() => {
      result.current.sendMessage('ai-1', 'Hello');
    });

    expect(tauriService.aiChatSend).toHaveBeenCalledWith('ai-1', 'Hello', 'gpt-4o', 'Be helpful.');
  });

  it('sendMessage does nothing without chat state', async () => {
    const { tauriService } = await import('../services/tauriService');

    const opts = makeDefaultOptions();
    const { result } = renderHook(() => useAiChat(opts));

    act(() => {
      result.current.sendMessage('nonexistent', 'Hello');
    });

    expect(tauriService.aiChatSend).not.toHaveBeenCalled();
  });

  it('handleFreeFormatSubmit sets pending message and clears modal', () => {
    const featurePanes = new Map<string, FeaturePaneInfo>();
    featurePanes.set('ai-1', { id: 'ai-1', type: 'ai-chat', displayName: 'AI Chat' });

    const opts = makeDefaultOptions({ featurePanes });
    const { result } = renderHook(() => useAiChat(opts));

    // Set up initial state
    act(() => {
      result.current.updateAiChatState('ai-1', { selectedModel: 'gpt-4o' });
    });

    act(() => {
      result.current.handleFreeFormatSubmit('Explain this', 'some code');
    });

    const state = result.current.aiChatStates.get('ai-1');
    expect(state?.pendingMessage).toContain('Explain this');
    expect(state?.pendingMessage).toContain('some code');
    expect(state?.systemInstruction).toContain('You are a helpful assistant.');
    expect(result.current.askAiFreeFormatData).toBeNull();
    expect(opts.setActivePaneId).toHaveBeenCalledWith('ai-1');
  });

  it('askAi sets pending message for analyze-watch type', () => {
    const sessions = new Map<string, SessionRecord>();
    sessions.set('s1', makeSessionRecord('s1'));

    const featurePanes = new Map<string, FeaturePaneInfo>();
    featurePanes.set('ai-1', { id: 'ai-1', type: 'ai-chat', displayName: 'AI Chat' });

    const opts = makeDefaultOptions({
      sessions,
      featurePanes,
      paneAllocations: { pane1: 's1' },
      activePaneId: 'pane1',
    });

    const { result } = renderHook(() => useAiChat(opts));

    act(() => {
      result.current.askAi('terminal output here', 'analyze-watch');
    });

    const state = result.current.aiChatStates.get('ai-1');
    expect(state?.pendingMessage).toContain('analyze the following terminal output');
    expect(state?.pendingMessage).toContain('terminal output here');
    expect(state?.systemInstruction).toContain('Answer in English');
  });

  it('sendMessage prepends watch buffer when available', async () => {
    const { tauriService } = await import('../services/tauriService');

    const sessions = new Map<string, SessionRecord>();
    sessions.set('s1', makeSessionRecord('s1'));

    const getWatchBuffer = vi.fn().mockReturnValue('watched output');
    const clearWatchBuffer = vi.fn();

    const opts = makeDefaultOptions({
      sessions,
      getWatchBuffer,
      clearWatchBuffer,
    });

    const { result } = renderHook(() => useAiChat(opts));

    act(() => {
      result.current.updateAiChatState('ai-1', {
        selectedModel: 'gpt-4o',
        systemInstruction: 'Be helpful.',
        lastTargetSessionId: 's1',
      });
    });

    act(() => {
      result.current.sendMessage('ai-1', 'What happened?');
    });

    expect(tauriService.aiChatSend).toHaveBeenCalledWith(
      'ai-1',
      expect.stringContaining('Watched Terminal Output'),
      'gpt-4o',
      'Be helpful.',
    );
    expect(clearWatchBuffer).toHaveBeenCalledWith('s1');
  });
});
