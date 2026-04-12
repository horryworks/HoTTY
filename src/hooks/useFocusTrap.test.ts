import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFocusTrap } from './useFocusTrap';

describe('useFocusTrap', () => {
  it('does not add keydown listener when inactive', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const ref = { current: document.createElement('div') };
    renderHook(() => useFocusTrap(ref, false));
    const tabListeners = addSpy.mock.calls.filter(([event]) => event === 'keydown');
    expect(tabListeners.length).toBe(0);
    addSpy.mockRestore();
  });

  it('adds keydown listener when active', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const ref = { current: document.createElement('div') };
    renderHook(() => useFocusTrap(ref, true));
    const tabListeners = addSpy.mock.calls.filter(([event]) => event === 'keydown');
    expect(tabListeners.length).toBe(1);
    addSpy.mockRestore();
  });

  it('removes keydown listener on unmount', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const ref = { current: document.createElement('div') };
    const { unmount } = renderHook(() => useFocusTrap(ref, true));
    unmount();
    const tabListeners = removeSpy.mock.calls.filter(([event]) => event === 'keydown');
    expect(tabListeners.length).toBe(1);
    removeSpy.mockRestore();
  });
});
