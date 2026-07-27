import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../services/tauriService', () => ({
  tauriService: {
    aiChatLogAppend: vi.fn().mockResolvedValue(undefined),
    aiChatLogClose: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../utils/logger', () => ({
  logError: vi.fn(),
}));

const pushNotification = vi.fn();
vi.mock('../stores/errorNotificationStore', () => ({
  useErrorNotificationStore: (selector: (s: unknown) => unknown) =>
    selector({ push: pushNotification }),
}));

const { tauriService } = await import('../services/tauriService');
const { useChatLog } = await import('./useChatLog');
type ChatLogOptions = Parameters<typeof useChatLog>[0];
type ChatMessage = ChatLogOptions['messagesByTab'] extends Map<string, (infer M)[]> ? M : never;

const appendMock = vi.mocked(tauriService.aiChatLogAppend);
const closeMock = vi.mocked(tauriService.aiChatLogClose);

function user(content: string): ChatMessage {
  return { role: 'user', content } as ChatMessage;
}
function model(content: string): ChatMessage {
  return { role: 'model', content } as ChatMessage;
}

function makeOptions(
  messagesByTab: Map<string, ChatMessage[]>,
  overrides?: Partial<ChatLogOptions>,
): ChatLogOptions {
  return {
    paneId: 'ai-1',
    messagesByTab,
    tabs: [{ id: 't1', title: 'router-a', linkedSessions: [{ sessionId: 's1' }] }],
    selectedModel: 'gemini-2.5-pro',
    provider: 'gemini',
    resolveTerminalName: (id: string) => (id === 's1' ? 'router-a' : undefined),
    loggingEnabled: true,
    loggingPath: 'C:/logs',
    ...overrides,
  };
}

describe('useChatLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appendMock.mockResolvedValue(undefined);
    closeMock.mockResolvedValue(undefined);
  });

  it('flushes only turns that have not been written yet', async () => {
    const map1 = new Map([['t1', [user('one')]]]);
    const { rerender } = renderHook((opts: ChatLogOptions) => useChatLog(opts), {
      initialProps: makeOptions(map1),
    });

    await waitFor(() => expect(appendMock).toHaveBeenCalledTimes(1));
    expect(appendMock.mock.calls[0][3]).toEqual([{ role: 'user', content: 'one' }]);

    const map2 = new Map([['t1', [user('one'), model('two'), user('three')]]]);
    rerender(makeOptions(map2));

    await waitFor(() => expect(appendMock).toHaveBeenCalledTimes(2));
    expect(appendMock.mock.calls[1][3]).toEqual([
      { role: 'model', content: 'two' },
      { role: 'user', content: 'three' },
    ]);
  });

  it('sends the log key, folder and header metadata', async () => {
    const map = new Map([['t1', [user('hi')]]]);
    renderHook(() => useChatLog(makeOptions(map)));

    await waitFor(() => expect(appendMock).toHaveBeenCalledTimes(1));
    const [logKey, logDir, meta] = appendMock.mock.calls[0];
    expect(logKey).toBe('ai-1::t1');
    expect(logDir).toBe('C:/logs');
    expect(meta).toEqual({
      title: 'router-a',
      model: 'gemini-2.5-pro',
      provider: 'gemini',
      terminals: ['router-a'],
    });
  });

  it('does not re-send when re-rendered with the same transcript', async () => {
    const map = new Map([['t1', [user('one')]]]);
    const { rerender } = renderHook((opts: ChatLogOptions) => useChatLog(opts), {
      initialProps: makeOptions(map),
    });
    await waitFor(() => expect(appendMock).toHaveBeenCalledTimes(1));

    // Same Map instance — the effect does not re-run.
    rerender(makeOptions(map));
    // A new Map with identical content — the effect re-runs but finds no diff.
    rerender(makeOptions(new Map([['t1', [user('one')]]])));

    await new Promise((r) => setTimeout(r, 0));
    expect(appendMock).toHaveBeenCalledTimes(1);
  });

  it('closes the transcript when a tab disappears (New chat / tab close)', async () => {
    const map = new Map([['t1', [user('one')]]]);
    const { rerender } = renderHook((opts: ChatLogOptions) => useChatLog(opts), {
      initialProps: makeOptions(map),
    });
    await waitFor(() => expect(appendMock).toHaveBeenCalledTimes(1));

    rerender(makeOptions(new Map()));
    await waitFor(() => expect(closeMock).toHaveBeenCalledWith('ai-1::t1'));

    // The next message starts a brand-new transcript, from index 0.
    rerender(makeOptions(new Map([['t1', [user('fresh')]]])));
    await waitFor(() => expect(appendMock).toHaveBeenCalledTimes(2));
    expect(appendMock.mock.calls[1][3]).toEqual([{ role: 'user', content: 'fresh' }]);
  });

  it('closes every tracked transcript when the whole map is reset', async () => {
    const map = new Map([
      ['t1', [user('a')]],
      ['t2', [user('b')]],
    ]);
    const { rerender } = renderHook((opts: ChatLogOptions) => useChatLog(opts), {
      initialProps: makeOptions(map, {
        tabs: [
          { id: 't1', title: 'one', linkedSessions: [] },
          { id: 't2', title: 'two', linkedSessions: [] },
        ],
      }),
    });
    await waitFor(() => expect(appendMock).toHaveBeenCalledTimes(2));

    rerender(makeOptions(new Map()));
    await waitFor(() => expect(closeMock).toHaveBeenCalledTimes(2));
    expect(closeMock.mock.calls.map((c) => c[0]).sort()).toEqual(['ai-1::t1', 'ai-1::t2']);
  });

  it('restarts the transcript when the first message changes identity', async () => {
    const { rerender } = renderHook((opts: ChatLogOptions) => useChatLog(opts), {
      initialProps: makeOptions(new Map([['t1', [user('one'), model('two')]]])),
    });
    await waitFor(() => expect(appendMock).toHaveBeenCalledTimes(1));

    // Same tab id, different conversation (cleared and refilled in one commit).
    rerender(makeOptions(new Map([['t1', [user('brand new')]]])));

    await waitFor(() => expect(closeMock).toHaveBeenCalledWith('ai-1::t1'));
    await waitFor(() => expect(appendMock).toHaveBeenCalledTimes(2));
    expect(appendMock.mock.calls[1][3]).toEqual([{ role: 'user', content: 'brand new' }]);
  });

  it('writes nothing while logging is disabled, and does not backfill when enabled', async () => {
    const { rerender } = renderHook((opts: ChatLogOptions) => useChatLog(opts), {
      initialProps: makeOptions(new Map([['t1', [user('before')]]]), { loggingEnabled: false }),
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(appendMock).not.toHaveBeenCalled();

    rerender(
      makeOptions(new Map([['t1', [user('before'), user('after')]]]), { loggingEnabled: true }),
    );
    await waitFor(() => expect(appendMock).toHaveBeenCalledTimes(1));
    // Only the turn added after logging was switched on.
    expect(appendMock.mock.calls[0][3]).toEqual([{ role: 'user', content: 'after' }]);
  });

  it('writes nothing when no log folder is configured', async () => {
    renderHook(() => useChatLog(makeOptions(new Map([['t1', [user('hi')]]]), { loggingPath: '' })));
    await new Promise((r) => setTimeout(r, 0));
    expect(appendMock).not.toHaveBeenCalled();
  });

  it('sends image metadata only — never the base64 payload', async () => {
    const withImage = {
      role: 'user',
      content: 'look',
      images: [{ mimeType: 'image/png', dataBase64: 'A'.repeat(400) }],
    } as ChatMessage;
    renderHook(() => useChatLog(makeOptions(new Map([['t1', [withImage]]]))));

    await waitFor(() => expect(appendMock).toHaveBeenCalledTimes(1));
    const turns = appendMock.mock.calls[0][3];
    expect(turns[0].images).toEqual([{ mimeType: 'image/png', bytes: 300 }]);
    expect(JSON.stringify(turns)).not.toContain('AAAA');
  });

  it('gives up after a failure and notifies the user once', async () => {
    appendMock.mockRejectedValue(new Error('log directory not approved: C:/logs'));

    const { rerender } = renderHook((opts: ChatLogOptions) => useChatLog(opts), {
      initialProps: makeOptions(new Map([['t1', [user('one')]]])),
    });
    await waitFor(() => expect(pushNotification).toHaveBeenCalledTimes(1));
    expect(pushNotification.mock.calls[0][1]).toContain('not approved');

    rerender(makeOptions(new Map([['t1', [user('one'), user('two')]]])));
    await new Promise((r) => setTimeout(r, 0));
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(pushNotification).toHaveBeenCalledTimes(1);
  });

  it('retries after the log folder is changed', async () => {
    appendMock.mockRejectedValueOnce(new Error('nope'));
    const { rerender } = renderHook((opts: ChatLogOptions) => useChatLog(opts), {
      initialProps: makeOptions(new Map([['t1', [user('one')]]])),
    });
    await waitFor(() => expect(pushNotification).toHaveBeenCalledTimes(1));

    rerender(
      makeOptions(new Map([['t1', [user('one'), user('two')]]]), { loggingPath: 'D:/other' }),
    );
    await waitFor(() => expect(appendMock).toHaveBeenCalledTimes(2));
    expect(appendMock.mock.calls[1][1]).toBe('D:/other');
  });

  it('keeps appends for one tab in order', async () => {
    const { rerender } = renderHook((opts: ChatLogOptions) => useChatLog(opts), {
      initialProps: makeOptions(new Map([['t1', [user('one')]]])),
    });
    rerender(makeOptions(new Map([['t1', [user('one'), user('two')]]])));
    rerender(makeOptions(new Map([['t1', [user('one'), user('two'), user('three')]]])));

    await waitFor(() => expect(appendMock).toHaveBeenCalledTimes(3));
    expect(appendMock.mock.calls.map((c) => c[3][0].content)).toEqual(['one', 'two', 'three']);
  });
});
