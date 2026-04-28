import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePromptDetection } from './usePromptDetection';
import type { PromptPattern } from '../types/appTypes';
import { DEFAULT_PROMPT_PATTERNS } from '../stores/settingsStore';

function makeBufferLine(text: string, isWrapped = false) {
  return {
    isWrapped,
    translateToString: vi.fn(() => text),
  };
}

function makeMockTerminal(opts?: {
  baseY?: number;
  cursorY?: number;
  length?: number;
  getLine?: (y: number) => unknown;
}) {
  const disposables: Array<{ dispose: () => void }> = [];
  const renderHandlers: Array<(e: { start: number; end: number }) => void> = [];
  const buffer = {
    active: {
      baseY: opts?.baseY ?? 0,
      cursorY: opts?.cursorY ?? 0,
      length: opts?.length ?? 0,
      viewportY: 0,
      getLine: vi.fn(opts?.getLine ?? (() => null)),
    },
  };
  return {
    element: document.createElement('div'),
    buffer,
    onCursorMove: vi.fn(() => {
      const d = { dispose: vi.fn() };
      disposables.push(d);
      return d;
    }),
    onLineFeed: vi.fn(() => {
      const d = { dispose: vi.fn() };
      disposables.push(d);
      return d;
    }),
    onRender: vi.fn((handler: (e: { start: number; end: number }) => void) => {
      renderHandlers.push(handler);
      const d = { dispose: vi.fn() };
      disposables.push(d);
      return d;
    }),
    _disposables: disposables,
    _renderHandlers: renderHandlers,
  };
}

describe('usePromptDetection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('returns empty markers when disabled', () => {
    const term = makeMockTerminal();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { result } = renderHook(() => usePromptDetection(term as any, false, DEFAULT_PROMPT_PATTERNS));
    expect(result.current).toEqual([]);
    expect(term.onCursorMove).not.toHaveBeenCalled();
  });

  it('returns empty markers when patterns is empty', () => {
    const term = makeMockTerminal();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { result } = renderHook(() => usePromptDetection(term as any, true, []));
    expect(result.current).toEqual([]);
  });

  it('subscribes to terminal events when enabled', () => {
    const term = makeMockTerminal();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderHook(() => usePromptDetection(term as any, true, DEFAULT_PROMPT_PATTERNS));
    expect(term.onCursorMove).toHaveBeenCalledOnce();
    expect(term.onLineFeed).toHaveBeenCalledOnce();
    expect(term.onRender).toHaveBeenCalledOnce();
  });

  it('disposes listeners on cleanup', () => {
    const term = makeMockTerminal();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { unmount } = renderHook(() => usePromptDetection(term as any, true, DEFAULT_PROMPT_PATTERNS));
    expect(term._disposables.length).toBe(3);
    unmount();
    for (const d of term._disposables) {
      expect(d.dispose).toHaveBeenCalled();
    }
  });

  it('handles invalid regex patterns without crashing', () => {
    const term = makeMockTerminal({
      length: 1,
      cursorY: 0,
      getLine: () => makeBufferLine('PS C:\\>'),
    });
    const badPatterns: PromptPattern[] = [
      { id: 'bad', name: 'Bad', pattern: '([invalid' },
      { id: 'powershell', name: 'PowerShell', pattern: '^(PS\\s+.*>)\\s*' },
    ];
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderHook(() => usePromptDetection(term as any, true, badPatterns))
    ).not.toThrow();
  });

  it('DEFAULT_PROMPT_PATTERNS all compile as valid regex', () => {
    for (const p of DEFAULT_PROMPT_PATTERNS) {
      expect(() => new RegExp(p.pattern)).not.toThrow();
    }
  });
});
