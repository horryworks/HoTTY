import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAiChat, getActiveTab, createDefaultAiChatState, aiBackendSessionId } from './useAiChat';
import type { SessionRecord } from './useSessionManager';
import type { FeaturePaneInfo } from '../utils/paneTypes';
import type { PersonaDefinition } from '../types/appTypes';

vi.mock('../services/tauriService', () => ({
  tauriService: {
    aiChatSend: vi.fn(),
    aiChatClear: vi.fn().mockResolvedValue(undefined),
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
  },
];

function makeDefaultOptions(overrides: Partial<Parameters<typeof useAiChat>[0]> = {}) {
  return {
    sessions: new Map<string, SessionRecord>(),
    featurePanes: new Map<string, FeaturePaneInfo>(),
    aiPersonas: defaultPersonas,
    takeWatchBuffer: vi.fn().mockResolvedValue(''),
    ensureAiConsent: vi.fn().mockResolvedValue(true),
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
  });

  it('updateAiChatState creates and updates state with default tab', () => {
    const opts = makeDefaultOptions();
    const { result } = renderHook(() => useAiChat(opts));

    act(() => {
      result.current.updateAiChatState('ai-1', { selectedModel: 'gpt-4o' });
    });

    const state = result.current.aiChatStates.get('ai-1');
    expect(state?.selectedModel).toBe('gpt-4o');
    expect(state?.tabs.length).toBe(1);
    expect(state?.activeTabId).toBe(state?.tabs[0].id);

    act(() => {
      result.current.updateAiChatState('ai-1', { selectedExpertise: 'General Assistant' });
    });

    const updated = result.current.aiChatStates.get('ai-1');
    expect(updated?.selectedModel).toBe('gpt-4o');
    expect(updated?.selectedExpertise).toBe('General Assistant');
  });

  it('addTab appends a tab and switches active', () => {
    const opts = makeDefaultOptions();
    const { result } = renderHook(() => useAiChat(opts));

    act(() => {
      result.current.updateAiChatState('ai-1', createDefaultAiChatState());
    });

    let newTabId = '';
    act(() => {
      newTabId = result.current.addTab('ai-1');
    });

    const state = result.current.aiChatStates.get('ai-1');
    expect(state?.tabs.length).toBe(2);
    expect(state?.activeTabId).toBe(newTabId);
    expect(state?.tabs[1].ordinal).toBe(2);
  });

  it('closeTab removes a tab; cannot remove last one', () => {
    const opts = makeDefaultOptions();
    const { result } = renderHook(() => useAiChat(opts));

    act(() => {
      result.current.updateAiChatState('ai-1', createDefaultAiChatState());
    });

    let secondTabId = '';
    act(() => {
      secondTabId = result.current.addTab('ai-1');
    });

    act(() => {
      result.current.closeTab('ai-1', secondTabId);
    });

    let state = result.current.aiChatStates.get('ai-1');
    expect(state?.tabs.length).toBe(1);

    // Cannot close the last tab
    const onlyTabId = state!.tabs[0].id;
    act(() => {
      result.current.closeTab('ai-1', onlyTabId);
    });

    state = result.current.aiChatStates.get('ai-1');
    expect(state?.tabs.length).toBe(1);
  });

  it('setTabLink updates linked session and refreshes title', () => {
    const sessions = new Map<string, SessionRecord>();
    sessions.set('s1', makeSessionRecord('s1', { displayName: 'Router1' }));

    const opts = makeDefaultOptions({ sessions });
    const { result } = renderHook(() => useAiChat(opts));

    act(() => {
      result.current.updateAiChatState('ai-1', createDefaultAiChatState());
    });

    const state1 = result.current.aiChatStates.get('ai-1');
    const tabId = state1!.activeTabId;

    act(() => {
      result.current.setTabLink('ai-1', tabId, 's1');
    });

    const state2 = result.current.aiChatStates.get('ai-1');
    const tab = state2!.tabs.find(t => t.id === tabId);
    expect(tab?.linkedSessionId).toBe('s1');
    expect(tab?.title).toBe('Router1');
  });

  it('updateTabById updates a non-active tab in place (cross-tab result delivery)', () => {
    const opts = makeDefaultOptions();
    const { result } = renderHook(() => useAiChat(opts));

    act(() => {
      result.current.updateAiChatState('ai-1', createDefaultAiChatState());
    });
    const firstTabId = result.current.aiChatStates.get('ai-1')!.activeTabId;

    let secondTabId = '';
    act(() => {
      secondTabId = result.current.addTab('ai-1');
    });
    // After addTab, active tab is the second one. Update the FIRST by id.
    expect(result.current.aiChatStates.get('ai-1')?.activeTabId).toBe(secondTabId);

    act(() => {
      result.current.enqueuePendingMessage('ai-1', firstTabId, 'cross-tab payload');
    });

    const state = result.current.aiChatStates.get('ai-1');
    const firstTab = state!.tabs.find(t => t.id === firstTabId);
    const secondTab = state!.tabs.find(t => t.id === secondTabId);
    expect(firstTab?.pendingMessages).toEqual(['cross-tab payload']);
    // Active tab must NOT be touched.
    expect(secondTab?.pendingMessages).toBeUndefined();
    expect(state?.activeTabId).toBe(secondTabId);
  });

  it('pending-message queue enqueues FIFO and dequeues from the front', () => {
    const opts = makeDefaultOptions();
    const { result } = renderHook(() => useAiChat(opts));
    act(() => { result.current.updateAiChatState('ai-1', createDefaultAiChatState()); });
    const tabId = result.current.aiChatStates.get('ai-1')!.activeTabId;

    act(() => {
      result.current.enqueuePendingMessage('ai-1', tabId, 'first');
      result.current.enqueuePendingMessage('ai-1', tabId, 'second');
    });
    expect(result.current.aiChatStates.get('ai-1')!.tabs[0].pendingMessages).toEqual(['first', 'second']);

    act(() => { result.current.dequeuePendingMessage('ai-1', tabId); });
    expect(result.current.aiChatStates.get('ai-1')!.tabs[0].pendingMessages).toEqual(['second']);
  });

  it('updateTabById / enqueue is a no-op if the tab id does not exist', () => {
    const opts = makeDefaultOptions();
    const { result } = renderHook(() => useAiChat(opts));

    act(() => {
      result.current.updateAiChatState('ai-1', createDefaultAiChatState());
    });

    act(() => {
      result.current.enqueuePendingMessage('ai-1', 'bogus-tab-id', 'should not appear');
    });

    const state = result.current.aiChatStates.get('ai-1');
    expect(state?.tabs.every(t => !t.pendingMessages)).toBe(true);
  });

  it('setActiveTab switches the active tab', () => {
    const opts = makeDefaultOptions();
    const { result } = renderHook(() => useAiChat(opts));

    act(() => {
      result.current.updateAiChatState('ai-1', createDefaultAiChatState());
    });
    const firstTabId = result.current.aiChatStates.get('ai-1')!.activeTabId;

    let secondTabId = '';
    act(() => {
      secondTabId = result.current.addTab('ai-1');
    });

    act(() => {
      result.current.setActiveTab('ai-1', firstTabId);
    });

    expect(result.current.aiChatStates.get('ai-1')?.activeTabId).toBe(firstTabId);

    act(() => {
      result.current.setActiveTab('ai-1', secondTabId);
    });

    expect(result.current.aiChatStates.get('ai-1')?.activeTabId).toBe(secondTabId);
  });

  it('askAi creates new AI pane when none exists', async () => {
    const sessions = new Map<string, SessionRecord>();
    sessions.set('s1', makeSessionRecord('s1'));

    const opts = makeDefaultOptions({
      sessions,
      paneAllocations: { pane1: 's1' },
      activePaneId: 'pane1',
    });

    const { result } = renderHook(() => useAiChat(opts));

    await act(async () => {
      await result.current.askAi('some text', 'explain');
    });

    expect(opts.createAiChatPane).toHaveBeenCalled();
  });

  it('askAi reuses existing AI pane', async () => {
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

    await act(async () => {
      await result.current.askAi('some text', 'explain');
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

  it('askAi sends the typed question + selection to the chat', async () => {
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

    await act(async () => {
      await result.current.askAi('some code', 'Explain this');
    });

    const state = result.current.aiChatStates.get('ai-1');
    const activeTab = getActiveTab(state);
    expect(activeTab?.pendingMessages?.[0]).toContain('Explain this');
    expect(activeTab?.pendingMessages?.[0]).toContain('some code');
    expect(state?.systemInstruction).toContain('You are a helpful assistant');
  });

  it('askAi ignores an empty question', () => {
    const featurePanes = new Map<string, FeaturePaneInfo>();
    featurePanes.set('ai-1', { id: 'ai-1', type: 'ai-chat', displayName: 'AI Chat' });

    const opts = makeDefaultOptions({ featurePanes });
    const { result } = renderHook(() => useAiChat(opts));

    act(() => {
      result.current.askAi('some code', '   ');
    });

    const state = result.current.aiChatStates.get('ai-1');
    const activeTab = getActiveTab(state);
    expect(activeTab?.pendingMessages).toBeUndefined();
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

    // The consent gate awaits before sending, so the send resolves on a later
    // microtask — await sendMessage rather than asserting synchronously.
    await act(async () => {
      await result.current.sendMessage('ai-1', 'Hello');
    });

    // Session id is scoped to the active tab so each tab keeps its own history.
    const tabId = getActiveTab(result.current.aiChatStates.get('ai-1'))!.id;
    expect(tauriService.aiChatSend).toHaveBeenCalledWith(`ai-1::${tabId}`, 'Hello', 'gpt-4o', 'Be helpful.');
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

  it('sendMessage prepends watch buffer when active tab is linked to a session', async () => {
    const { tauriService } = await import('../services/tauriService');

    const sessions = new Map<string, SessionRecord>();
    sessions.set('s1', makeSessionRecord('s1'));

    // Backend-backed read-and-clear: returns the watched output once.
    const takeWatchBuffer = vi.fn().mockResolvedValue('watched output');

    const opts = makeDefaultOptions({
      sessions,
      takeWatchBuffer,
    });

    const { result } = renderHook(() => useAiChat(opts));

    act(() => {
      result.current.updateAiChatState('ai-1', {
        ...createDefaultAiChatState('s1', 'Session s1'),
        selectedModel: 'gpt-4o',
        systemInstruction: 'Be helpful.',
      });
    });

    await act(async () => {
      await result.current.sendMessage('ai-1', 'What happened?');
    });

    expect(takeWatchBuffer).toHaveBeenCalledWith('s1');
    const tabId = getActiveTab(result.current.aiChatStates.get('ai-1'))!.id;
    expect(tauriService.aiChatSend).toHaveBeenCalledWith(
      `ai-1::${tabId}`,
      expect.stringContaining('Watched Terminal Output'),
      'gpt-4o',
      'Be helpful.',
    );
  });

  it('sendMessage aborts without sending when consent is declined', async () => {
    const { tauriService } = await import('../services/tauriService');

    const sessions = new Map<string, SessionRecord>();
    sessions.set('s1', makeSessionRecord('s1'));
    const takeWatchBuffer = vi.fn().mockResolvedValue('watched output');
    // User declined the AI data-sharing disclosure.
    const ensureAiConsent = vi.fn().mockResolvedValue(false);

    const opts = makeDefaultOptions({ sessions, takeWatchBuffer, ensureAiConsent });
    const { result } = renderHook(() => useAiChat(opts));

    act(() => {
      result.current.updateAiChatState('ai-1', {
        ...createDefaultAiChatState('s1', 'Session s1'),
        selectedModel: 'gpt-4o',
      });
    });

    await act(async () => {
      await result.current.sendMessage('ai-1', 'What happened?');
    });

    expect(ensureAiConsent).toHaveBeenCalled();
    // Neither the watch buffer is consumed nor any data sent.
    expect(takeWatchBuffer).not.toHaveBeenCalled();
    expect(tauriService.aiChatSend).not.toHaveBeenCalled();
  });

  it('scopes the backend session per tab so a second tab does not inherit the first tab\'s history', async () => {
    const { tauriService } = await import('../services/tauriService');

    const opts = makeDefaultOptions();
    const { result } = renderHook(() => useAiChat(opts));

    act(() => {
      result.current.updateAiChatState('ai-1', { selectedModel: 'gpt-4o', systemInstruction: 'Be helpful.' });
    });
    const firstTabId = getActiveTab(result.current.aiChatStates.get('ai-1'))!.id;

    await act(async () => {
      await result.current.sendMessage('ai-1', 'from tab one');
    });

    // Open a second tab (it becomes active) and send from it.
    let secondTabId = '';
    act(() => {
      secondTabId = result.current.addTab('ai-1');
    });
    await act(async () => {
      await result.current.sendMessage('ai-1', 'from tab two');
    });

    expect(secondTabId).not.toBe(firstTabId);
    // Each send used its own tab-scoped key → the backend keeps two separate
    // conversation histories, so the new tab starts clean.
    expect(tauriService.aiChatSend).toHaveBeenNthCalledWith(
      1, `ai-1::${firstTabId}`, 'from tab one', 'gpt-4o', 'Be helpful.',
    );
    expect(tauriService.aiChatSend).toHaveBeenNthCalledWith(
      2, `ai-1::${secondTabId}`, 'from tab two', 'gpt-4o', 'Be helpful.',
    );
  });
});

describe('aiBackendSessionId', () => {
  it('composes a per-tab key with a `::` separator', () => {
    expect(aiBackendSessionId('ac-abc', 't1')).toBe('ac-abc::t1');
  });

  it('gives distinct keys for distinct tabs in the same pane', () => {
    expect(aiBackendSessionId('ac-abc', 't1')).not.toBe(aiBackendSessionId('ac-abc', 't2'));
  });

  it('falls back to the bare paneId when no tab id is given', () => {
    expect(aiBackendSessionId('ac-abc')).toBe('ac-abc');
    expect(aiBackendSessionId('ac-abc', null)).toBe('ac-abc');
    expect(aiBackendSessionId('ac-abc', undefined)).toBe('ac-abc');
  });
});

