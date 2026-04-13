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

function makeSession(): { session: SessionRecord; term: ReturnType<typeof makeTerm> } {
  const term = makeTerm();
  const fitAddon = { fit: vi.fn() };
  return {
    term,
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
    buffer: {
      active: {
        baseY: 0,
        cursorY: 0,
        length: 0,
        getLine: vi.fn().mockReturnValue(null),
      },
    },
    registerMarker: vi.fn().mockReturnValue({ line: 0, isDisposed: false, dispose: vi.fn(), onDispose: vi.fn() }),
    registerDecoration: vi.fn().mockReturnValue({ onRender: vi.fn(), onDispose: vi.fn(), dispose: vi.fn() }),
    onCursorMove: vi.fn(() => makeDisposable()),
    onLineFeed: vi.fn(() => makeDisposable()),
    onRender: vi.fn(() => makeDisposable()),
    selectLines: vi.fn(),
  };
}

describe('TerminalView', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
    resize.mockClear();
  });

  it('opens the xterm instance into the container and requests a backend resize', () => {
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
});
