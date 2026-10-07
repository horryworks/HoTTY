import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { MutableRefObject } from 'react';

// Capture the single `ai-chat-response` listener the hook subscribes, so tests
// can push chunk/done/error events through the hook's real per-tab routing.
const h = vi.hoisted(() => ({
  cb: { current: null as null | ((d: unknown) => void) },
}));

vi.mock('../services/tauriService', () => ({
  tauriService: {
    onAiChatResponse: vi.fn((cb: (d: unknown) => void) => {
      h.cb.current = cb;
      // Per-listener, like Tauri's: a late unlisten from a previous instance
      // must not tear down the listener a newer instance registered.
      return Promise.resolve(() => {
        if (h.cb.current === cb) h.cb.current = null;
      });
    }),
    aiChatCancel: vi.fn().mockResolvedValue(undefined),
  },
}));

const { useChatStream } = await import('./useChatStream');
const { useAiTranscriptStore } = await import('../stores/aiTranscriptStore');
const { noteRequest, resetRequestTracker } = await import('../utils/aiRequestTracker');

function makeOptions(overrides?: Partial<Parameters<typeof useChatStream>[0]>) {
  return {
    paneId: 'ai-1',
    activeTabId: 't1',
    selectedModelRef: { current: 'gemini-pro' } as MutableRefObject<string>,
    onStreamComplete: vi.fn(),
    ...overrides,
  };
}

const emit = (d: unknown) => act(() => { h.cb.current?.(d); });

describe('useChatStream', () => {
  beforeEach(() => {
    h.cb.current = null;
    vi.clearAllMocks();
    useAiTranscriptStore.setState({ panes: new Map() });
  });

  it('keeps the transcript and a stream in flight across the pane being re-created', async () => {
    // Dragging the AI Chat tab to another cell re-creates the pane. The
    // conversation must come back, and the answer still streaming must land.
    const first = renderHook(() => useChatStream(makeOptions()));
    await waitFor(() => expect(h.cb.current).toBeTruthy());
    act(() => { first.result.current.markStreaming('t1', true); });
    emit({ sessionId: 'ai-1::t1', responseType: 'done', content: 'first answer' });
    act(() => { first.result.current.markStreaming('t1', true); });
    emit({ sessionId: 'ai-1::t1', responseType: 'chunk', content: 'second, par' });
    first.unmount();

    const onStreamComplete = vi.fn();
    const second = renderHook(() => useChatStream(makeOptions({ onStreamComplete })));
    await waitFor(() => expect(h.cb.current).toBeTruthy());
    expect(second.result.current.messages).toEqual([{ role: 'model', content: 'first answer' }]);
    expect(second.result.current.isStreaming).toBe(true);
    expect(second.result.current.streamingContent).toBe('second, par');
    // No phantom completion for the stream that was merely carried over…
    expect(onStreamComplete).not.toHaveBeenCalled();
    // …and its real end is delivered to the new instance.
    emit({ sessionId: 'ai-1::t1', responseType: 'done', content: 'second, partial no more' });
    expect(second.result.current.messages).toHaveLength(2);
    await waitFor(() => expect(onStreamComplete).toHaveBeenCalledWith('t1', expect.anything(), 'done'));
  });

  it('starts empty and not streaming', () => {
    const { result } = renderHook(() => useChatStream(makeOptions()));
    expect(result.current.messages).toEqual([]);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamingContent).toBe('');
    expect(result.current.totalInputTokens).toBe(0);
    expect(result.current.totalOutputTokens).toBe(0);
  });

  it('routes chunk events to the owning tab and marks it streaming', async () => {
    const { result } = renderHook(() => useChatStream(makeOptions()));
    await waitFor(() => expect(h.cb.current).toBeTruthy());
    act(() => { result.current.markStreaming('t1', true); });
    emit({ sessionId: 'ai-1::t1', responseType: 'chunk', content: 'Hel' });
    emit({ sessionId: 'ai-1::t1', responseType: 'chunk', content: 'lo' });
    expect(result.current.streamingContent).toBe('Hello');
    expect(result.current.isStreaming).toBe(true);
  });

  it('ignores events addressed to a different pane', async () => {
    const { result } = renderHook(() => useChatStream(makeOptions()));
    await waitFor(() => expect(h.cb.current).toBeTruthy());
    act(() => { result.current.markStreaming('t1', true); });
    emit({ sessionId: 'other-pane::t1', responseType: 'chunk', content: 'nope' });
    expect(result.current.streamingContent).toBe('');
  });

  it('drops a chunk for a tab that is not streaming (late event)', async () => {
    const { result } = renderHook(() => useChatStream(makeOptions()));
    await waitFor(() => expect(h.cb.current).toBeTruthy());
    emit({ sessionId: 'ai-1::t1', responseType: 'chunk', content: 'ghost' });
    expect(result.current.streamingContent).toBe('');
  });

  it('commits a done event: message added, partial cleared, tokens accrued, onStreamComplete fired', async () => {
    const onStreamComplete = vi.fn();
    const { result } = renderHook(() => useChatStream(makeOptions({ onStreamComplete })));
    await waitFor(() => expect(h.cb.current).toBeTruthy());
    act(() => { result.current.markStreaming('t1', true); });
    emit({ sessionId: 'ai-1::t1', responseType: 'chunk', content: 'partial' });
    emit({
      sessionId: 'ai-1::t1',
      responseType: 'done',
      content: 'Full answer',
      usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30 },
    });
    expect(result.current.messages).toEqual([{ role: 'model', content: 'Full answer' }]);
    expect(result.current.streamingContent).toBe('');
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.totalInputTokens).toBe(120);
    expect(result.current.totalOutputTokens).toBe(30);
    await waitFor(() =>
      expect(onStreamComplete).toHaveBeenCalledWith('t1', [{ role: 'model', content: 'Full answer' }], 'done'),
    );
  });

  it('closes a streaming tab on a backend cancel, keeping the partial text', async () => {
    // A provider / region / auth change elsewhere cancels every in-flight
    // stream; without this event the tab sat on "Thinking…" for 180 s.
    const onStreamComplete = vi.fn();
    const { result } = renderHook(() => useChatStream(makeOptions({ onStreamComplete })));
    await waitFor(() => expect(h.cb.current).toBeTruthy());
    act(() => { result.current.markStreaming('t1', true); });
    emit({ sessionId: 'ai-1::t1', responseType: 'chunk', content: 'half an' });
    emit({ sessionId: 'ai-1::t1', responseType: 'cancelled', content: 'half an' });
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamingContent).toBe('');
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].content).toContain('half an');
    await waitFor(() => expect(onStreamComplete).toHaveBeenCalledWith('t1', expect.anything(), 'cancelled'));
  });

  it('a cancel with no partial text adds no bubble, and one for a tab already stopped is ignored', async () => {
    const { result } = renderHook(() => useChatStream(makeOptions()));
    await waitFor(() => expect(h.cb.current).toBeTruthy());
    act(() => { result.current.markStreaming('t1', true); });
    emit({ sessionId: 'ai-1::t1', responseType: 'cancelled', content: '' });
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.messages).toEqual([]);
    // The user's own Stop already closed the tab; the backend's echo must not
    // append a second cancelled bubble.
    emit({ sessionId: 'ai-1::t1', responseType: 'cancelled', content: 'late' });
    expect(result.current.messages).toEqual([]);
  });

  it('ignores a late event from an older send, so it cannot close the reply that replaced it', async () => {
    // A cleared (or stopped) reply unwinds on the backend while the next send
    // already streams; its `cancelled` used to end the new reply.
    resetRequestTracker();
    noteRequest('ai-1::t1', 'req-new');
    const { result } = renderHook(() => useChatStream(makeOptions()));
    await waitFor(() => expect(h.cb.current).toBeTruthy());
    act(() => { result.current.markStreaming('t1', true); });
    emit({ sessionId: 'ai-1::t1', responseType: 'cancelled', content: '', requestId: 'req-old' });
    emit({ sessionId: 'ai-1::t1', responseType: 'chunk', content: 'stale text', requestId: 'req-old' });
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.streamingContent).toBe('');
    emit({ sessionId: 'ai-1::t1', responseType: 'chunk', content: 'Huawei ', requestId: 'req-new' });
    emit({ sessionId: 'ai-1::t1', responseType: 'done', content: 'Huawei VRP', requestId: 'req-new' });
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.messages.map((m) => m.content)).toEqual(['Huawei VRP']);
    resetRequestTracker();
  });

  it('accepts an event with no request id, or for a conversation this window never sent on', async () => {
    resetRequestTracker();
    const { result } = renderHook(() => useChatStream(makeOptions()));
    await waitFor(() => expect(h.cb.current).toBeTruthy());
    act(() => { result.current.markStreaming('t1', true); });
    // Started in another window before an AI Chat handover: no record here.
    emit({ sessionId: 'ai-1::t1', responseType: 'done', content: 'moved answer', requestId: 'req-x' });
    act(() => { result.current.markStreaming('t1', true); });
    noteRequest('ai-1::t1', 'req-y');
    emit({ sessionId: 'ai-1::t1', responseType: 'done', content: 'no id' });
    expect(result.current.messages.map((m) => m.content)).toEqual(['moved answer', 'no id']);
    resetRequestTracker();
  });

  it('reports how a stream ended: the reason a caller gave, else "cleared"', async () => {
    const onStreamComplete = vi.fn();
    const { result } = renderHook(() => useChatStream(makeOptions({ onStreamComplete })));
    await waitFor(() => expect(h.cb.current).toBeTruthy());
    act(() => { result.current.markStreaming('t1', true); });
    act(() => { result.current.markStreaming('t1', false, 'cancelled'); });
    await waitFor(() => expect(onStreamComplete).toHaveBeenLastCalledWith('t1', [], 'cancelled'));
    act(() => { result.current.markStreaming('t1', true); });
    act(() => { result.current.clearTabStream('t1'); });
    await waitFor(() => expect(onStreamComplete).toHaveBeenLastCalledWith('t1', [], 'cleared'));
  });

  it('prices an answer with the model it was sent with, not the one selected at done', async () => {
    const selectedModelRef = { current: 'gemini-2.5-pro' } as MutableRefObject<string>;
    const { result } = renderHook(() => useChatStream(makeOptions({ selectedModelRef })));
    await waitFor(() => expect(h.cb.current).toBeTruthy());
    act(() => { result.current.markStreaming('t1', true); });
    // The user switches models (or a region change resets to Unspecified)
    // while the answer is still streaming.
    selectedModelRef.current = 'Unspecified';
    emit({
      sessionId: 'ai-1::t1',
      responseType: 'done',
      content: 'x',
      usageMetadata: { promptTokenCount: 1_000_000, candidatesTokenCount: 0 },
    });
    // 'Unspecified' has no price (cost would stay null); the sent model does.
    expect(result.current.totalCost).not.toBeNull();
    expect(result.current.totalCost).toBeGreaterThan(0);
  });

  it('appends an error message carrying the backend content and stops streaming', async () => {
    const { result } = renderHook(() => useChatStream(makeOptions()));
    await waitFor(() => expect(h.cb.current).toBeTruthy());
    act(() => { result.current.markStreaming('t1', true); });
    emit({ sessionId: 'ai-1::t1', responseType: 'error', content: 'boom' });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].role).toBe('model');
    expect(result.current.messages[0].content).toContain('boom');
    expect(result.current.isStreaming).toBe(false);
  });

  it('clearTabStream drops the tab transcript and its token counters', async () => {
    const { result } = renderHook(() => useChatStream(makeOptions()));
    await waitFor(() => expect(h.cb.current).toBeTruthy());
    act(() => { result.current.markStreaming('t1', true); });
    emit({
      sessionId: 'ai-1::t1',
      responseType: 'done',
      content: 'x',
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 },
    });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.totalInputTokens).toBe(5);
    act(() => { result.current.clearTabStream('t1'); });
    expect(result.current.messages).toEqual([]);
    expect(result.current.totalInputTokens).toBe(0);
  });
});
