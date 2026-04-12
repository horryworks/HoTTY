import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useModalState } from './useModalState';

describe('useModalState', () => {
  it('starts closed with no data', () => {
    const { result } = renderHook(() => useModalState<string>());
    const [isOpen, , , data] = result.current;
    expect(isOpen).toBe(false);
    expect(data).toBeUndefined();
  });

  it('open sets isOpen to true and stores data', () => {
    const { result } = renderHook(() => useModalState<string>());
    act(() => {
      result.current[1]('test-data');
    });
    expect(result.current[0]).toBe(true);
    expect(result.current[3]).toBe('test-data');
  });

  it('close sets isOpen to false and clears data', () => {
    const { result } = renderHook(() => useModalState<string>());
    act(() => {
      result.current[1]('test-data');
    });
    expect(result.current[0]).toBe(true);
    act(() => {
      result.current[2]();
    });
    expect(result.current[0]).toBe(false);
    expect(result.current[3]).toBeUndefined();
  });

  it('open without data sets data to undefined', () => {
    const { result } = renderHook(() => useModalState<string>());
    act(() => {
      result.current[1]();
    });
    expect(result.current[0]).toBe(true);
    expect(result.current[3]).toBeUndefined();
  });
});
