import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

const resize = vi.fn().mockResolvedValue(undefined);
vi.mock('../../services/tauriService', () => ({
  tauriService: {
    resize: (id: string, cols: number, rows: number) => resize(id, cols, rows),
  },
}));

class MockResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver = MockResizeObserver;

import { TerminalXtermHost } from './TerminalXtermHost';
import type { SessionRecord } from '../../hooks/useSessionManager';
import { useSettingsStore } from '../../stores/settingsStore';
import { TERMINAL_SEQUENCES } from '../../constants/terminalSequences';

function makeDisposable() {
  return { dispose: vi.fn() };
}

function makeTerm() {
  return {
    options: { theme: {} as Record<string, string> },
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
    buffer: {
      active: { cursorX: 0, cursorY: 0, baseY: 0, viewportY: 0, length: 0 },
    },
    onCursorMove: vi.fn(() => makeDisposable()),
    onLineFeed: vi.fn(() => makeDisposable()),
  };
}

function makeSession() {
  const term = makeTerm();
  const fitAddon = {
    fit: vi.fn(),
    proposeDimensions: vi.fn().mockReturnValue({ cols: 80, rows: 24 }),
  };
  const session: SessionRecord = {
    id: 's1',
    displayName: 'S1',
    protocol: 'ssh',
    status: 'connected',
    errorMessage: undefined,
    term: term as unknown as SessionRecord['term'],
    fitAddon: fitAddon as unknown as SessionRecord['fitAddon'],
  };
  return { session, term, fitAddon };
}

describe('TerminalXtermHost', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
    resize.mockClear();
  });

  it('renders the .terminal-xterm-host container', () => {
    const { session } = makeSession();
    const { container } = render(<TerminalXtermHost session={session} active={true} />);
    expect(container.querySelector('.terminal-xterm-host')).toBeTruthy();
  });

  it('opens the xterm into the host element on first mount', () => {
    const { session, term } = makeSession();
    render(<TerminalXtermHost session={session} active={true} />);
    expect(term.open).toHaveBeenCalledTimes(1);
  });

  it('re-attaches an existing xterm element on remount instead of calling open()', () => {
    const { session, term } = makeSession();
    // Pretend xterm has already been opened in a previous mount and owns a DOM node.
    term.element = document.createElement('div');
    render(<TerminalXtermHost session={session} active={true} />);
    expect(term.open).not.toHaveBeenCalled();
  });

  it('writes the line-wrap-enabled DECAWM sequence when wrap is on', () => {
    useSettingsStore.getState().update('lineWrapEnabled', true);
    const { session, term } = makeSession();
    render(<TerminalXtermHost session={session} active={true} />);
    expect(term.write).toHaveBeenCalledWith(TERMINAL_SEQUENCES.LINE_WRAP_ENABLED);
  });

  it('writes the line-wrap-disabled DECAWM sequence when wrap is off', () => {
    useSettingsStore.getState().update('lineWrapEnabled', false);
    const { session, term } = makeSession();
    render(<TerminalXtermHost session={session} active={true} />);
    expect(term.write).toHaveBeenCalledWith(TERMINAL_SEQUENCES.LINE_WRAP_DISABLED);
  });

  it('adds the .wrap-off class only when wrap is disabled', () => {
    useSettingsStore.getState().update('lineWrapEnabled', false);
    const { session: a } = makeSession();
    const { container: c1, unmount } = render(
      <TerminalXtermHost session={a} active={true} />
    );
    expect(c1.querySelector('.terminal-xterm-host')?.classList.contains('wrap-off')).toBe(true);
    unmount();

    useSettingsStore.getState().update('lineWrapEnabled', true);
    const { session: b } = makeSession();
    const { container: c2 } = render(<TerminalXtermHost session={b} active={true} />);
    expect(c2.querySelector('.terminal-xterm-host')?.classList.contains('wrap-off')).toBe(false);
  });

  it('applies foreground/background to the xterm theme', () => {
    useSettingsStore.getState().update('terminalForeground', '#abcdef');
    useSettingsStore.getState().update('terminalBackground', '#111111');
    useSettingsStore.getState().update('terminalBackgroundInactive', '#222222');
    const { session, term } = makeSession();
    render(<TerminalXtermHost session={session} active={true} />);
    expect(term.options.theme).toMatchObject({
      foreground: '#abcdef',
      background: '#111111',
      cursor: '#abcdef',
      cursorAccent: '#111111',
    });
  });

  it('uses the inactive background when not active', () => {
    useSettingsStore.getState().update('terminalForeground', '#abcdef');
    useSettingsStore.getState().update('terminalBackground', '#111111');
    useSettingsStore.getState().update('terminalBackgroundInactive', '#222222');
    const { session, term } = makeSession();
    render(<TerminalXtermHost session={session} active={false} />);
    expect(term.options.theme).toMatchObject({
      foreground: '#abcdef',
      background: '#222222',
    });
  });

  it('focuses the terminal when active and skips focus when inactive', () => {
    const { session: a, term: termA } = makeSession();
    render(<TerminalXtermHost session={a} active={true} />);
    expect(termA.focus).toHaveBeenCalled();

    const { session: b, term: termB } = makeSession();
    render(<TerminalXtermHost session={b} active={false} />);
    expect(termB.focus).not.toHaveBeenCalled();
  });

  it('subscribes to onLineFeed and onCursorMove only when wrap is OFF', () => {
    useSettingsStore.getState().update('lineWrapEnabled', false);
    const { session: off, term: termOff } = makeSession();
    const { unmount } = render(<TerminalXtermHost session={off} active={true} />);
    expect(termOff.onLineFeed).toHaveBeenCalledTimes(1);
    expect(termOff.onCursorMove).toHaveBeenCalledTimes(1);
    unmount();

    useSettingsStore.getState().update('lineWrapEnabled', true);
    const { session: on, term: termOn } = makeSession();
    render(<TerminalXtermHost session={on} active={true} />);
    expect(termOn.onLineFeed).not.toHaveBeenCalled();
    expect(termOn.onCursorMove).not.toHaveBeenCalled();
  });

  it('forwards the post-resize cols/rows to the backend via tauriService', () => {
    useSettingsStore.getState().update('lineWrapEnabled', true);
    const { session } = makeSession();
    render(<TerminalXtermHost session={session} active={true} />);
    expect(resize).toHaveBeenCalledWith('s1', 80, 24);
  });

  it('uses the cols=5000 trick when wrap is OFF', () => {
    useSettingsStore.getState().update('lineWrapEnabled', false);
    const { session, term } = makeSession();
    render(<TerminalXtermHost session={session} active={true} />);
    expect(term.resize).toHaveBeenCalledWith(5000, 24);
    expect(resize).toHaveBeenCalledWith('s1', 5000, 24);
  });
});
