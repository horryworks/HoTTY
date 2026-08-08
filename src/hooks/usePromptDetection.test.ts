import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
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
  const cursorMoveHandlers: Array<() => void> = [];
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
    onCursorMove: vi.fn((handler: () => void) => {
      cursorMoveHandlers.push(handler);
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
    _cursorMoveHandlers: cursorMoveHandlers,
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

  it('detects a prompt line and leaves plain output unmarked', async () => {
    const term = makeMockTerminal({
      length: 2,
      cursorY: 1,
      getLine: (y: number) =>
        makeBufferLine(y === 0 ? 'alice@host:~$ ' : 'total 12'),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { result } = renderHook(() => usePromptDetection(term as any, true, DEFAULT_PROMPT_PATTERNS));
    await act(async () => {});
    expect(result.current).toEqual([
      { line: 0, isPrompt: true, lineCount: 1 },
      { line: 1, isPrompt: false, lineCount: 1 },
    ]);
  });

  // Regression guard for the bulk-output hot path: patterns are compiled once
  // per `patterns` identity, NOT once per evaluated row. Reading `.pattern`
  // is the observable proxy — the compile pass touches it twice (truthiness
  // check + `new RegExp`), so anything beyond that means per-row compiling
  // has crept back in.
  it('compiles each pattern once per patterns identity, not once per row', () => {
    let reads = 0;
    const counting: PromptPattern[] = [
      {
        id: 'linux',
        name: 'Linux',
        get pattern() {
          reads++;
          return '^([-_\\w]+@[-_\\w]+:[^$# ]*[$#])\\s*';
        },
      },
    ];
    const term = makeMockTerminal({
      length: 50,
      cursorY: 40, // scanAllLines() evaluates rows 0..40 on mount
      getLine: (y: number) =>
        makeBufferLine(y % 2 === 0 ? 'alice@host:~$ ' : 'some output line'),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderHook(() => usePromptDetection(term as any, true, counting));
    expect(reads).toBeLessThanOrEqual(2);
  });

  it('warns about an invalid pattern but keeps the remaining ones working', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const term = makeMockTerminal({
      length: 1,
      cursorY: 0,
      getLine: () => makeBufferLine('PS C:\\Users\\alice>'),
    });
    const patterns: PromptPattern[] = [
      { id: 'bad', name: 'Bad', pattern: '([invalid' },
      { id: 'powershell', name: 'PowerShell', pattern: '^(PS\\s+.*>)\\s*' },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { result } = renderHook(() => usePromptDetection(term as any, true, patterns));
    await act(async () => {});
    expect(warn).toHaveBeenCalledOnce();
    // The valid pattern behind the broken one must still match.
    expect(result.current).toEqual([{ line: 0, isPrompt: true, lineCount: 1 }]);
    warn.mockRestore();
  });

  // NFC normalisation is skipped for ASCII-only rows (the hot path). A line
  // carrying a combining mark must still take the slow path and match a
  // pattern written in composed form.
  it('still matches a decomposed (NFD) line against a composed pattern', async () => {
    const term = makeMockTerminal({
      length: 1,
      cursorY: 0,
      getLine: () => makeBufferLine('e\u0301-router>'), // "é" as e + U+0301
    });
    const patterns: PromptPattern[] = [
      { id: 'accented', name: 'Accented', pattern: '^\u00e9-router>' }, // composed "é"
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { result } = renderHook(() => usePromptDetection(term as any, true, patterns));
    await act(async () => {});
    expect(result.current).toEqual([{ line: 0, isPrompt: true, lineCount: 1 }]);
  });

  it('re-evaluates markers at or below the cursor on cursor move', async () => {
    let row1Text = 'alice@host:~$ ';
    const term = makeMockTerminal({
      length: 3,
      cursorY: 2,
      getLine: (y: number) =>
        makeBufferLine(y === 1 ? row1Text : 'alice@host:~$ '),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { result } = renderHook(() => usePromptDetection(term as any, true, DEFAULT_PROMPT_PATTERNS));
    await act(async () => {});
    expect(result.current.find((m) => m.line === 1)?.isPrompt).toBe(true);

    // Row 1 is overwritten with plain output and the cursor moves ABOVE it,
    // so the tracked marker must be re-evaluated rather than left stale.
    row1Text = 'not a prompt anymore';
    term.buffer.active.cursorY = 0;
    await act(async () => {
      term._cursorMoveHandlers[0]();
    });
    expect(result.current.find((m) => m.line === 1)?.isPrompt).toBe(false);
  });

  it('drops markers that fall out of range once the buffer shrinks', async () => {
    const term = makeMockTerminal({
      length: 4,
      cursorY: 3,
      getLine: () => makeBufferLine('alice@host:~$ '),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { result } = renderHook(() => usePromptDetection(term as any, true, DEFAULT_PROMPT_PATTERNS));
    await act(async () => {});
    expect(result.current.map((m) => m.line)).toEqual([0, 1, 2, 3]);

    // First render observes the current length; the prune only runs once the
    // buffer is seen to shrink (e.g. clear / alternate-buffer switch).
    await act(async () => {
      term._renderHandlers[0]({ start: 0, end: 0 });
    });
    term.buffer.active.length = 2;
    term.buffer.active.cursorY = 0;
    await act(async () => {
      term._renderHandlers[0]({ start: 0, end: 0 });
    });
    expect(result.current.map((m) => m.line)).toEqual([0, 1]);
  });
});
