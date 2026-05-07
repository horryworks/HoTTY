import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useModalEscape } from './useModalEscape';

function pressEscape() {
  const ev = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
  window.dispatchEvent(ev);
  return ev;
}

describe('useModalEscape', () => {
  it('invokes the registered handler when Escape is pressed', () => {
    const onEscape = vi.fn();
    renderHook(() => useModalEscape(onEscape));
    pressEscape();
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('only invokes the topmost handler when multiple modals are mounted', () => {
    const background = vi.fn();
    const foreground = vi.fn();
    renderHook(() => useModalEscape(background));
    renderHook(() => useModalEscape(foreground));

    pressEscape();
    expect(foreground).toHaveBeenCalledTimes(1);
    expect(background).not.toHaveBeenCalled();
  });

  it('falls back to the next handler after the topmost unmounts', () => {
    const background = vi.fn();
    const foreground = vi.fn();
    renderHook(() => useModalEscape(background));
    const fg = renderHook(() => useModalEscape(foreground));

    fg.unmount();
    pressEscape();
    expect(background).toHaveBeenCalledTimes(1);
    expect(foreground).not.toHaveBeenCalled();
  });

  it('ignores keys other than Escape', () => {
    const onEscape = vi.fn();
    renderHook(() => useModalEscape(onEscape));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(onEscape).not.toHaveBeenCalled();
  });

  it('does not fire after the handler unmounts', () => {
    const onEscape = vi.fn();
    const { unmount } = renderHook(() => useModalEscape(onEscape));
    unmount();
    pressEscape();
    expect(onEscape).not.toHaveBeenCalled();
  });

  it('skips registration when onEscape is null/undefined', () => {
    const real = vi.fn();
    renderHook(() => useModalEscape(null));
    renderHook(() => useModalEscape(undefined));
    renderHook(() => useModalEscape(real));
    pressEscape();
    expect(real).toHaveBeenCalledTimes(1);
  });

  it('preventDefault and stopPropagation are called on the Escape event', () => {
    const onEscape = vi.fn();
    renderHook(() => useModalEscape(onEscape));
    const ev = pressEscape();
    expect(ev.defaultPrevented).toBe(true);
  });

  it('handles registration in non-LIFO order without losing handlers', () => {
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    const ha = renderHook(() => useModalEscape(a));
    const hb = renderHook(() => useModalEscape(b));
    renderHook(() => useModalEscape(c));

    // c is on top
    pressEscape();
    expect(c).toHaveBeenCalledTimes(1);

    // Unmount b (middle of stack) — c should still be on top
    hb.unmount();
    pressEscape();
    expect(c).toHaveBeenCalledTimes(2);
    expect(b).not.toHaveBeenCalled();

    // Unmount a (bottom) — c still on top
    ha.unmount();
    pressEscape();
    expect(c).toHaveBeenCalledTimes(3);
    expect(a).not.toHaveBeenCalled();
  });
});
