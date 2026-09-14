import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// Every effect in this hook starts with `if (!IS_TAURI) return;` (several also
// require IS_AI_CHAT_WINDOW), and the real module resolves both to false under
// jsdom — so without this mock the hook does nothing and the assertions below
// would pass vacuously. The AI-window flag is a getter so a test can flip it.
const flags = vi.hoisted(() => ({ isAiWindow: false }));
vi.mock('../utils/windowLabel', () => ({
  IS_TAURI: true,
  WINDOW_LABEL: 'main',
  AI_WINDOW_PREFIX: 'win-ai-',
  get IS_AI_CHAT_WINDOW() {
    return flags.isAiWindow;
  },
}));

const tv = vi.hoisted(() => ({
  broadcastSharedChange: vi.fn(),
  onSharedStoreChanged: vi.fn(),
  onCloseRequested: vi.fn(),
  adoptSessions: vi.fn(),
  getWatchBuffer: vi.fn(),
  createAiChatWindow: vi.fn(),
  createWindow: vi.fn(),
  listWindowLabels: vi.fn(),
  closeThisWindow: vi.fn(),
  focusWindow: vi.fn(),
  setAlwaysOnTop: vi.fn(),
  setWindowTitle: vi.fn(),
  getWindowRect: vi.fn(),
  aiChatClear: vi.fn(),
  logDebug: vi.fn(),
}));
vi.mock('../services/tauriService', () => ({ tauriService: tv }));

const loggerMock = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock('../utils/logger', () => loggerMock);

import {
  useAiChatWindow,
  HANDOVER_ACK_TIMEOUT_MS,
  HANDOVER_RETRY_MS,
  type ChatTranscriptPort,
  type UseAiChatWindowOptions,
} from './useAiChatWindow';
import {
  AI_HANDOVER_ACK_CHANNEL,
  AI_HANDOVER_CHANNEL,
  AI_HANDOVER_VERSION,
  buildHandoverAck,
} from '../utils/aiWindowHandover';
import { useAiWorkerSessionStore } from '../stores/aiWorkerSessionStore';
import type { AiChatState } from './useAiChat';

type SharedChangeCb = (e: { channel: string; payload: string; origin: string }) => void;

const PANE = 'ai-1';
const TAB = 'tab-1';

let received: SharedChangeCb | undefined;
let closeRequested: (() => void) | undefined;

/** Minimal conversation state: only `tabs` and `activeTabId` are inspected. */
function chatState(tabs = [TAB]): AiChatState {
  return {
    selectedModel: 'model-x',
    systemInstruction: '',
    activeTabId: tabs[0],
    tabs: tabs.map((id) => ({ id, title: `Chat ${id}` })),
  } as unknown as AiChatState;
}

/** A transcript port whose export/import calls the test can count. */
function makePort(messages: unknown[] = []): ChatTranscriptPort {
  return {
    export: vi.fn(() => ({ messages: [[TAB, messages]], tokens: [[TAB, {}]] })),
    import: vi.fn(),
  } as unknown as ChatTranscriptPort;
}

function makeOptions(over: Partial<UseAiChatWindowOptions> = {}): UseAiChatWindowOptions {
  return {
    aiChatPaneId: PANE,
    getAiChatState: vi.fn(() => chatState()),
    importAiChatState: vi.fn(() => true),
    forgetAiChatState: vi.fn(),
    registerAiChatPane: vi.fn((id: string) => id),
    replaceAiChatPane: vi.fn(),
    removeAiChatPane: vi.fn(),
    clearRunCommandIntervals: vi.fn(),
    watchInConversation: vi.fn(),
    adoptRemoteSession: vi.fn(),
    ...over,
  } as UseAiChatWindowOptions;
}

/** Let queued promises settle without letting the retry interval fire. */
const flush = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
};

const broadcastsOn = (channel: string) =>
  tv.broadcastSharedChange.mock.calls.filter((c) => c[0] === channel);

beforeEach(() => {
  vi.useFakeTimers();
  flags.isAiWindow = false;
  received = undefined;
  closeRequested = undefined;
  useAiWorkerSessionStore.getState().clear();
  loggerMock.logError.mockReset();
  for (const fn of Object.values(tv)) fn.mockReset();
  tv.broadcastSharedChange.mockResolvedValue(undefined);
  tv.adoptSessions.mockResolvedValue([]);
  tv.getWatchBuffer.mockResolvedValue('');
  tv.createAiChatWindow.mockResolvedValue('win-ai-1');
  tv.createWindow.mockResolvedValue('win-2');
  tv.listWindowLabels.mockResolvedValue(['main']);
  tv.closeThisWindow.mockResolvedValue(undefined);
  tv.focusWindow.mockResolvedValue(undefined);
  tv.setAlwaysOnTop.mockResolvedValue(undefined);
  tv.setWindowTitle.mockResolvedValue(undefined);
  tv.getWindowRect.mockResolvedValue({ x: 0, y: 0, width: 800, height: 600 });
  tv.aiChatClear.mockResolvedValue(undefined);
  tv.logDebug.mockResolvedValue(undefined);
  tv.onSharedStoreChanged.mockImplementation((cb: SharedChangeCb) => {
    received = cb;
    return Promise.resolve(() => {});
  });
  tv.onCloseRequested.mockImplementation((cb: () => void) => {
    closeRequested = cb;
    return Promise.resolve(() => {});
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  useAiWorkerSessionStore.getState().clear();
});

describe('useAiChatWindow — closing the AI Chat window', () => {
  beforeEach(() => {
    flags.isAiWindow = true;
  });

  it('closes straight away when there is nothing to lose', async () => {
    const opts = makeOptions();
    const { result } = renderHook(() => useAiChatWindow(opts));
    act(() => result.current.registerTranscriptPort(PANE, makePort([])));
    await flush();

    act(() => closeRequested!());

    expect(tv.closeThisWindow).toHaveBeenCalledTimes(1);
    expect(result.current.closeRequest).toBeNull();
  });

  it('asks first when a conversation has messages, and counts what would go', async () => {
    const opts = makeOptions();
    const { result } = renderHook(() => useAiChatWindow(opts));
    act(() => result.current.registerTranscriptPort(PANE, makePort([{ role: 'user', text: 'hi' }])));
    await flush();

    act(() => closeRequested!());

    expect(tv.closeThisWindow).not.toHaveBeenCalled();
    expect(result.current.closeRequest).toEqual({ conversations: 1, workers: 0 });

    // Keeping the window must leave the conversation completely untouched.
    act(() => result.current.cancelClose());
    expect(result.current.closeRequest).toBeNull();
    expect(tv.aiChatClear).not.toHaveBeenCalled();

    act(() => closeRequested!());
    act(() => result.current.confirmClose());
    expect(opts.clearRunCommandIntervals).toHaveBeenCalledWith(PANE);
    expect(tv.aiChatClear).toHaveBeenCalledTimes(1);
    expect(tv.closeThisWindow).toHaveBeenCalledTimes(1);
  });

  it('counts the AI’s own terminals as something to lose', async () => {
    useAiWorkerSessionStore.getState().upsert({
      id: 'w1',
      paneId: PANE,
      tabId: TAB,
      status: 'connected',
      protocol: 'ssh',
      displayName: 'edge-rtr01',
    } as never);

    const opts = makeOptions();
    const { result } = renderHook(() => useAiChatWindow(opts));
    act(() => result.current.registerTranscriptPort(PANE, makePort([])));
    await flush();

    act(() => closeRequested!());
    expect(result.current.closeRequest).toEqual({ conversations: 0, workers: 1 });
  });
});

describe('useAiChatWindow — handing a conversation out', () => {
  it('keeps everything until the receiver acknowledges', async () => {
    const opts = makeOptions();
    const { result } = renderHook(() => useAiChatWindow(opts));
    act(() => result.current.registerTranscriptPort(PANE, makePort([{ role: 'user', text: 'hi' }])));

    act(() => result.current.popOut());
    await flush();

    // The payload is on its way…
    const sent = broadcastsOn(AI_HANDOVER_CHANNEL);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0][1])).toMatchObject({ to: 'win-ai-1', from: 'main', paneId: PANE });
    expect(result.current.moving).toBe(true);
    // …and until it is acknowledged, this window still owns the conversation.
    expect(opts.forgetAiChatState).not.toHaveBeenCalled();
    expect(opts.removeAiChatPane).not.toHaveBeenCalled();

    act(() =>
      received!({
        channel: AI_HANDOVER_ACK_CHANNEL,
        payload: JSON.stringify(
          buildHandoverAck({ to: 'main', from: 'win-ai-1', paneId: PANE, adopted: [] }),
        ),
        origin: 'win-ai-1',
      }),
    );

    expect(opts.clearRunCommandIntervals).toHaveBeenCalledWith(PANE);
    expect(opts.forgetAiChatState).toHaveBeenCalledWith(PANE);
    expect(opts.removeAiChatPane).toHaveBeenCalledWith(PANE);
    expect(result.current.moving).toBe(false);
  });

  it('re-sends while it waits, because a new window mounts its listener late', async () => {
    const { result } = renderHook(() => useAiChatWindow(makeOptions()));
    act(() => result.current.popOut());
    await flush();
    expect(broadcastsOn(AI_HANDOVER_CHANNEL)).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HANDOVER_RETRY_MS * 2);
    });
    expect(broadcastsOn(AI_HANDOVER_CHANNEL).length).toBeGreaterThanOrEqual(3);
  });

  it('gives up after the ack timeout without throwing the conversation away', async () => {
    const opts = makeOptions();
    const { result } = renderHook(() => useAiChatWindow(opts));
    act(() => result.current.popOut());
    await flush();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HANDOVER_ACK_TIMEOUT_MS + HANDOVER_RETRY_MS);
    });

    expect(result.current.moving).toBe(false);
    expect(loggerMock.logError).toHaveBeenCalled();
    // The whole point of the two-phase handover: a move that never lands must
    // leave the conversation where it was.
    expect(opts.forgetAiChatState).not.toHaveBeenCalled();
    expect(opts.removeAiChatPane).not.toHaveBeenCalled();
  });
});

describe('useAiChatWindow — taking a conversation in', () => {
  const worker = {
    id: 'w1',
    paneId: PANE,
    tabId: TAB,
    status: 'connected',
    protocol: 'ssh',
    displayName: 'edge-rtr01',
    host: '192.0.2.10',
    username: 'alice',
  };

  const payload = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      v: AI_HANDOVER_VERSION,
      to: 'main',
      from: 'win-ai-1',
      paneId: PANE,
      state: chatState(),
      messages: [[TAB, [{ role: 'user', text: 'hi' }]]],
      tokens: [[TAB, {}]],
      workers: [worker],
      ...over,
    });

  const deliver = async (raw: string) => {
    await act(async () => {
      received!({ channel: AI_HANDOVER_CHANNEL, payload: raw, origin: 'win-ai-1' });
      await vi.advanceTimersByTimeAsync(0);
    });
  };

  it('adopts the AI’s terminals, installs the conversation, then acknowledges', async () => {
    tv.adoptSessions.mockResolvedValue(['w1']);
    const opts = makeOptions();
    const port = makePort([]);
    const { result } = renderHook(() => useAiChatWindow(opts));
    act(() => result.current.registerTranscriptPort(PANE, port));
    await flush();

    await deliver(payload());

    expect(tv.adoptSessions).toHaveBeenCalledWith(['w1']);
    expect(opts.importAiChatState).toHaveBeenCalledTimes(1);
    expect(port.import).toHaveBeenCalledTimes(1);
    expect(useAiWorkerSessionStore.getState().workers['w1']).toBeDefined();

    const acks = broadcastsOn(AI_HANDOVER_ACK_CHANNEL);
    expect(acks).toHaveLength(1);
    expect(JSON.parse(acks[0][1])).toMatchObject({ to: 'win-ai-1', paneId: PANE, adopted: ['w1'] });
  });

  it('re-acknowledges a repeat delivery instead of installing it twice', async () => {
    const importAiChatState = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    const opts = makeOptions({ importAiChatState });
    const port = makePort([]);
    const { result } = renderHook(() => useAiChatWindow(opts));
    act(() => result.current.registerTranscriptPort(PANE, port));
    await flush();

    await deliver(payload());
    await deliver(payload());

    // The sender lost our first ack and retried: it must get an ack back…
    expect(broadcastsOn(AI_HANDOVER_ACK_CHANNEL)).toHaveLength(2);
    // …but the transcript must not be replayed over the live conversation.
    expect(port.import).toHaveBeenCalledTimes(1);
  });

  it('ignores a payload addressed to another window, and its own echo', async () => {
    const opts = makeOptions();
    renderHook(() => useAiChatWindow(opts));
    await flush();

    await deliver(payload({ to: 'win-ai-9' }));
    expect(opts.importAiChatState).not.toHaveBeenCalled();

    await act(async () => {
      received!({ channel: AI_HANDOVER_CHANNEL, payload: payload(), origin: 'main' });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(opts.importAiChatState).not.toHaveBeenCalled();
  });

  it('never puts a credential on the wire', async () => {
    // The worker registry is the part of the payload that describes a live
    // connection, so this is where a password would leak if one ever got in.
    useAiWorkerSessionStore.getState().upsert({ ...worker, key: 'k1', openedAt: 0, lastUsedAt: 0, manualLogin: false } as never);

    const opts = makeOptions();
    const { result } = renderHook(() => useAiChatWindow(opts));
    act(() => result.current.registerTranscriptPort(PANE, makePort([])));
    act(() => result.current.popOut());
    await flush();

    const wire = JSON.stringify(tv.broadcastSharedChange.mock.calls);
    expect(wire).not.toContain('hunter2');
    expect(wire).not.toContain('password');
  });
});
