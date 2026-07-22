import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// --- tauriService mock (the orchestrator's only external side-effect surface) ---
// vi.hoisted so the mock object exists when the hoisted vi.mock factory runs.
const tv = vi.hoisted(() => ({
  clearWatchBuffer: vi.fn(),
  sendInput: vi.fn(),
  getWatchBuffer: vi.fn(),
  setWatching: vi.fn(),
  takeWatchBuffer: vi.fn(),
  listAllSessions: vi.fn(),
  onSessionStatus: vi.fn(),
  logDebug: vi.fn(),
}));
vi.mock('../services/tauriService', () => ({ tauriService: tv }));

import { useAiOrchestrator, type UseAiOrchestratorOptions, type OrchestratorAiChatApi } from './useAiOrchestrator';
import type { AiChatState } from './useAiChat';
import type { SessionRecord } from './useSessionManager';
import type { FeaturePaneInfo } from '../utils/paneTypes';
import { useSettingsStore } from '../stores/settingsStore';

const PANE = 'ai-pane-1';
const TAB = 'tab-1';
const SID = 'sess-1';

// Pass `null` for an active tab that watches NOTHING (note: passing `undefined`
// would trigger the SID default, so the "empty" case must use null explicitly).
function makeStates(linkedSessionId: string | null = SID): Map<string, AiChatState> {
  return new Map<string, AiChatState>([[PANE, {
    selectedModel: '',
    systemInstruction: 'You are a helpful assistant.',
    activeTabId: TAB,
    tabs: [{
      id: TAB, ordinal: 1, title: '',
      linkedSessions: linkedSessionId ? [{ sessionId: linkedSessionId }] : [],
      lastFocusedWatchId: linkedSessionId ?? undefined,
    }],
  } as unknown as AiChatState]]);
}

function makeSessions(status = 'connected'): Map<string, SessionRecord> {
  return new Map([[SID, { id: SID, status, displayName: 'S1', protocol: 'ssh' }]]) as unknown as Map<string, SessionRecord>;
}

// aiChat mock whose updateTabById MUTATES the shared states map in place, so the
// orchestrator's own ref reads (e.g. the sleep-delay token guard) see the update
// even without a React re-render.
function makeAiChat(states: Map<string, AiChatState>): OrchestratorAiChatApi {
  return {
    aiChatStates: states,
    updateAiChatState: vi.fn(),
    updateTabById: vi.fn((paneId: string, tabId: string, partial: Record<string, unknown>) => {
      const st = states.get(paneId);
      const tab = st?.tabs.find((t) => t.id === tabId);
      if (tab) Object.assign(tab, partial);
    }),
    enqueuePendingMessage: vi.fn(),
    addTab: vi.fn(),
    closeTab: vi.fn(),
    setActiveTab: vi.fn(),
    addTabLink: vi.fn(),
    removeTabLink: vi.fn(),
    rebindTabLink: vi.fn(),
  } as unknown as OrchestratorAiChatApi;
}

function makeOptions(overrides: Partial<UseAiOrchestratorOptions> = {}): UseAiOrchestratorOptions {
  return {
    sessions: makeSessions(),
    featurePanes: new Map<string, FeaturePaneInfo>([[PANE, { id: PANE, type: 'ai-chat', displayName: 'AI Chat' }]]),
    lastTerminalSessionId: null,
    setActivePaneId: vi.fn(),
    createAiChatPane: vi.fn(() => PANE),
    ensureConsent: vi.fn().mockResolvedValue(true),
    aiChat: makeAiChat(makeStates()),
    ...overrides,
  };
}

beforeEach(() => {
  useSettingsStore.getState().reset();
  Object.values(tv).forEach((fn) => fn.mockReset());
  tv.clearWatchBuffer.mockResolvedValue(undefined);
  tv.sendInput.mockResolvedValue(undefined);
  tv.getWatchBuffer.mockResolvedValue('');
  tv.setWatching.mockResolvedValue(undefined);
  tv.takeWatchBuffer.mockResolvedValue('');
  tv.listAllSessions.mockResolvedValue([]);
  tv.onSessionStatus.mockResolvedValue(() => {});
  tv.logDebug.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('useAiOrchestrator — command runner guards', () => {
  it('refuses to run a command against a session that is not connected', () => {
    const aiChat = makeAiChat(makeStates());
    const { result } = renderHook(() => useAiOrchestrator(makeOptions({
      sessions: makeSessions('disconnected'),
      aiChat,
    })));

    act(() => { result.current.onRunCommand(SID, 'ls', TAB, PANE); });

    expect(tv.sendInput).not.toHaveBeenCalled();
    expect(aiChat.enqueuePendingMessage).toHaveBeenCalledWith(
      PANE, TAB, expect.stringContaining('not connected'),
    );
  });
});

describe('useAiOrchestrator — send + watch', () => {
  it('sends each command line to the linked session, staggered 150ms apart', async () => {
    vi.useFakeTimers();
    const aiChat = makeAiChat(makeStates());
    const { result } = renderHook(() => useAiOrchestrator(makeOptions({ aiChat })));

    act(() => { result.current.onRunCommand(SID, 'ls\npwd', TAB, PANE); });

    // clearWatchBuffer is awaited before the first send is scheduled.
    await vi.advanceTimersByTimeAsync(0);
    expect(tv.sendInput).toHaveBeenCalledWith(SID, 'ls\r');
    expect(tv.sendInput).not.toHaveBeenCalledWith(SID, 'pwd\r');

    await vi.advanceTimersByTimeAsync(150);
    expect(tv.sendInput).toHaveBeenCalledWith(SID, 'pwd\r');
  });

  it('delivers captured output back to the originating tab when the prompt returns', async () => {
    vi.useFakeTimers();
    tv.getWatchBuffer.mockResolvedValue('cmd-output-here\r\ndevice> ');
    const aiChat = makeAiChat(makeStates());
    const { result } = renderHook(() => useAiOrchestrator(makeOptions({ aiChat })));

    act(() => { result.current.onRunCommand(SID, 'display version', TAB, PANE); });
    // Past the send window (1 line → 150ms + 300 grace) and a couple poll ticks.
    await vi.advanceTimersByTimeAsync(800);

    expect(aiChat.enqueuePendingMessage).toHaveBeenCalledWith(
      PANE, TAB, expect.stringContaining('Terminal Output (Command: display version)'),
    );
    expect(aiChat.enqueuePendingMessage).toHaveBeenCalledWith(
      PANE, TAB, expect.stringContaining('cmd-output-here'),
    );
  });

  it('reports an idle timeout when the device returns nothing', async () => {
    vi.useFakeTimers();
    tv.getWatchBuffer.mockResolvedValue('');
    const aiChat = makeAiChat(makeStates());
    const { result } = renderHook(() => useAiOrchestrator(makeOptions({ aiChat })));

    act(() => { result.current.onRunCommand(SID, 'hang', TAB, PANE); });
    // Default idle timeout is 10s.
    await vi.advanceTimersByTimeAsync(11000);

    expect(aiChat.enqueuePendingMessage).toHaveBeenCalledWith(
      PANE, TAB, expect.stringContaining('[no response from device for 10 seconds]'),
    );
  });

  it('stops an in-flight poll when clearRunCommandIntervals is called', async () => {
    vi.useFakeTimers();
    tv.getWatchBuffer.mockResolvedValue('');
    const aiChat = makeAiChat(makeStates());
    const { result } = renderHook(() => useAiOrchestrator(makeOptions({ aiChat })));

    act(() => { result.current.onRunCommand(SID, 'top', TAB, PANE); });
    await vi.advanceTimersByTimeAsync(500);
    const pollsBefore = tv.getWatchBuffer.mock.calls.length;
    expect(pollsBefore).toBeGreaterThan(0);

    act(() => { result.current.clearRunCommandIntervals(PANE); });
    await vi.advanceTimersByTimeAsync(2000);

    expect(tv.getWatchBuffer.mock.calls.length).toBe(pollsBefore);
  });
});

describe('useAiOrchestrator — client-side sleep delay', () => {
  it('runs a leading sleep client-side and posts a synthetic result (no device send)', async () => {
    vi.useFakeTimers();
    const aiChat = makeAiChat(makeStates());
    const { result } = renderHook(() => useAiOrchestrator(makeOptions({ aiChat })));

    act(() => { result.current.onRunCommand(SID, 'sleep 2', TAB, PANE); });

    // Immediately marks the tab as waiting; nothing is sent to the device.
    expect(aiChat.updateTabById).toHaveBeenCalledWith(
      PANE, TAB, expect.objectContaining({ sleepDelay: expect.objectContaining({ command: 'sleep 2' }) }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(tv.sendInput).not.toHaveBeenCalled();

    // After the delay, the waiting indicator clears and a synthetic result posts.
    await vi.advanceTimersByTimeAsync(2000);
    expect(aiChat.updateTabById).toHaveBeenCalledWith(PANE, TAB, { sleepDelay: null });
    expect(aiChat.enqueuePendingMessage).toHaveBeenCalledWith(
      PANE, TAB, expect.stringContaining('client-side delay complete'),
    );
  });
});

describe('useAiOrchestrator — watch toggle + session removal', () => {
  it('toggleWatch gates on consent and does nothing when the user declines', async () => {
    const ensureConsent = vi.fn().mockResolvedValue(false);
    const createAiChatPane = vi.fn(() => PANE);
    const aiChat = makeAiChat(new Map());
    const { result } = renderHook(() => useAiOrchestrator(makeOptions({ ensureConsent, createAiChatPane, aiChat })));

    await act(async () => { result.current.toggleWatch(SID); });

    expect(ensureConsent).toHaveBeenCalledTimes(1);
    // runToggleWatch (which creates/seeds the pane) is never reached on decline.
    expect(createAiChatPane).not.toHaveBeenCalled();
    expect(aiChat.updateAiChatState).not.toHaveBeenCalled();
  });

  it('toggleWatch cold-starts an AI pane seeded with the watched session on accept', async () => {
    const createAiChatPane = vi.fn(() => PANE);
    const aiChat = makeAiChat(new Map()); // no state yet → cold start
    const { result } = renderHook(() => useAiOrchestrator(makeOptions({ createAiChatPane, aiChat })));

    await act(async () => { result.current.toggleWatch(SID); });

    expect(aiChat.updateAiChatState).toHaveBeenCalledWith(
      PANE,
      expect.objectContaining({
        tabs: expect.arrayContaining([
          expect.objectContaining({
            linkedSessions: expect.arrayContaining([expect.objectContaining({ sessionId: SID })]),
          }),
        ]),
      }),
    );
  });

  it('toggleWatch ADDS the session to the active tab when it is not already watched', async () => {
    const aiChat = makeAiChat(makeStates(null)); // active tab watches nothing
    const { result } = renderHook(() => useAiOrchestrator(makeOptions({ aiChat })));

    await act(async () => { result.current.toggleWatch(SID); });

    expect(aiChat.addTabLink).toHaveBeenCalledWith(PANE, TAB, SID);
    expect(aiChat.removeTabLink).not.toHaveBeenCalled();
  });

  it('toggleWatch REMOVES the session when the active tab already watches it (toggle off)', async () => {
    const aiChat = makeAiChat(makeStates(SID)); // active tab already watches SID
    const { result } = renderHook(() => useAiOrchestrator(makeOptions({ aiChat })));

    await act(async () => { result.current.toggleWatch(SID); });

    expect(aiChat.removeTabLink).toHaveBeenCalledWith(PANE, TAB, SID);
    expect(aiChat.addTabLink).not.toHaveBeenCalled();
  });

  it('handleSessionRemoved keeps the watched entry (keep-stale) but evicts the watch buffer', () => {
    const aiChat = makeAiChat(makeStates());
    const { result } = renderHook(() => useAiOrchestrator(makeOptions({ aiChat })));

    act(() => { result.current.handleSessionRemoved(SID); });

    // Keep-stale: the tab's watched set is NOT mutated (the entry is retained,
    // greyed, for auto-rebind on reconnect). Only the backend buffer is dropped.
    expect(aiChat.removeTabLink).not.toHaveBeenCalled();
    expect(aiChat.closeTab).not.toHaveBeenCalled();
    expect(tv.setWatching).toHaveBeenCalledWith(SID, false, 0);
  });
});

// Two-conversation state: TAB (ordinal 1) watches SID; a second empty tab exists.
function makeTwoTabStates(): Map<string, AiChatState> {
  return new Map<string, AiChatState>([[PANE, {
    selectedModel: '', systemInstruction: '', activeTabId: TAB,
    tabs: [
      { id: TAB, ordinal: 1, title: '', linkedSessions: [{ sessionId: SID }], lastFocusedWatchId: SID },
      { id: 'tab-2', ordinal: 2, title: '', linkedSessions: [], lastFocusedWatchId: undefined },
    ],
  } as unknown as AiChatState]]);
}

describe('useAiOrchestrator — watchedSessions map + "Watch in" routing', () => {
  it('exposes watchedSessions mapping each watched session to its owner tab + color slot', () => {
    const aiChat = makeAiChat(makeStates(SID)); // TAB (ordinal 1) watches SID
    const { result } = renderHook(() => useAiOrchestrator(makeOptions({ aiChat })));

    expect(result.current.watchedSessions.get(SID)).toEqual({ tabId: TAB, colorIndex: 0 });
  });

  it('watchInConversation gates on consent (no link mutation on decline)', async () => {
    const ensureConsent = vi.fn().mockResolvedValue(false);
    const aiChat = makeAiChat(makeTwoTabStates());
    const { result } = renderHook(() => useAiOrchestrator(makeOptions({ ensureConsent, aiChat })));

    await act(async () => { result.current.watchInConversation(SID, 'tab-2'); });

    expect(ensureConsent).toHaveBeenCalledTimes(1);
    expect(aiChat.addTabLink).not.toHaveBeenCalled();
    expect(aiChat.removeTabLink).not.toHaveBeenCalled();
  });

  it('watchInConversation MOVES a terminal to another conversation (remove old, add + activate target)', async () => {
    const aiChat = makeAiChat(makeTwoTabStates());
    const { result } = renderHook(() => useAiOrchestrator(makeOptions({ aiChat })));

    await act(async () => { result.current.watchInConversation(SID, 'tab-2'); });

    expect(aiChat.removeTabLink).toHaveBeenCalledWith(PANE, TAB, SID);
    expect(aiChat.addTabLink).toHaveBeenCalledWith(PANE, 'tab-2', SID);
    expect(aiChat.setActiveTab).toHaveBeenCalledWith(PANE, 'tab-2');
  });

  it('watchInConversation toggles OFF when targeting the current owner (remove only)', async () => {
    const aiChat = makeAiChat(makeTwoTabStates());
    const { result } = renderHook(() => useAiOrchestrator(makeOptions({ aiChat })));

    await act(async () => { result.current.watchInConversation(SID, TAB); });

    expect(aiChat.removeTabLink).toHaveBeenCalledWith(PANE, TAB, SID);
    expect(aiChat.addTabLink).not.toHaveBeenCalled();
  });

  it('watchInConversation "new" seeds a fresh conversation and moves the terminal into it', async () => {
    const aiChat = makeAiChat(makeTwoTabStates());
    aiChat.addTab = vi.fn(() => 'tab-new') as OrchestratorAiChatApi['addTab'];
    const { result } = renderHook(() => useAiOrchestrator(makeOptions({ aiChat })));

    await act(async () => { result.current.watchInConversation(SID, 'new'); });

    expect(aiChat.removeTabLink).toHaveBeenCalledWith(PANE, TAB, SID); // left old owner
    expect(aiChat.addTab).toHaveBeenCalledWith(PANE);
    expect(aiChat.addTabLink).toHaveBeenCalledWith(PANE, 'tab-new', SID);
    expect(aiChat.setActiveTab).toHaveBeenCalledWith(PANE, 'tab-new');
  });
});
