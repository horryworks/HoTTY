import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';

const resize = vi.fn().mockResolvedValue(undefined);
vi.mock('../../services/tauriService', () => ({
  tauriService: {
    resize: (id: string, cols: number, rows: number) => resize(id, cols, rows),
    // Diagnostic width-sync trace — no-op in tests, but must exist or the call
    // in performResize would throw and short-circuit the resize() we assert on.
    logDebug: () => Promise.resolve(),
  },
}));

// The host upgrades every terminal to the WebGL renderer on mount. jsdom has no
// WebGL2 context, so letting that run would only pull in the real addon and log
// canvas warnings on its way to the DOM-renderer fallback — which is covered
// directly in xtermRenderer.test.ts.
vi.mock('../../utils/xtermRenderer', () => ({ enableWebglRenderer: () => {} }));

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
    options: {
      theme: {} as Record<string, string>,
    } as {
      theme: Record<string, string>;
      fontSize?: number;
      fontFamily?: string;
      scrollback?: number;
    },
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

function makeSession(overrides?: Partial<SessionRecord>) {
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
    fixedSize: false,
    ...overrides,
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

  it('does not focus a session that is still connecting', () => {
    // The pane is mounted during 'connecting' (so xterm can measure before the
    // pty-req) while the modal connect dialog is on top and owns focus.
    const { session, term } = makeSession({ status: 'connecting' });
    render(<TerminalXtermHost session={session} active={true} />);
    expect(term.focus).not.toHaveBeenCalled();
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

  it('does not report a size to the backend before the renderer has measured', () => {
    // Regression guard for the initial-pty-size fix: the SSH connect path seeds
    // the INITIAL pty-req from the first size the frontend reports, and devices
    // that latch the pty width (e.g. Huawei VRP) ignore later window-change. So
    // until the renderer has real cell metrics — here neither our own compute
    // (no .xterm/cell metrics in jsdom) nor FitAddon can produce dimensions — we
    // must not report xterm's placeholder 80.
    useSettingsStore.getState().update('lineWrapEnabled', true);
    const { session, fitAddon } = makeSession();
    (fitAddon.proposeDimensions as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    render(<TerminalXtermHost session={session} active={true} />);
    expect(resize).not.toHaveBeenCalled();
  });

  it('retries the initial measurement until the renderer can measure', () => {
    // The first pass runs before xterm has painted, so nothing is measurable;
    // the ResizeObserver won't fire again (the pane keeps its size) and the
    // session record doesn't change while connecting — so only the retry can
    // get the size to the backend inside its 2s pty-req window. Without it a
    // width-latching device (Huawei USG/VRP) gets the 80x24 fallback and stays
    // stuck at 80 columns for the whole session.
    vi.useFakeTimers();
    try {
      useSettingsStore.getState().update('lineWrapEnabled', true);
      const { session, term, fitAddon } = makeSession();
      const propose = fitAddon.proposeDimensions as ReturnType<typeof vi.fn>;
      const fit = fitAddon.fit as ReturnType<typeof vi.fn>;
      propose.mockReturnValue(undefined);
      fit.mockImplementation(() => term.resize(120, 40));

      render(<TerminalXtermHost session={session} active={true} />);
      expect(resize).not.toHaveBeenCalled();

      // Let the mount-time rAF and a dozen retries run while still unmeasurable,
      // so the assertion below can only be satisfied by a still-live retry loop.
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(resize).not.toHaveBeenCalled();

      // Renderer paints; cell metrics become available.
      propose.mockReturnValue({ cols: 120, rows: 40 });
      act(() => {
        vi.advanceTimersByTime(32);
      });
      expect(resize).toHaveBeenCalledWith('s1', 120, 40);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops retrying the initial measurement once the host unmounts', () => {
    vi.useFakeTimers();
    try {
      useSettingsStore.getState().update('lineWrapEnabled', true);
      const { session, fitAddon } = makeSession();
      const propose = fitAddon.proposeDimensions as ReturnType<typeof vi.fn>;
      propose.mockReturnValue(undefined);

      const { unmount } = render(<TerminalXtermHost session={session} active={true} />);
      unmount();
      propose.mockReturnValue({ cols: 120, rows: 40 });
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(resize).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the cols=5000 trick when wrap is OFF', () => {
    useSettingsStore.getState().update('lineWrapEnabled', false);
    const { session, term } = makeSession();
    render(<TerminalXtermHost session={session} active={true} />);
    expect(term.resize).toHaveBeenCalledWith(5000, 24);
    expect(resize).toHaveBeenCalledWith('s1', 5000, 24);
  });

  it('pins the grid to ptyCols in fixed-size mode and reports the pinned width', () => {
    // Fixed-size session (device latched 100 cols). The grid must stay at 100
    // regardless of the measured pane width, and the backend is told 100.
    useSettingsStore.getState().update('lineWrapEnabled', true);
    const { session, term } = makeSession({ fixedSize: true, ptyCols: 100 });
    render(<TerminalXtermHost session={session} active={true} />);
    expect(term.resize).toHaveBeenCalledWith(100, 24);
    expect(resize).toHaveBeenCalledWith('s1', 100, 24);
  });

  it('applies the fixed-cols class (not wrap-off) in fixed-size mode even with global wrap OFF', () => {
    useSettingsStore.getState().update('lineWrapEnabled', false);
    const { session } = makeSession({ fixedSize: true, ptyCols: 100 });
    const { container } = render(<TerminalXtermHost session={session} active={true} />);
    const host = container.querySelector('.terminal-xterm-host') as HTMLElement;
    expect(host.classList.contains('fixed-cols')).toBe(true);
    expect(host.classList.contains('wrap-off')).toBe(false);
  });

  it('registers cursor-follow handlers in fixed-size mode even when global wrap is ON', () => {
    useSettingsStore.getState().update('lineWrapEnabled', true);
    const { session, term } = makeSession({ fixedSize: true, ptyCols: 100 });
    render(<TerminalXtermHost session={session} active={true} />);
    expect(term.onLineFeed).toHaveBeenCalledTimes(1);
    expect(term.onCursorMove).toHaveBeenCalledTimes(1);
  });

  it('does not pin until the pty-size (ptyCols) is known, even if fixedSize is set', () => {
    // Before the connect-time event, ptyCols is undefined → dynamic behaviour,
    // which is what feeds the initial pty-req. Here (wrap ON, no cell metrics)
    // it must NOT resize to a pinned width nor add the fixed-cols class.
    useSettingsStore.getState().update('lineWrapEnabled', true);
    const { session, term } = makeSession({ fixedSize: true });
    const { container } = render(<TerminalXtermHost session={session} active={true} />);
    const host = container.querySelector('.terminal-xterm-host') as HTMLElement;
    expect(host.classList.contains('fixed-cols')).toBe(false);
    expect(term.resize).not.toHaveBeenCalled();
  });

  it('preventDefaults paste events on the host element to suppress xterm auto-paste', () => {
    const { session } = makeSession();
    const { container } = render(<TerminalXtermHost session={session} active={true} />);
    const host = container.querySelector('.terminal-xterm-host') as HTMLElement;
    const event = new Event('paste', { cancelable: true, bubbles: true });
    host.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('applies fontSize/fontFamily/scrollback from settings to xterm options on mount', () => {
    useSettingsStore.getState().update('fontSize', 18);
    useSettingsStore.getState().update('fontFamily', 'Cascadia Code');
    useSettingsStore.getState().update('scrollback', 5000);
    const { session, term } = makeSession();
    render(<TerminalXtermHost session={session} active={true} />);
    expect(term.options.fontSize).toBe(18);
    expect(term.options.fontFamily).toBe('Cascadia Code');
    expect(term.options.scrollback).toBe(5000);
  });

  it('reactively updates fontSize on existing terminal when setting changes', () => {
    const { session, term } = makeSession();
    render(<TerminalXtermHost session={session} active={true} />);
    expect(term.options.fontSize).toBe(14);
    act(() => {
      useSettingsStore.getState().update('fontSize', 22);
    });
    expect(term.options.fontSize).toBe(22);
  });

  it('reactively updates fontFamily on existing terminal when setting changes', () => {
    const { session, term } = makeSession();
    render(<TerminalXtermHost session={session} active={true} />);
    act(() => {
      useSettingsStore.getState().update('fontFamily', 'Hack, monospace');
    });
    expect(term.options.fontFamily).toBe('Hack, monospace');
  });

  it('reactively updates scrollback on existing terminal when setting changes', () => {
    const { session, term } = makeSession();
    render(<TerminalXtermHost session={session} active={true} />);
    act(() => {
      useSettingsStore.getState().update('scrollback', 50);
    });
    expect(term.options.scrollback).toBe(50);
  });

  it('removes the paste suppression listener on unmount', () => {
    const { session } = makeSession();
    const { container, unmount } = render(
      <TerminalXtermHost session={session} active={true} />
    );
    const host = container.querySelector('.terminal-xterm-host') as HTMLElement;
    unmount();
    // After unmount, any latent paste event on the (now-detached) element
    // should not be cancelled by our listener.
    const event = new Event('paste', { cancelable: true, bubbles: true });
    host.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
