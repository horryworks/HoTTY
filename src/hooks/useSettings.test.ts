import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSettings } from './useSettings';
import { useSettingsStore } from '../stores/settingsStore';

describe('useSettings', () => {
  it('returns the current settings state from the store', () => {
    useSettingsStore.getState().reset();
    const { result } = renderHook(() => useSettings());
    expect(result.current.fontSize).toBe(useSettingsStore.getState().fontSize);
    expect(result.current.theme).toBe(useSettingsStore.getState().theme);
  });

  it('rerenders when the store changes', () => {
    useSettingsStore.getState().reset();
    const { result } = renderHook(() => useSettings());
    act(() => {
      useSettingsStore.getState().update('fontSize', 22);
    });
    expect(result.current.fontSize).toBe(22);
  });
});
