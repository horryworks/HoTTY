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

  // `update` runs on every rendered frame, and during bulk output it syncs
  // scrollTop on nearly all of them. Queueing a fresh callback per sync made
  // requestAnimationFrame the single most expensive entry in a profile.
  it('schedules at most one animation frame while a sync is still pending', () => {
    const term = makeTerm({ length: 10000, cellHeight: 20, viewportY: 0 });
    const rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation(() => 1 as unknown as number);
    const { container } = render(<TerminalScrollbar term={term} />);
    const rail = container.querySelector('.terminal-scrollbar-rail') as HTMLElement;
    Object.defineProperty(rail, 'scrollTop', { value: 0, writable: true, configurable: true });

    rafSpy.mockClear();
    act(() => {
      // Ten frames of output before the browser gets to run the callback.
      for (let y = 1; y <= 10; y++) {
        term.buffer.active.viewportY = y;
        term._onRenderHandlers.forEach((h) => h());
      }
    });
    expect(rafSpy).toHaveBeenCalledTimes(1);
    rafSpy.mockRestore();
  });

  // xterm rewrites its rows immediately before firing onRender, so the box tree
  // is dirty when `update` runs. Touching the scrollTop getter there forced a
  // synchronous layout on every frame; the component keeps a mirror instead.
  it('does not read rail.scrollTop on every rendered frame', () => {
    const term = makeTerm({ length: 10000, cellHeight: 20, viewportY: 0 });
    const { container } = render(<TerminalScrollbar term={term} />);
    const rail = container.querySelector('.terminal-scrollbar-rail') as HTMLElement;

    // Installed after render so the effect's one-off seed read is not counted.
    let top = 0;
    const getSpy = vi.fn(() => top);
    Object.defineProperty(rail, 'scrollTop', {
      get: getSpy,
      set: (v: number) => {
        top = v;
      },
      configurable: true,
    });

    act(() => {
      for (let y = 1; y <= 20; y++) {
        term.buffer.active.viewportY = y;
        term._onRenderHandlers.forEach((h) => h());
      }
    });

    expect(getSpy).not.toHaveBeenCalled();
    // The writes still happened — the mirror is not hiding a broken sync.
    expect(top).toBe(400);
  });

  it('recovers when the browser clamps a programmatic scrollTop write', () => {
    const term = makeTerm({ length: 100, cellHeight: 20, viewportY: 0 });
    const { container } = render(<TerminalScrollbar term={term} />);
    const rail = container.querySelector('.terminal-scrollbar-rail') as HTMLElement;
    Object.defineProperty(rail, 'scrollTop', { value: 0, writable: true, configurable: true });

    term.buffer.active.viewportY = 25;
    act(() => {
      term._onRenderHandlers.forEach((h) => h());
    });
    expect(rail.scrollTop).toBe(500);

    // The browser clamps the write and reports the real value via a scroll
    // event. Without refreshing the mirror there, the component would believe it
    // was already at 500 and leave the rail stranded.
    rail.scrollTop = 300;
    fireEvent.scroll(rail);

    act(() => {
      term._onRenderHandlers.forEach((h) => h());
    });
    expect(rail.scrollTop).toBe(500);
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
