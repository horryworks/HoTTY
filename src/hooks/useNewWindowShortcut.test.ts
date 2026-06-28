import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useNewWindowShortcut } from './useNewWindowShortcut';
import { tauriService } from '../services/tauriService';

function pressN(
  opts: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean; repeat?: boolean } = {},
) {
  const ev = new KeyboardEvent('keydown', {
    key: opts.shift ? 'N' : 'n',
    ctrlKey: opts.ctrl ?? false,
    shiftKey: opts.shift ?? false,
    altKey: opts.alt ?? false,
    metaKey: opts.meta ?? false,
    repeat: opts.repeat ?? false,
    cancelable: true,
    bubbles: true,
  });
  document.dispatchEvent(ev);
  return ev;
}

describe('useNewWindowShortcut', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(tauriService, 'createWindow').mockResolvedValue('win-1');
  });

  it('Ctrl+Shift+N opens a new window and prevents default', () => {
    renderHook(() => useNewWindowShortcut());
    const ev = pressN({ ctrl: true, shift: true });
    expect(tauriService.createWindow).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('ignores Ctrl+N without Shift', () => {
    renderHook(() => useNewWindowShortcut());
    const ev = pressN({ ctrl: true });
    expect(tauriService.createWindow).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it('ignores auto-repeat so holding the chord opens only one window', () => {
    renderHook(() => useNewWindowShortcut());
    pressN({ ctrl: true, shift: true, repeat: true });
    expect(tauriService.createWindow).not.toHaveBeenCalled();
  });

  it('ignores Ctrl+Shift+Alt+N so OS combos are not shadowed', () => {
    renderHook(() => useNewWindowShortcut());
    const ev = pressN({ ctrl: true, shift: true, alt: true });
    expect(tauriService.createWindow).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it('stops listening after unmount', () => {
    const { unmount } = renderHook(() => useNewWindowShortcut());
    unmount();
    pressN({ ctrl: true, shift: true });
    expect(tauriService.createWindow).not.toHaveBeenCalled();
  });
});
