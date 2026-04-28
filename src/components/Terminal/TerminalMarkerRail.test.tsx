import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import type { Terminal } from '@xterm/xterm';
import { TerminalMarkerRail } from './TerminalMarkerRail';
import type { DetectedMarker } from '../../hooks/usePromptDetection';

function makeDisposable() {
  return { dispose: vi.fn() };
}

function makeTerm(overrides?: {
  viewportY?: number;
  length?: number;
  getLine?: (y: number) => unknown;
  cellHeight?: number;
}) {
  const onScrollHandlers: Array<() => void> = [];
  const onRenderHandlers: Array<() => void> = [];
  const cellHeight = overrides?.cellHeight ?? 20;

  const term = {
    buffer: {
      active: {
        viewportY: overrides?.viewportY ?? 0,
        length: overrides?.length ?? 100,
        getLine: vi.fn(overrides?.getLine ?? (() => null)),
      },
    },
    selectLines: vi.fn(),
    onScroll: vi.fn((h: () => void) => {
      onScrollHandlers.push(h);
      return makeDisposable();
    }),
    onRender: vi.fn((h: () => void) => {
      onRenderHandlers.push(h);
      return makeDisposable();
    }),
    _core: {
      _renderService: { dimensions: { css: { cell: { height: cellHeight } } } },
    },
    _onScrollHandlers: onScrollHandlers,
    _onRenderHandlers: onRenderHandlers,
  };
  return term as unknown as Terminal & {
    _onScrollHandlers: Array<() => void>;
    _onRenderHandlers: Array<() => void>;
    selectLines: ReturnType<typeof vi.fn>;
    buffer: { active: { viewportY: number; length: number; getLine: ReturnType<typeof vi.fn> } };
    onScroll: ReturnType<typeof vi.fn>;
    onRender: ReturnType<typeof vi.fn>;
  };
}

describe('TerminalMarkerRail', () => {
  it('renders an empty rail when there are no markers', () => {
    const term = makeTerm();
    const { container } = render(
      <TerminalMarkerRail term={term} markers={[]} highlightColor="" />
    );
    const rail = container.querySelector('.terminal-marker-rail');
    expect(rail).toBeTruthy();
    expect(rail?.querySelectorAll('.terminal-marker').length).toBe(0);
  });

  it('renders one marker per detected marker with the correct class and inline position', () => {
    const term = makeTerm({ viewportY: 0, cellHeight: 20 });
    const markers: DetectedMarker[] = [
      { line: 5, isPrompt: true, lineCount: 1 },
      { line: 10, isPrompt: false, lineCount: 2 },
    ];
    const { container } = render(
      <TerminalMarkerRail term={term} markers={markers} highlightColor="#ff00ff" />
    );
    const els = container.querySelectorAll('.terminal-marker') as NodeListOf<HTMLElement>;
    expect(els.length).toBe(2);

    expect(els[0].classList.contains('prompt')).toBe(true);
    expect(els[0].style.top).toBe('100px'); // (5 - 0) * 20
    expect(els[0].style.height).toBe('20px'); // 1 * 20
    expect(els[0].style.backgroundColor).toBe('rgb(255, 0, 255)');

    expect(els[1].classList.contains('output')).toBe(true);
    expect(els[1].style.top).toBe('200px'); // (10 - 0) * 20
    expect(els[1].style.height).toBe('40px'); // 2 * 20
  });

  it('falls back to the default prompt color when highlightColor is empty', () => {
    const term = makeTerm();
    const markers: DetectedMarker[] = [{ line: 0, isPrompt: true, lineCount: 1 }];
    const { container } = render(
      <TerminalMarkerRail term={term} markers={markers} highlightColor="" />
    );
    const el = container.querySelector('.terminal-marker') as HTMLElement;
    // jsdom returns the var() expression as-is when not resolved
    expect(el.style.backgroundColor).toContain('var(--terminal-prompt-default');
  });

  it('reads cell height from the live xterm renderer when present', () => {
    const term = makeTerm({ cellHeight: 30 });
    const markers: DetectedMarker[] = [{ line: 1, isPrompt: true, lineCount: 1 }];
    const { container } = render(
      <TerminalMarkerRail term={term} markers={markers} highlightColor="#fff" />
    );
    const el = container.querySelector('.terminal-marker') as HTMLElement;
    expect(el.style.top).toBe('30px'); // (1 - 0) * 30
  });

  it('subscribes to term.onScroll and term.onRender, and disposes on unmount', () => {
    const term = makeTerm();
    const onScrollDispose = vi.fn();
    const onRenderDispose = vi.fn();
    term.onScroll = vi.fn(() => ({ dispose: onScrollDispose })) as unknown as typeof term.onScroll;
    term.onRender = vi.fn(() => ({ dispose: onRenderDispose })) as unknown as typeof term.onRender;

    const { unmount } = render(<TerminalMarkerRail term={term} markers={[]} highlightColor="" />);
    expect(term.onScroll).toHaveBeenCalledTimes(1);
    expect(term.onRender).toHaveBeenCalledTimes(1);

    unmount();
    expect(onScrollDispose).toHaveBeenCalledTimes(1);
    expect(onRenderDispose).toHaveBeenCalledTimes(1);
  });

  it('clicking a prompt marker selects the contiguous run of prompt markers', () => {
    const term = makeTerm({ length: 100 });
    const markers: DetectedMarker[] = [
      { line: 1, isPrompt: true, lineCount: 1 },
      { line: 2, isPrompt: true, lineCount: 1 },
      { line: 5, isPrompt: false, lineCount: 1 },
      { line: 8, isPrompt: true, lineCount: 1 },
    ];
    const { container } = render(
      <TerminalMarkerRail term={term} markers={markers} highlightColor="#fff" />
    );
    const els = container.querySelectorAll('.terminal-marker');
    // Click the first prompt marker — should select lines 1..2 (the contiguous
    // block bounded above by buffer start and below by the non-prompt at line 5).
    fireEvent.click(els[0]);
    expect(term.selectLines).toHaveBeenCalled();
    const [start, end] = term.selectLines.mock.calls[0];
    expect(start).toBe(1);
    expect(end).toBe(2);
  });

  it('clicking an output marker selects the contiguous run of output markers', () => {
    const term = makeTerm({ length: 100 });
    const markers: DetectedMarker[] = [
      { line: 1, isPrompt: true, lineCount: 1 },
      { line: 3, isPrompt: false, lineCount: 1 },
      { line: 4, isPrompt: false, lineCount: 1 },
      { line: 7, isPrompt: true, lineCount: 1 },
    ];
    const { container } = render(
      <TerminalMarkerRail term={term} markers={markers} highlightColor="#fff" />
    );
    const els = container.querySelectorAll('.terminal-marker');
    fireEvent.click(els[1]); // line 3 (output)
    const [start, end] = term.selectLines.mock.calls[0];
    expect(start).toBe(3);
    expect(end).toBe(4);
  });

  it('expands selection through trailing wrapped rows', () => {
    const wrapped = new Set([6, 7]);
    const term = makeTerm({
      length: 20,
      getLine: (y: number) => (wrapped.has(y) ? { isWrapped: true } : { isWrapped: false }),
    });
    const markers: DetectedMarker[] = [{ line: 5, isPrompt: true, lineCount: 1 }];
    const { container } = render(
      <TerminalMarkerRail term={term} markers={markers} highlightColor="#fff" />
    );
    fireEvent.click(container.querySelector('.terminal-marker') as HTMLElement);
    const [start, end] = term.selectLines.mock.calls[0];
    expect(start).toBe(5);
    expect(end).toBe(7); // expanded through wrapped rows 6 and 7
  });

  it('updates marker positions when xterm fires onScroll', () => {
    const term = makeTerm({ viewportY: 0, cellHeight: 20 });
    const markers: DetectedMarker[] = [{ line: 10, isPrompt: true, lineCount: 1 }];
    const { container } = render(
      <TerminalMarkerRail term={term} markers={markers} highlightColor="#fff" />
    );
    let el = container.querySelector('.terminal-marker') as HTMLElement;
    expect(el.style.top).toBe('200px');

    // Simulate xterm scrolling: viewportY moves to 5 then onScroll fires.
    term.buffer.active.viewportY = 5;
    act(() => {
      term._onScrollHandlers.forEach((h) => h());
    });
    el = container.querySelector('.terminal-marker') as HTMLElement;
    expect(el.style.top).toBe('100px'); // (10 - 5) * 20
  });
});
