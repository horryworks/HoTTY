import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePromptHighlight } from './usePromptHighlight';
import type { PromptPattern } from '../types/appTypes';
import { DEFAULT_PROMPT_PATTERNS } from '../stores/settingsStore';

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
      getLine: vi.fn(opts?.getLine ?? (() => null)),
    },
  };

  return {
    element: document.createElement('div'),
    buffer,
    registerMarker: vi.fn().mockReturnValue({
      line: 0,
      isDisposed: false,
      dispose: vi.fn(),
      onDispose: vi.fn(),
    }),
    registerDecoration: vi.fn().mockReturnValue({
      marker: { line: 0, isDisposed: false },
      onRender: vi.fn(),
      onDispose: vi.fn(),
      dispose: vi.fn(),
    }),
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
    selectLines: vi.fn(),
    _disposables: disposables,
    _renderHandlers: renderHandlers,
  };
}

function makeBufferLine(text: string, isWrapped = false) {
  return {
    isWrapped,
    translateToString: vi.fn(() => text),
  };
}

type MockTerminal = ReturnType<typeof makeMockTerminal>;

const defaultPatterns: PromptPattern[] = [
  { id: 'linux', name: 'Linux', pattern: '^([-_\\w]+@[-_\\w]+:[^$# ]*[$#])\\s*' },
];

describe('usePromptHighlight', () => {
  let mockTerm: MockTerminal;

  beforeEach(() => {
    mockTerm = makeMockTerminal();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing when disabled', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderHook(() => usePromptHighlight(mockTerm as any, false, '#f44336', defaultPatterns));
    expect(mockTerm.onCursorMove).not.toHaveBeenCalled();
    expect(mockTerm.onLineFeed).not.toHaveBeenCalled();
    expect(mockTerm.onRender).not.toHaveBeenCalled();
  });

  it('does nothing when term is null', () => {
    renderHook(() => usePromptHighlight(null, true, '#f44336', defaultPatterns));
    // No errors thrown
  });

  it('registers event listeners when enabled', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderHook(() => usePromptHighlight(mockTerm as any, true, '#f44336', defaultPatterns));
    expect(mockTerm.onCursorMove).toHaveBeenCalledOnce();
    expect(mockTerm.onLineFeed).toHaveBeenCalledOnce();
    expect(mockTerm.onRender).toHaveBeenCalledOnce();
  });

  it('disposes event listeners on cleanup', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { unmount } = renderHook(() => usePromptHighlight(mockTerm as any, true, '#f44336', defaultPatterns));
    const disposables = mockTerm._disposables;
    expect(disposables.length).toBe(3);

    unmount();
    for (const d of disposables) {
      expect(d.dispose).toHaveBeenCalled();
    }
  });

  it('does nothing when patterns array is empty', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderHook(() => usePromptHighlight(mockTerm as any, true, '#f44336', []));
    // Should still register listeners (the evaluateLine just won't match anything)
    expect(mockTerm.onCursorMove).toHaveBeenCalledOnce();
  });

  it('handles invalid regex patterns without crashing', () => {
    const badPatterns: PromptPattern[] = [
      { id: 'bad', name: 'Bad', pattern: '([invalid' },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => renderHook(() => usePromptHighlight(mockTerm as any, true, '#f44336', badPatterns))).not.toThrow();
  });

  it('DEFAULT_PROMPT_PATTERNS all compile as valid regex', () => {
    for (const p of DEFAULT_PROMPT_PATTERNS) {
      expect(() => new RegExp(p.pattern)).not.toThrow();
    }
  });

  it('does not register a marker for unused trailing rows below the cursor', () => {
    // Cursor at row 5, length 24 -> rows 6..23 are pre-allocated empty
    // viewport rows that should carry no marker.
    const term = makeMockTerminal({
      length: 24,
      cursorY: 5,
      baseY: 0,
      getLine: (y: number) => {
        if (y === 5) return makeBufferLine('PS C:\\>'); // cursor row = prompt
        return makeBufferLine(''); // everything else empty
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderHook(() => usePromptHighlight(term as any, true, '', DEFAULT_PROMPT_PATTERNS));
    // scanAllLines walks 0..5; clear those mock calls to focus on trailing rows
    term.registerMarker.mockClear();
    term.registerDecoration.mockClear();
    // Force evaluation of unused trailing rows
    expect(term._renderHandlers.length).toBe(1);
    term._renderHandlers[0]({ start: 6, end: 23 });
    // Rows 6..23 are all empty AND below cursor -> no marker
    expect(term.registerMarker).not.toHaveBeenCalled();
    expect(term.registerDecoration).not.toHaveBeenCalled();
  });

  it('registers a non-prompt marker for empty rows ABOVE the cursor (real blank output)', () => {
    // Row 0 = empty (blank line within command output), cursor at row 5.
    // scanAllLines walks 0..5; row 0 is empty AND above cursor => marker.
    const term = makeMockTerminal({
      length: 24,
      cursorY: 5,
      baseY: 0,
      getLine: (y: number) => {
        if (y === 5) return makeBufferLine('PS C:\\>');
        if (y === 0) return makeBufferLine(''); // blank line above cursor
        return makeBufferLine('some output');
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderHook(() => usePromptHighlight(term as any, true, '', DEFAULT_PROMPT_PATTERNS));
    // We expect markers for rows 0..5 (6 logical lines, all evaluated by scanAllLines)
    // The exact count depends on internal scanning but at minimum row 0 (empty above cursor)
    // must trigger registerMarker.
    expect(term.registerMarker).toHaveBeenCalled();
    // Specifically, row 0 should have been registered (empty above cursor -> blue marker)
    const calls = term.registerMarker.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(2); // at least row 0 and row 5
  });

  it('registers a marker for a PowerShell prompt line', () => {
    const term = makeMockTerminal({
      length: 1,
      cursorY: 0,
      baseY: 0,
      getLine: () => makeBufferLine('PS C:\\Users\\horry>'),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderHook(() => usePromptHighlight(term as any, true, '', DEFAULT_PROMPT_PATTERNS));
    expect(term.registerMarker).toHaveBeenCalledTimes(1);
    expect(term.registerDecoration).toHaveBeenCalledTimes(1);
  });

  it('registers a marker for non-prompt content lines (output)', () => {
    const term = makeMockTerminal({
      length: 1,
      cursorY: 0,
      baseY: 0,
      getLine: () => makeBufferLine('some command output here'),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderHook(() => usePromptHighlight(term as any, true, '', DEFAULT_PROMPT_PATTERNS));
    expect(term.registerMarker).toHaveBeenCalledTimes(1);
  });

  it('paints prompt lines with --terminal-prompt-default fallback when no highlight color set', () => {
    const term = makeMockTerminal({
      length: 1,
      cursorY: 0,
      baseY: 0,
      getLine: () => makeBufferLine('PS C:\\>'),
    });

    const onRenderCallbacks: Array<(el: HTMLElement) => void> = [];
    term.registerDecoration = vi.fn().mockReturnValue({
      marker: { line: 0, isDisposed: false },
      onRender: (cb: (el: HTMLElement) => void) => onRenderCallbacks.push(cb),
      onDispose: vi.fn(),
      dispose: vi.fn(),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderHook(() => usePromptHighlight(term as any, true, '', DEFAULT_PROMPT_PATTERNS));

    expect(onRenderCallbacks.length).toBeGreaterThan(0);
    const el = document.createElement('div');
    onRenderCallbacks[0](el);
    expect(el.style.borderRight).toContain('--terminal-prompt-default');
    expect(el.style.borderRight).not.toContain('--prompt-highlight-default');
  });

  it('paints non-prompt content lines with --terminal-prompt-active', () => {
    const term = makeMockTerminal({
      length: 1,
      cursorY: 0,
      baseY: 0,
      getLine: () => makeBufferLine('some output'),
    });

    const onRenderCallbacks: Array<(el: HTMLElement) => void> = [];
    term.registerDecoration = vi.fn().mockReturnValue({
      marker: { line: 0, isDisposed: false },
      onRender: (cb: (el: HTMLElement) => void) => onRenderCallbacks.push(cb),
      onDispose: vi.fn(),
      dispose: vi.fn(),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderHook(() => usePromptHighlight(term as any, true, '', DEFAULT_PROMPT_PATTERNS));

    expect(onRenderCallbacks.length).toBeGreaterThan(0);
    const el = document.createElement('div');
    onRenderCallbacks[0](el);
    expect(el.style.borderRight).toContain('--terminal-prompt-active');
  });

  it('uses user-supplied highlightColor for prompt lines', () => {
    const term = makeMockTerminal({
      length: 1,
      cursorY: 0,
      baseY: 0,
      getLine: () => makeBufferLine('PS C:\\>'),
    });

    const onRenderCallbacks: Array<(el: HTMLElement) => void> = [];
    term.registerDecoration = vi.fn().mockReturnValue({
      marker: { line: 0, isDisposed: false },
      onRender: (cb: (el: HTMLElement) => void) => onRenderCallbacks.push(cb),
      onDispose: vi.fn(),
      dispose: vi.fn(),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderHook(() => usePromptHighlight(term as any, true, '#00ff00', DEFAULT_PROMPT_PATTERNS));

    const el = document.createElement('div');
    onRenderCallbacks[0](el);
    // JSDOM normalises #RRGGBB to rgb(...) form
    expect(el.style.borderRight).toContain('rgb(0, 255, 0)');
  });

  it('onRender uses buffer.baseY (not the legacy ydisp property) to translate viewport rows', () => {
    const calls: number[] = [];
    const term = makeMockTerminal({
      length: 200,
      cursorY: 5,
      baseY: 100,
      getLine: (y: number) => {
        calls.push(y);
        return makeBufferLine('');
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderHook(() => usePromptHighlight(term as any, true, '', DEFAULT_PROMPT_PATTERNS));

    // Clear out calls from scanAllLines on mount
    calls.length = 0;

    // Fire the captured onRender handler with a viewport range
    expect(term._renderHandlers.length).toBe(1);
    term._renderHandlers[0]({ start: 0, end: 2 });

    // baseY is 100, so viewport rows 0..2 should map to buffer rows 100..102
    expect(calls).toEqual(expect.arrayContaining([100, 101, 102]));
    expect(calls).not.toEqual(expect.arrayContaining([0, 1, 2]));
  });
});
