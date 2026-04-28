import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

const resize = vi.fn().mockResolvedValue(undefined);
vi.mock('../../services/tauriService', () => ({
  tauriService: {
    resize: (id: string, cols: number, rows: number) => resize(id, cols, rows),
  },
}));

// jsdom has no ResizeObserver.
class MockResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver = MockResizeObserver;

import { TerminalView } from './Terminal';
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
