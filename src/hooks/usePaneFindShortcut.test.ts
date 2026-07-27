import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePaneFindShortcut, type PaneFindHandlers } from './usePaneFindShortcut';

function press(key: string, opts: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {}) {
  const ev = new KeyboardEvent('keydown', {
    key,
    ctrlKey: opts.ctrl ?? false,
    shiftKey: opts.shift ?? false,
    altKey: opts.alt ?? false,
    metaKey: opts.meta ?? false,
    cancelable: true,
    bubbles: true,
  });
  document.dispatchEvent(ev);
  return ev;
}

let handlers: PaneFindHandlers;

beforeEach(() => {
  handlers = { onFind: vi.fn(), onNext: vi.fn(), onPrev: vi.fn() };
});

describe('usePaneFindShortcut', () => {
  it('Ctrl+F calls onFind when the pane is active', () => {
    renderHook(() => usePaneFindShortcut(true, handlers));
    press('f', { ctrl: true });
    expect(handlers.onFind).toHaveBeenCalledTimes(1);
  });

  it('accepts an uppercase F (e.g. with Caps Lock on)', () => {
    renderHook(() => usePaneFindShortcut(true, handlers));
    press('F', { ctrl: true });
    expect(handlers.onFind).toHaveBeenCalledTimes(1);
  });

  it('prevents default so the chord never reaches xterm', () => {
    renderHook(() => usePaneFindShortcut(true, handlers));
    const ev = press('f', { ctrl: true });
    expect(ev.defaultPrevented).toBe(true);
  });

  // The reason this hook is pane-scoped rather than global: Ctrl+F is a real
  // terminal keybinding (readline forward-char, vim page-forward, tmux prefix).
  it('does nothing when the pane is not active, leaving Ctrl+F to the terminal', () => {
    renderHook(() => usePaneFindShortcut(false, handlers));
    const ev = press('f', { ctrl: true });
    expect(handlers.onFind).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it('starts listening when the pane becomes active', () => {
    const { rerender } = renderHook(
      ({ active }) => usePaneFindShortcut(active, handlers),
      { initialProps: { active: false } },
    );
    press('f', { ctrl: true });
    expect(handlers.onFind).not.toHaveBeenCalled();

    rerender({ active: true });
    press('f', { ctrl: true });
    expect(handlers.onFind).toHaveBeenCalledTimes(1);
  });

  it('ignores plain F, Ctrl+Shift+F, Ctrl+Alt+F and Meta+F', () => {
    renderHook(() => usePaneFindShortcut(true, handlers));
    press('f');
    press('f', { ctrl: true, shift: true });
    press('f', { ctrl: true, alt: true });
    press('f', { meta: true });
    expect(handlers.onFind).not.toHaveBeenCalled();
  });

  it('F3 and Shift+F3 step through matches', () => {
    renderHook(() => usePaneFindShortcut(true, handlers));
    press('F3');
    expect(handlers.onNext).toHaveBeenCalledTimes(1);
    press('F3', { shift: true });
    expect(handlers.onPrev).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the optional next/prev handlers are omitted', () => {
    const onFind = vi.fn();
    renderHook(() => usePaneFindShortcut(true, { onFind }));
    expect(() => press('F3')).not.toThrow();
    expect(() => press('F3', { shift: true })).not.toThrow();
  });

  it('calls the latest handlers without resubscribing', () => {
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ onFind }) => usePaneFindShortcut(true, { onFind }),
      { initialProps: { onFind: handlers.onFind } },
    );
    rerender({ onFind: second });
    press('f', { ctrl: true });
    expect(handlers.onFind).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops listening after unmount', () => {
    const { unmount } = renderHook(() => usePaneFindShortcut(true, handlers));
    unmount();
    press('f', { ctrl: true });
    expect(handlers.onFind).not.toHaveBeenCalled();
  });
});
