import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useModalState } from './useModalState';

describe('useModalState', () => {
    it('initializes closed with no data', () => {
        const { result } = renderHook(() => useModalState<string>());
        const [isOpen, , , data] = result.current;
        expect(isOpen).toBe(false);
        expect(data).toBeUndefined();
    });

    it('opens the modal', () => {
        const { result } = renderHook(() => useModalState());
        const [, open] = result.current;
        act(() => open());
        expect(result.current[0]).toBe(true);
    });

    it('opens the modal with data', () => {
        const { result } = renderHook(() => useModalState<{ id: number }>());
        const [, open] = result.current;
        act(() => open({ id: 42 }));
        expect(result.current[0]).toBe(true);
        expect(result.current[3]).toEqual({ id: 42 });
    });

    it('closes the modal and clears data', () => {
        const { result } = renderHook(() => useModalState<string>());
        const [, open, close] = result.current;
        act(() => open('hello'));
        act(() => close());
        expect(result.current[0]).toBe(false);
        expect(result.current[3]).toBeUndefined();
    });

    it('open/close functions are stable (same reference) across renders', () => {
        const { result, rerender } = renderHook(() => useModalState<number>());
        const [, open1, close1] = result.current;
        rerender();
        const [, open2, close2] = result.current;
        expect(open1).toBe(open2);
        expect(close1).toBe(close2);
    });
});
