import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePaneKeyboardNav } from './usePaneKeyboardNav';
import { usePaneStore } from '../stores/paneStore';
import { useSidebarLayoutStore } from '../stores/sidebarLayoutStore';

function pressTab(opts: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {}) {
  const ev = new KeyboardEvent('keydown', {
    key: 'Tab',
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

describe('usePaneKeyboardNav', () => {
  beforeEach(() => {
    usePaneStore.setState({
      layoutMode: '2x2',
      activePaneId: '0',
      paneAllocations: {},
      sessionOrder: [],
    });
    useSidebarLayoutStore.setState({
      showLeftSidebar: false,
      showRightSidebar: false,
      showTopBar: false,
      showBottomBar: false,
    });
  });

  it('Ctrl+Tab focuses the next pane', () => {
    renderHook(() => usePaneKeyboardNav());
    pressTab({ ctrl: true });
    expect(usePaneStore.getState().activePaneId).toBe('1');
  });

  it('Ctrl+Shift+Tab focuses the previous pane', () => {
    usePaneStore.setState({ activePaneId: '1' });
    renderHook(() => usePaneKeyboardNav());
    pressTab({ ctrl: true, shift: true });
    expect(usePaneStore.getState().activePaneId).toBe('0');
  });

  it('Ctrl+Tab wraps around at the end', () => {
    usePaneStore.setState({ activePaneId: '3' });
    renderHook(() => usePaneKeyboardNav());
    pressTab({ ctrl: true });
    expect(usePaneStore.getState().activePaneId).toBe('0');
  });

  it('prevents default so the event never reaches xterm', () => {
    renderHook(() => usePaneKeyboardNav());
    const ev = pressTab({ ctrl: true });
    expect(ev.defaultPrevented).toBe(true);
  });

  it('ignores plain Tab (no Ctrl)', () => {
    renderHook(() => usePaneKeyboardNav());
    const ev = pressTab({});
    expect(usePaneStore.getState().activePaneId).toBe('0');
    expect(ev.defaultPrevented).toBe(false);
  });

  it('ignores Ctrl+Alt+Tab so OS combos are not shadowed', () => {
    renderHook(() => usePaneKeyboardNav());
    const ev = pressTab({ ctrl: true, alt: true });
    expect(usePaneStore.getState().activePaneId).toBe('0');
    expect(ev.defaultPrevented).toBe(false);
  });

  it('stops listening after unmount', () => {
    const { unmount } = renderHook(() => usePaneKeyboardNav());
    unmount();
    pressTab({ ctrl: true });
    expect(usePaneStore.getState().activePaneId).toBe('0');
  });
});
