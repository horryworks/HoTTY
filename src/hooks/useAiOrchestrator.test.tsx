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

function makeStates(linkedSessionId: string | undefined = SID): Map<string, AiChatState> {
  return new Map<string, AiChatState>([[PANE, {
    selectedModel: '',
    systemInstruction: 'You are a helpful assistant.',
    activeTabId: TAB,
    tabs: [{ id: TAB, ordinal: 1, title: '', linkedSessionId }],
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
    setTabLink: vi.fn(),
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
        tabs: expect.arrayContaining([expect.objectContaining({ linkedSessionId: SID })]),
      }),
    );
  });

  it('handleSessionRemoved unlinks the last linked tab and evicts the watch buffer', () => {
    const aiChat = makeAiChat(makeStates());
    const { result } = renderHook(() => useAiOrchestrator(makeOptions({ aiChat })));

    act(() => { result.current.handleSessionRemoved(SID); });

    // Last remaining tab is UNLINKED (retaining its binding key), not closed.
    expect(aiChat.setTabLink).toHaveBeenCalledWith(PANE, TAB, undefined, { retainBindingKey: true });
    expect(aiChat.closeTab).not.toHaveBeenCalled();
    expect(tv.setWatching).toHaveBeenCalledWith(SID, false, 0);
  });
});
