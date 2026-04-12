import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePromptHighlight } from './usePromptHighlight';
import type { PromptPattern } from '../types/appTypes';
import { DEFAULT_PROMPT_PATTERNS } from '../stores/settingsStore';

function makeMockTerminal() {
  const disposables: Array<{ dispose: () => void }> = [];

  return {
    element: document.createElement('div'),
    buffer: {
      active: {
        baseY: 0,
        cursorY: 0,
        length: 0,
        getLine: vi.fn().mockReturnValue(null),
      },
    },
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
    onRender: vi.fn(() => {
      const d = { dispose: vi.fn() };
      disposables.push(d);
      return d;
    }),
    selectLines: vi.fn(),
    _disposables: disposables,
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
});
