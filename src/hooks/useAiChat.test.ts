import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAiChat, getActiveTab, createDefaultAiChatState, deriveTabTitle } from './useAiChat';
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
      result.current.updateTabById('ai-1', firstTabId, { pendingMessage: 'cross-tab payload' });
    });

    const state = result.current.aiChatStates.get('ai-1');
    const firstTab = state!.tabs.find(t => t.id === firstTabId);
    const secondTab = state!.tabs.find(t => t.id === secondTabId);
    expect(firstTab?.pendingMessage).toBe('cross-tab payload');
    // Active tab must NOT be touched.
    expect(secondTab?.pendingMessage).toBeUndefined();
    expect(state?.activeTabId).toBe(secondTabId);
  });

  it('updateTabById is a no-op if the tab id does not exist', () => {
    const opts = makeDefaultOptions();
    const { result } = renderHook(() => useAiChat(opts));

    act(() => {
      result.current.updateAiChatState('ai-1', createDefaultAiChatState());
    });

    act(() => {
      result.current.updateTabById('ai-1', 'bogus-tab-id', { pendingMessage: 'should not appear' });
    });

    const state = result.current.aiChatStates.get('ai-1');
    expect(state?.tabs.every(t => t.pendingMessage === undefined)).toBe(true);
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

  it('handleFreeFormatSubmit sets pending message on active tab and clears modal', () => {
    const featurePanes = new Map<string, FeaturePaneInfo>();
    featurePanes.set('ai-1', { id: 'ai-1', type: 'ai-chat', displayName: 'AI Chat' });

    const opts = makeDefaultOptions({ featurePanes });
    const { result } = renderHook(() => useAiChat(opts));

    // Set up initial state with a tab
    act(() => {
      result.current.updateAiChatState('ai-1', createDefaultAiChatState());
    });

    act(() => {
      result.current.handleFreeFormatSubmit('Explain this', 'some code');
    });

    const state = result.current.aiChatStates.get('ai-1');
    const activeTab = getActiveTab(state);
    expect(activeTab?.pendingMessage).toContain('Explain this');
    expect(activeTab?.pendingMessage).toContain('some code');
    expect(state?.systemInstruction).toContain('You are a helpful assistant.');
    expect(result.current.askAiFreeFormatData).toBeNull();
    expect(opts.setActivePaneId).toHaveBeenCalledWith('ai-1');
  });

  it('askAi sets pending message on active tab for analyze-watch type', () => {
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
    const activeTab = getActiveTab(state);
    expect(activeTab?.pendingMessage).toContain('analyze the following terminal output');
    expect(activeTab?.pendingMessage).toContain('terminal output here');
    expect(state?.systemInstruction).toContain('You are a helpful assistant');
  });

  it('sendMessage prepends watch buffer when active tab is linked to a session', async () => {
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
        ...createDefaultAiChatState('s1', 'Session s1'),
        selectedModel: 'gpt-4o',
        systemInstruction: 'Be helpful.',
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

describe('deriveTabTitle', () => {
  const sessions = new Map<string, SessionRecord>();
  sessions.set('s1', makeSessionRecord('s1', { displayName: 'Router1' }));
  sessions.set('s2', makeSessionRecord('s2', { displayName: 'AVeryLongHostnameWithExtras' }));

  it('returns "Tab N" when no link', () => {
    expect(deriveTabTitle(undefined, sessions, 1)).toBe('Tab 1');
    expect(deriveTabTitle(undefined, sessions, 7)).toBe('Tab 7');
  });

  it('returns linked session displayName', () => {
    expect(deriveTabTitle('s1', sessions, 1)).toBe('Router1');
  });

  it('truncates long names with an ellipsis', () => {
    expect(deriveTabTitle('s2', sessions, 1)).toBe('AVeryLongHo…');
  });

  it('falls back to "Tab N" if linked session is missing', () => {
    expect(deriveTabTitle('missing', sessions, 3)).toBe('Tab 3');
  });
});
