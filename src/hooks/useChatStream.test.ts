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
      return Promise.resolve(() => {
        h.cb.current = null;
      });
    }),
    aiChatCancel: vi.fn().mockResolvedValue(undefined),
  },
}));

const { useChatStream } = await import('./useChatStream');

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
      expect(onStreamComplete).toHaveBeenCalledWith('t1', [{ role: 'model', content: 'Full answer' }]),
    );
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
