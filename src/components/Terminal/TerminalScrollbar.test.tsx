import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import type { Terminal } from '@xterm/xterm';
import { TerminalScrollbar } from './TerminalScrollbar';

function makeDisposable() {
  return { dispose: vi.fn() };
}

function makeTerm(overrides?: {
  viewportY?: number;
  length?: number;
  cellHeight?: number;
}) {
  const onScrollHandlers: Array<() => void> = [];
  const onRenderHandlers: Array<() => void> = [];

  const term = {
    buffer: {
      active: {
        viewportY: overrides?.viewportY ?? 0,
        length: overrides?.length ?? 100,
      },
    },
    scrollToLine: vi.fn(),
    onScroll: vi.fn((h: () => void) => {
      onScrollHandlers.push(h);
      return makeDisposable();
    }),
    onRender: vi.fn((h: () => void) => {
      onRenderHandlers.push(h);
      return makeDisposable();
    }),
    _core: {
      _renderService: {
        dimensions: { css: { cell: { height: overrides?.cellHeight ?? 20 } } },
      },
    },
    _onScrollHandlers: onScrollHandlers,
    _onRenderHandlers: onRenderHandlers,
  };
  return term as unknown as Terminal & {
    _onScrollHandlers: Array<() => void>;
    _onRenderHandlers: Array<() => void>;
    scrollToLine: ReturnType<typeof vi.fn>;
    buffer: { active: { viewportY: number; length: number } };
    onScroll: ReturnType<typeof vi.fn>;
    onRender: ReturnType<typeof vi.fn>;
  };
}

describe('TerminalScrollbar', () => {
  beforeEach(() => {
    // jsdom polyfill (in case animation-frame timing matters)
    if (!('requestAnimationFrame' in globalThis)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
        return setTimeout(() => cb(performance.now()), 0) as unknown as number;
      };
    }
  });

  it('renders the scrollbar rail with an inner spacer', () => {
    const term = makeTerm({ length: 100, cellHeight: 20 });
    const { container } = render(<TerminalScrollbar term={term} />);
    const rail = container.querySelector('.terminal-scrollbar-rail') as HTMLElement;
    expect(rail).toBeTruthy();
    const spacer = rail.querySelector('.terminal-scrollbar-spacer') as HTMLElement;
    expect(spacer).toBeTruthy();
    // 100 lines * 20px = 2000
    expect(spacer.style.height).toBe('2000px');
  });

  it('subscribes to onScroll and onRender and disposes on unmount', () => {
    const term = makeTerm();
    const onScrollDispose = vi.fn();
    const onRenderDispose = vi.fn();
    term.onScroll = vi.fn(() => ({ dispose: onScrollDispose })) as unknown as typeof term.onScroll;
    term.onRender = vi.fn(() => ({ dispose: onRenderDispose })) as unknown as typeof term.onRender;

    const { unmount } = render(<TerminalScrollbar term={term} />);
    expect(term.onScroll).toHaveBeenCalledTimes(1);
    expect(term.onRender).toHaveBeenCalledTimes(1);
    unmount();
    expect(onScrollDispose).toHaveBeenCalledTimes(1);
    expect(onRenderDispose).toHaveBeenCalledTimes(1);
  });

  it('updates the spacer height when xterm reports a longer buffer', () => {
    const term = makeTerm({ length: 100, cellHeight: 20 });
    const { container } = render(<TerminalScrollbar term={term} />);
    const spacer = container.querySelector('.terminal-scrollbar-spacer') as HTMLElement;
    expect(spacer.style.height).toBe('2000px');

    // Buffer grows; xterm fires onRender.
    term.buffer.active.length = 250;
    act(() => {
      term._onRenderHandlers.forEach((h) => h());
    });
    expect(spacer.style.height).toBe('5000px');
  });

  it('calls term.scrollToLine when the user scrolls the rail', () => {
    const term = makeTerm({ length: 100, cellHeight: 20 });
    const { container } = render(<TerminalScrollbar term={term} />);
    const rail = container.querySelector('.terminal-scrollbar-rail') as HTMLElement;

    // Mock scrollTop on the rail (jsdom doesn't drive layout for us).
    Object.defineProperty(rail, 'scrollTop', { value: 200, writable: true, configurable: true });
    fireEvent.scroll(rail);

    // 200 / 20 = 10
    expect(term.scrollToLine).toHaveBeenCalledWith(10);
  });

  it('ignores scroll events fired during programmatic sync', () => {
    const term = makeTerm({ length: 100, cellHeight: 20, viewportY: 0 });
    const { container } = render(<TerminalScrollbar term={term} />);
    const rail = container.querySelector('.terminal-scrollbar-rail') as HTMLElement;

    // Move xterm viewport to line 25; onScroll fires. The component sets
    // `isSyncingRef = true` and writes scrollTop. Any scroll event delivered
    // synchronously while syncing must NOT call back into term.scrollToLine.
    term.buffer.active.viewportY = 25;
    act(() => {
      term._onScrollHandlers.forEach((h) => h());
      // Simulate the rail's scroll event firing as a result of the programmatic
      // scrollTop write — this is what the component is guarding against.
      Object.defineProperty(rail, 'scrollTop', {
        value: 25 * 20,
        writable: true,
        configurable: true,
      });
      fireEvent.scroll(rail);
    });
    expect(term.scrollToLine).not.toHaveBeenCalled();
  });
});
