import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

const resize = vi.fn().mockResolvedValue(undefined);
vi.mock('../../services/tauriService', () => ({
  tauriService: {
    resize: (id: string, cols: number, rows: number) => resize(id, cols, rows),
    // The host attempts a WebGL renderer upgrade on mount; in jsdom that fails
    // and reports the fallback through logDebug.
    logDebug: () => Promise.resolve(),
  },
}));

// The host upgrades every terminal to the WebGL renderer on mount. jsdom has no
// WebGL2 context, so letting that run would only pull in the real addon and log
// canvas warnings on its way to the DOM-renderer fallback — which is covered
// directly in xtermRenderer.test.ts.
vi.mock('../../utils/xtermRenderer', () => ({ enableWebglRenderer: () => {} }));

// jsdom has no ResizeObserver.
class MockResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver = MockResizeObserver;

import { TerminalView } from './Terminal';
import {
  isCellInSelection,
  isRightClickOverSelection,
  type SelectionRange,
} from './selectionGeometry';
import type { Terminal } from '@xterm/xterm';
import type { SessionRecord } from '../../hooks/useSessionManager';
import { useSettingsStore } from '../../stores/settingsStore';

function makeSession(): {
  session: SessionRecord;
  term: ReturnType<typeof makeTerm>;
  fitAddon: { fit: ReturnType<typeof vi.fn>; proposeDimensions: ReturnType<typeof vi.fn> };
} {
  const term = makeTerm();
  const fitAddon = {
    fit: vi.fn(),
    proposeDimensions: vi.fn().mockReturnValue({ cols: 80, rows: 24 }),
  };
  return {
    term,
    fitAddon,
    session: {
      id: 's1',
      displayName: 'S1',
      protocol: 'ssh',
      status: 'connected',
      errorMessage: undefined,
      term: term as unknown as SessionRecord['term'],
      fitAddon: fitAddon as unknown as SessionRecord['fitAddon'],
      fixedSize: false,
    },
  };
}

function makeDisposable() {
  return { dispose: vi.fn() };
}

function makeTerm() {
  return {
    options: { theme: {} },
    element: undefined as HTMLElement | undefined,
    cols: 80,
    rows: 24,
    open: vi.fn(function (this: { element?: HTMLElement }, el: HTMLElement) {
      this.element = el;
    }),
    write: vi.fn(),
    focus: vi.fn(),
    resize: vi.fn(function (
      this: { cols: number; rows: number },
      cols: number,
      rows: number
    ) {
      this.cols = cols;
      this.rows = rows;
    }),
    getSelection: vi.fn(() => ''),
    getSelectionPosition: vi.fn(() => undefined as
      | { start: { x: number; y: number }; end: { x: number; y: number } }
      | undefined),
    scrollToLine: vi.fn(),
    selectLines: vi.fn(),
    buffer: {
      active: {
        baseY: 0,
        cursorY: 0,
        viewportY: 0,
        length: 0,
        getLine: vi.fn().mockReturnValue(null),
      },
    },
    onCursorMove: vi.fn(() => makeDisposable()),
    onLineFeed: vi.fn(() => makeDisposable()),
    onRender: vi.fn(() => makeDisposable()),
    onScroll: vi.fn(() => makeDisposable()),
  };
}

describe('TerminalView (3-rail layout)', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
    resize.mockClear();
  });

  it('renders the three rails: xterm host, marker rail, scrollbar rail', () => {
    const { session } = makeSession();
    const { container } = render(<TerminalView session={session} active={true} />);
    expect(container.querySelector('.terminal-view')).toBeTruthy();
    expect(container.querySelector('.terminal-xterm-host')).toBeTruthy();
    expect(container.querySelector('.terminal-marker-rail')).toBeTruthy();
    expect(container.querySelector('.terminal-scrollbar-rail')).toBeTruthy();
  });

  it('opens the xterm instance into the host and requests a backend resize', () => {
    const { session, term } = makeSession();
    render(<TerminalView session={session} active={true} />);
    expect(term.open).toHaveBeenCalled();
    expect(resize).toHaveBeenCalledWith('s1', 80, 24);
  });

  it('applies the active background when active and inactive background otherwise', () => {
    useSettingsStore.getState().update('terminalForeground', '#abcdef');
    useSettingsStore.getState().update('terminalBackground', '#111111');
    useSettingsStore.getState().update('terminalBackgroundInactive', '#222222');

    const { session: active, term: activeTerm } = makeSession();
    const { rerender } = render(<TerminalView session={active} active={true} />);
    expect(activeTerm.options.theme).toMatchObject({
      foreground: '#abcdef',
      background: '#111111',
    });

    const { session: inactive, term: inactiveTerm } = makeSession();
    rerender(<TerminalView session={inactive} active={false} />);
    expect(inactiveTerm.options.theme).toMatchObject({
      foreground: '#abcdef',
      background: '#222222',
    });
  });

  it('focuses the terminal when active', () => {
    const { session, term } = makeSession();
    render(<TerminalView session={session} active={true} />);
    expect(term.focus).toHaveBeenCalled();
  });

  it('right-click triggers onPasteRequest when rightClickPaste is enabled', () => {
    useSettingsStore.getState().update('rightClickPaste', true);
    const onPasteRequest = vi.fn();
    const { session } = makeSession();
    const { container } = render(
      <TerminalView session={session} active onPasteRequest={onPasteRequest} />
    );
    fireEvent.contextMenu(container.querySelector('.terminal-view') as HTMLElement);
    expect(onPasteRequest).toHaveBeenCalledWith('s1');
  });

  it('right-click is a no-op when rightClickPaste is disabled', () => {
    useSettingsStore.getState().update('rightClickPaste', false);
    const onPasteRequest = vi.fn();
    const { session } = makeSession();
    const { container } = render(
      <TerminalView session={session} active onPasteRequest={onPasteRequest} />
    );
    fireEvent.contextMenu(container.querySelector('.terminal-view') as HTMLElement);
    expect(onPasteRequest).not.toHaveBeenCalled();
  });

  it('right-click over a selection opens the inline Ask AI input instead of pasting', () => {
    useSettingsStore.getState().update('rightClickPaste', true);
    const onPasteRequest = vi.fn();
    const onAskAiSubmit = vi.fn();
    const { session, term } = makeSession();
    term.getSelection.mockReturnValue('selected text');
    // Non-null range → with no resolvable cell geometry the helper falls back to
    // "over selection", so the input opens.
    term.getSelectionPosition.mockReturnValue({ start: { x: 0, y: 0 }, end: { x: 5, y: 0 } });

    const { container } = render(
      <TerminalView
        session={session}
        active
        onPasteRequest={onPasteRequest}
        onAskAiSubmit={onAskAiSubmit}
      />
    );
    fireEvent.contextMenu(container.querySelector('.terminal-view') as HTMLElement, {
      clientX: 20,
      clientY: 20,
    });

    const menu = container.querySelector('.terminal-context-menu');
    expect(menu).toBeTruthy();
    expect(onPasteRequest).not.toHaveBeenCalled();

    const input = container.querySelector('.terminal-context-menu-input') as HTMLTextAreaElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: 'what is this?' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAskAiSubmit).toHaveBeenCalledWith('s1', 'selected text', 'what is this?');
  });

  it('right-click with a selection but no Ask AI handler falls back to paste', () => {
    useSettingsStore.getState().update('rightClickPaste', true);
    const onPasteRequest = vi.fn();
    const { session, term } = makeSession();
    term.getSelection.mockReturnValue('selected text');
    term.getSelectionPosition.mockReturnValue({ start: { x: 0, y: 0 }, end: { x: 5, y: 0 } });

    const { container } = render(
      <TerminalView
        session={session}
        active
        onPasteRequest={onPasteRequest}
      />
    );
    fireEvent.contextMenu(container.querySelector('.terminal-view') as HTMLElement);

    expect(container.querySelector('.terminal-context-menu')).toBeNull();
    expect(onPasteRequest).toHaveBeenCalledWith('s1');
  });

  it('right-click with no selection pastes even when Ask AI is wired', () => {
    useSettingsStore.getState().update('rightClickPaste', true);
    const onPasteRequest = vi.fn();
    const onAskAiSubmit = vi.fn();
    const { session } = makeSession(); // getSelection() returns '' by default
    const { container } = render(
      <TerminalView
        session={session}
        active
        onPasteRequest={onPasteRequest}
        onAskAiSubmit={onAskAiSubmit}
      />
    );
    fireEvent.contextMenu(container.querySelector('.terminal-view') as HTMLElement);
    expect(onAskAiSubmit).not.toHaveBeenCalled();
    expect(onPasteRequest).toHaveBeenCalledWith('s1');
  });

  it('uses fitAddon.fit and adds no .wrap-off class when line wrap is enabled', () => {
    useSettingsStore.getState().update('lineWrapEnabled', true);
    const { session, fitAddon, term } = makeSession();
    const { container } = render(<TerminalView session={session} active={true} />);
    const host = container.querySelector('.terminal-xterm-host') as HTMLElement;
    expect(host.classList.contains('wrap-off')).toBe(false);
    expect(fitAddon.fit).toHaveBeenCalled();
    expect(term.resize).not.toHaveBeenCalled();
  });

  it('adds .wrap-off class and resizes to wide cols when line wrap is disabled', () => {
    useSettingsStore.getState().update('lineWrapEnabled', false);
    const { session, fitAddon, term } = makeSession();
    const { container } = render(<TerminalView session={session} active={true} />);
    const host = container.querySelector('.terminal-xterm-host') as HTMLElement;
    expect(host.classList.contains('wrap-off')).toBe(true);
    expect(term.resize).toHaveBeenCalledWith(5000, 24);
    expect(fitAddon.fit).not.toHaveBeenCalled();
    expect(fitAddon.proposeDimensions).toHaveBeenCalled();
    expect(resize).toHaveBeenCalledWith('s1', 5000, 24);
  });

  it('honours an already-wide proposed cols when wrap is off', () => {
    useSettingsStore.getState().update('lineWrapEnabled', false);
    const { session, fitAddon, term } = makeSession();
    fitAddon.proposeDimensions.mockReturnValue({ cols: 7000, rows: 30 });
    render(<TerminalView session={session} active={true} />);
    expect(term.resize).toHaveBeenCalledWith(7000, 30);
  });

  it('subscribes to onLineFeed when wrap is OFF for scroll reset on Enter', () => {
    useSettingsStore.getState().update('lineWrapEnabled', false);
    const { session, term } = makeSession();
    render(<TerminalView session={session} active={true} />);
    // usePromptDetection subscribes once and TerminalXtermHost adds a
    // scroll-reset subscription when wrap is OFF, so we expect 2 total.
    expect(term.onLineFeed).toHaveBeenCalledTimes(2);
  });
});

describe('isCellInSelection', () => {
  // Selection covering rows 5..7: starts at col 2 on row 5, ends at col 10
  // (exclusive) on row 7.
  const pos: SelectionRange = { start: { x: 2, y: 5 }, end: { x: 10, y: 7 } };

  it('is true for a cell on a middle row regardless of column', () => {
    expect(isCellInSelection(0, 6, pos)).toBe(true);
    expect(isCellInSelection(50, 6, pos)).toBe(true);
  });

  it('is false above the first row and below the last row', () => {
    expect(isCellInSelection(5, 4, pos)).toBe(false);
    expect(isCellInSelection(5, 8, pos)).toBe(false);
  });

  it('respects the start column on the first row', () => {
    expect(isCellInSelection(1, 5, pos)).toBe(false); // before start.x
    expect(isCellInSelection(2, 5, pos)).toBe(true); // at start.x (inclusive)
  });

  it('respects the exclusive end column on the last row', () => {
    expect(isCellInSelection(9, 7, pos)).toBe(true); // before end.x
    expect(isCellInSelection(10, 7, pos)).toBe(false); // at end.x (exclusive)
  });

  it('handles a single-row selection', () => {
    const single: SelectionRange = { start: { x: 3, y: 2 }, end: { x: 8, y: 2 } };
    expect(isCellInSelection(2, 2, single)).toBe(false);
    expect(isCellInSelection(3, 2, single)).toBe(true);
    expect(isCellInSelection(7, 2, single)).toBe(true);
    expect(isCellInSelection(8, 2, single)).toBe(false);
  });
});

describe('isRightClickOverSelection', () => {
  function makeGeometryTerm(opts: {
    pos: SelectionRange | undefined;
    cell?: { width: number; height: number };
    viewportY?: number;
    withScreen?: boolean;
  }): Terminal {
    const element = document.createElement('div');
    if (opts.withScreen !== false) {
      const screen = document.createElement('div');
      screen.className = 'xterm-screen';
      screen.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} }) as DOMRect;
      element.appendChild(screen);
    }
    return {
      element,
      getSelectionPosition: () => opts.pos,
      buffer: { active: { viewportY: opts.viewportY ?? 0 } },
      _core: opts.cell
        ? { _renderService: { dimensions: { css: { cell: opts.cell } } } }
        : undefined,
    } as unknown as Terminal;
  }

  const pos: SelectionRange = { start: { x: 2, y: 5 }, end: { x: 10, y: 7 } };

  it('returns false when there is no selection position', () => {
    const term = makeGeometryTerm({ pos: undefined, cell: { width: 9, height: 18 } });
    expect(isRightClickOverSelection(50, 50, term)).toBe(false);
  });

  it('falls back to true when cell geometry is unavailable', () => {
    const term = makeGeometryTerm({ pos }); // no cell dims
    expect(isRightClickOverSelection(50, 50, term)).toBe(true);
  });

  it('returns true for a click over the selection', () => {
    const term = makeGeometryTerm({ pos, cell: { width: 9, height: 18 } });
    // row 6 (y=18*6=108) is a middle row → inside regardless of column.
    expect(isRightClickOverSelection(40, 108, term)).toBe(true);
  });

  it('returns false for a click above the selection rows', () => {
    const term = makeGeometryTerm({ pos, cell: { width: 9, height: 18 } });
    // row 4 (y=18*4=72) is above start.y (5) → outside.
    expect(isRightClickOverSelection(40, 72, term)).toBe(false);
  });

  it('accounts for the scrolled viewport offset', () => {
    const term = makeGeometryTerm({ pos, cell: { width: 9, height: 18 }, viewportY: 3 });
    // viewRow 2 (y=36) + viewportY 3 = absRow 5 = start.y → inside (col >= start.x).
    expect(isRightClickOverSelection(9 * 2, 36, term)).toBe(true);
    // col 1 (< start.x 2) on the start row → outside.
    expect(isRightClickOverSelection(9 * 1, 36, term)).toBe(false);
  });
});
