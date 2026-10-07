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
  type UseAiChatWindowOptions,
} from './useAiChatWindow';
import { useAiTranscriptStore } from '../stores/aiTranscriptStore';
import {
  AI_HANDOVER_ACK_CHANNEL,
  AI_HANDOVER_CHANNEL,
  AI_HANDOVER_VERSION,
  AI_WATCH_REQUEST_CHANNEL,
  AI_DIALOG_REQUEST_CHANNEL,
  AI_DIALOG_RESULT_CHANNEL,
  buildHandoverAck,
  buildWatchRequest,
  buildDialogRequest,
  buildDialogResult,
} from '../utils/aiWindowHandover';
import { useAiWorkerSessionStore } from '../stores/aiWorkerSessionStore';
import { useSettingsStore } from '../stores/settingsStore';
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

/** Put a transcript for this window's pane into the store the pane reads. */
function seedTranscript(messages: unknown[] = []) {
  useAiTranscriptStore.getState().importPane(PANE, [[TAB, messages as never]], [[TAB, { input: 0, output: 0, cost: null }]]);
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
    watchColdStart: vi.fn(),
    showDialogForRemote: vi.fn(),
    onRemoteDialogResult: vi.fn(),
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
  useAiTranscriptStore.setState({ panes: new Map() });
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
    seedTranscript([]);
    await flush();

    act(() => closeRequested!());
    await flush();

    // The geometry is saved before the window goes, and the close is the one
    // real close (a `close()` would re-enter the close-requested handler).
    expect(tv.getWindowRect).toHaveBeenCalled();
    expect(useSettingsStore.getState().aiWindowBounds).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    expect(tv.closeThisWindow).toHaveBeenCalledTimes(1);
    expect(result.current.closeRequest).toBeNull();
  });

  it('still closes when the geometry cannot be read', async () => {
    tv.getWindowRect.mockRejectedValue(new Error('no window'));
    const opts = makeOptions();
    renderHook(() => useAiChatWindow(opts));
    seedTranscript([]);
    await flush();

    act(() => closeRequested!());
    await flush();

    expect(tv.closeThisWindow).toHaveBeenCalledTimes(1);
  });

  it('asks first when a conversation has messages, and counts what would go', async () => {
    const opts = makeOptions();
    const { result } = renderHook(() => useAiChatWindow(opts));
    seedTranscript([{ role: 'user', text: 'hi' }]);
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
    await flush();
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
    seedTranscript([]);
    await flush();

    act(() => closeRequested!());
    expect(result.current.closeRequest).toEqual({ conversations: 0, workers: 1 });
  });
});

describe('useAiChatWindow — "Watch in the AI Chat window"', () => {
  it('starts a conversation here when there is none, then moves it out', async () => {
    const opts = makeOptions({ aiChatPaneId: undefined, getAiChatState: vi.fn(() => undefined) });
    const { result, rerender } = renderHook(() => useAiChatWindow(opts));
    await flush();

    act(() => result.current.watchInAiWindow('sess-1'));
    await flush();
    // No AI Chat anywhere: the cold-start watch creates one watching the terminal…
    expect(opts.watchColdStart).toHaveBeenCalledWith('sess-1');
    expect(tv.createAiChatWindow).not.toHaveBeenCalled();

    // …and once React has it, the pop-out follows (the menu item used to do nothing).
    opts.aiChatPaneId = PANE;
    (opts.getAiChatState as ReturnType<typeof vi.fn>).mockReturnValue(chatState());
    rerender();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(tv.createAiChatWindow).toHaveBeenCalledTimes(1);
  });

  it('asks an open AI Chat window to watch the terminal instead of moving anything', async () => {
    tv.listWindowLabels.mockResolvedValue(['main', 'win-ai-1']);
    const opts = makeOptions();
    const { result } = renderHook(() => useAiChatWindow(opts));
    await flush();

    act(() => result.current.watchInAiWindow('sess-1'));
    await flush();

    expect(tv.createAiChatWindow).not.toHaveBeenCalled();
    expect(broadcastsOn(AI_WATCH_REQUEST_CHANNEL)).toHaveLength(1);
    expect(JSON.parse(broadcastsOn(AI_WATCH_REQUEST_CHANNEL)[0][1])).toMatchObject({ to: 'win-ai-1', sessionId: 'sess-1' });
  });

  it('a watch request for a terminal already watched only brings the window forward', async () => {
    flags.isAiWindow = true;
    const watched = {
      ...chatState(),
      tabs: [{ id: TAB, title: 'x', linkedSessions: [{ sessionId: 'sess-1' }] }],
    } as unknown as AiChatState;
    const opts = makeOptions({ getAiChatState: vi.fn(() => watched), activeConversationTabId: TAB });
    renderHook(() => useAiChatWindow(opts));
    await flush();

    received!({ channel: AI_WATCH_REQUEST_CHANNEL, payload: JSON.stringify(buildWatchRequest('main', 'sess-1')), origin: 'win-2' });
    // "Watch in" never means "unwatch": the picker's toggle-off is not used.
    expect(opts.watchInConversation).not.toHaveBeenCalled();
    expect(tv.focusWindow).toHaveBeenCalled();

    received!({ channel: AI_WATCH_REQUEST_CHANNEL, payload: JSON.stringify(buildWatchRequest('main', 'sess-2')), origin: 'win-2' });
    expect(opts.watchInConversation).toHaveBeenCalledWith('sess-2', TAB);
  });
});

describe('useAiChatWindow — a connection dialog shown by another window', () => {
  const prefill = { protocol: 'ssh', host: '192.0.2.10', port: 22, username: 'alice', displayName: 'sw-01', nonce: 1 } as never;

  it('an AI Chat window delegates the dialog to an ordinary window', async () => {
    // This window ('main' in the mock) plays the AI Chat window; 'win-2' is the
    // ordinary window that can show a terminal.
    flags.isAiWindow = true;
    tv.listWindowLabels.mockResolvedValue(['main', 'win-2']);
    const opts = makeOptions();
    const { result } = renderHook(() => useAiChatWindow(opts));
    await flush();

    expect(result.current.delegateDialog(PANE, TAB, 'ssh:alice@192.0.2.10:22', prefill)).toBe(true);
    await flush();
    const sent = broadcastsOn(AI_DIALOG_REQUEST_CHANNEL);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0][1])).toMatchObject({ to: 'win-2', from: 'main', paneId: PANE, tabId: TAB, key: 'ssh:alice@192.0.2.10:22' });
  });

  it('an ordinary window shows it itself', () => {
    const { result } = renderHook(() => useAiChatWindow(makeOptions()));
    expect(result.current.delegateDialog(PANE, TAB, 'k', prefill)).toBe(false);
  });

  it('the origin window shows the dialog, then reports the session back', async () => {
    const opts = makeOptions();
    const { result } = renderHook(() => useAiChatWindow(opts));
    await flush();
    const req = buildDialogRequest({ to: 'main', from: 'win-ai-1', paneId: PANE, tabId: TAB, key: 'k', prefill });

    received!({ channel: AI_DIALOG_REQUEST_CHANNEL, payload: JSON.stringify(req), origin: 'win-ai-1' });
    expect(opts.showDialogForRemote).toHaveBeenCalledWith(expect.objectContaining({ paneId: PANE, tabId: TAB, key: 'k' }));

    act(() => result.current.reportDialogResult(req, 'sess-9'));
    await flush();
    expect(JSON.parse(broadcastsOn(AI_DIALOG_RESULT_CHANNEL)[0][1])).toMatchObject({ to: 'win-ai-1', paneId: PANE, tabId: TAB, key: 'k', sessionId: 'sess-9' });
  });

  it('the waiting window links the session it is told about, or hears the decline', async () => {
    const opts = makeOptions();
    renderHook(() => useAiChatWindow(opts));
    await flush();

    received!({
      channel: AI_DIALOG_RESULT_CHANNEL,
      payload: JSON.stringify(buildDialogResult({ to: 'main', paneId: PANE, tabId: TAB, key: 'k', sessionId: 'sess-9' })),
      origin: 'win-2',
    });
    expect(opts.onRemoteDialogResult).toHaveBeenCalledWith(PANE, TAB, 'k', 'sess-9');

    received!({
      channel: AI_DIALOG_RESULT_CHANNEL,
      payload: JSON.stringify(buildDialogResult({ to: 'main', paneId: PANE, tabId: TAB, key: 'k' })),
      origin: 'win-2',
    });
    expect(opts.onRemoteDialogResult).toHaveBeenLastCalledWith(PANE, TAB, 'k', undefined);
  });
});

describe('useAiChatWindow — handing a conversation out', () => {
  it('refuses to move a conversation that is not at rest', async () => {
    const opts = makeOptions();
    const { result } = renderHook(() => useAiChatWindow(opts));
    act(() => result.current.registerPanePort(PANE, { canMove: () => false }));

    act(() => result.current.popOut());
    await flush();

    // Nothing left this window, the user was told, and the button state is untouched.
    expect(tv.createAiChatWindow).not.toHaveBeenCalled();
    expect(broadcastsOn(AI_HANDOVER_CHANNEL)).toHaveLength(0);
    expect(loggerMock.logError).toHaveBeenCalled();
    expect(result.current.moving).toBe(false);

    // Once the pane says it is idle, the same call goes through.
    act(() => result.current.registerPanePort(PANE, { canMove: () => true }));
    act(() => result.current.popOut());
    await flush();
    expect(tv.createAiChatWindow).toHaveBeenCalledTimes(1);
  });

  it('forgets the transcripts once the receiver has them', async () => {
    const opts = makeOptions();
    const { result } = renderHook(() => useAiChatWindow(opts));
    seedTranscript([{ role: 'user', text: 'hi' }]);
    act(() => result.current.popOut());
    await flush();
    act(() =>
      received!({
        channel: AI_HANDOVER_ACK_CHANNEL,
        payload: JSON.stringify(buildHandoverAck({ to: 'main', from: 'win-ai-1', paneId: PANE, adopted: [] })),
        origin: 'win-ai-1',
      }),
    );
    expect(useAiTranscriptStore.getState().panes.has(PANE)).toBe(false);
  });

  it('keeps everything until the receiver acknowledges', async () => {
    const opts = makeOptions();
    const { result } = renderHook(() => useAiChatWindow(opts));
    seedTranscript([{ role: 'user', text: 'hi' }]);

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

  it('keeps a worker the receiver could not adopt in this window\u2019s registry', async () => {
    const store = useAiWorkerSessionStore.getState();
    for (const id of ['w-taken', 'w-kept']) {
      store.upsert({ id, paneId: PANE, tabId: TAB, status: 'connected', protocol: 'ssh', displayName: id } as never);
    }
    const { result } = renderHook(() => useAiChatWindow(makeOptions()));
    act(() => result.current.popOut());
    await flush();

    act(() =>
      received!({
        channel: AI_HANDOVER_ACK_CHANNEL,
        payload: JSON.stringify(
          buildHandoverAck({ to: 'main', from: 'win-ai-1', paneId: PANE, adopted: ['w-taken'] }),
        ),
        origin: 'win-ai-1',
      }),
    );

    const after = useAiWorkerSessionStore.getState().workers;
    expect(after['w-taken']).toBeUndefined();
    // Still this window's session: its idle sweep will close it; forgotten, it
    // would run on with no one able to close it.
    expect(after['w-kept']).toBeDefined();
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
    renderHook(() => useAiChatWindow(opts));
    await flush();

    await deliver(payload());

    expect(tv.adoptSessions).toHaveBeenCalledWith(['w1']);
    expect(opts.importAiChatState).toHaveBeenCalledTimes(1);
    expect(useAiTranscriptStore.getState().panes.get(PANE)?.messagesByTab.get(TAB)).toEqual([{ role: 'user', text: 'hi' }]);
    expect(useAiWorkerSessionStore.getState().workers['w1']).toBeDefined();

    const acks = broadcastsOn(AI_HANDOVER_ACK_CHANNEL);
    expect(acks).toHaveLength(1);
    expect(JSON.parse(acks[0][1])).toMatchObject({ to: 'win-ai-1', paneId: PANE, adopted: ['w1'] });
  });

  it('writes the transcript into the store BEFORE the pane is registered', async () => {
    // The pane's very first render reads the store; registering first would
    // show an empty conversation for one commit — enough for the Network
    // Expert kickoff to identify the device all over again.
    const storeHadPaneAtRegister: boolean[] = [];
    const registerAiChatPane = vi.fn((id: string) => {
      storeHadPaneAtRegister.push(useAiTranscriptStore.getState().panes.has(PANE));
      return id;
    });
    const opts = makeOptions({ registerAiChatPane, aiChatPaneId: undefined });
    renderHook(() => useAiChatWindow(opts));
    await flush();

    await deliver(payload());

    expect(storeHadPaneAtRegister).toEqual([true]);
  });

  it('re-acknowledges a repeat delivery instead of installing it twice', async () => {
    const importAiChatState = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    const opts = makeOptions({ importAiChatState });
    renderHook(() => useAiChatWindow(opts));
    await flush();

    await deliver(payload());
    // The live conversation moved on since the first delivery.
    useAiTranscriptStore.getState().updatePane(PANE, (pane) => ({
      ...pane,
      messagesByTab: new Map([[TAB, [{ role: 'user', content: 'hi' }, { role: 'model', content: 'hello' }]]]),
    }));
    await deliver(payload());

    // The sender lost our first ack and retried: it must get an ack back…
    expect(broadcastsOn(AI_HANDOVER_ACK_CHANNEL)).toHaveLength(2);
    // …but the transcript must not be replayed over the live conversation.
    expect(useAiTranscriptStore.getState().panes.get(PANE)?.messagesByTab.get(TAB)).toHaveLength(2);
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
    seedTranscript([]);
    act(() => result.current.popOut());
    await flush();

    const wire = JSON.stringify(tv.broadcastSharedChange.mock.calls);
    expect(wire).not.toContain('hunter2');
    expect(wire).not.toContain('password');
  });
});
