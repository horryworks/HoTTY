import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useResize } from './useResize';

// Helper: create a synthetic React.MouseEvent-like object
function makeMouseEvent(x: number, y: number) {
    return {
        clientX: x,
        clientY: y,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
    } as unknown as React.MouseEvent;
}

// Helper: fire a native mousemove/mouseup on document
function fireDocumentMouseMove(x: number, y: number) {
    const ev = new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true });
    document.dispatchEvent(ev);
}

function fireDocumentMouseUp() {
    const ev = new MouseEvent('mouseup', { bubbles: true });
    document.dispatchEvent(ev);
}

describe('useResize', () => {
    beforeEach(() => {
        document.body.style.cursor = '';
    });

    afterEach(() => {
        // Ensure no lingering listeners after each test
        fireDocumentMouseUp();
    });

    it('isResizing starts as false', () => {
        const { result } = renderHook(() => useResize({ onMove: vi.fn() }));
        expect(result.current.isResizing).toBe(false);
    });

    it('isResizing becomes true on startResize', () => {
        const { result } = renderHook(() => useResize({ onMove: vi.fn() }));
        act(() => result.current.startResize(makeMouseEvent(100, 100)));
        expect(result.current.isResizing).toBe(true);
    });

    it('calls onMove with dx/dy on mousemove', () => {
        const onMove = vi.fn();
        const { result } = renderHook(() => useResize({ onMove }));

        act(() => result.current.startResize(makeMouseEvent(100, 100)));
        act(() => fireDocumentMouseMove(130, 120));

        expect(onMove).toHaveBeenCalledWith(30, 20);
    });

    it('isResizing becomes false on mouseup', () => {
        const { result } = renderHook(() => useResize({ onMove: vi.fn() }));
        act(() => result.current.startResize(makeMouseEvent(100, 100)));
        act(() => fireDocumentMouseUp());
        expect(result.current.isResizing).toBe(false);
    });

    it('horizontal orientation zeroes dy', () => {
        const onMove = vi.fn();
        const { result } = renderHook(() =>
            useResize({ onMove, orientation: 'horizontal' })
        );
        act(() => result.current.startResize(makeMouseEvent(100, 100)));
        act(() => fireDocumentMouseMove(140, 150));
        expect(onMove).toHaveBeenCalledWith(40, 0);
    });

    it('vertical orientation zeroes dx', () => {
        const onMove = vi.fn();
        const { result } = renderHook(() =>
            useResize({ onMove, orientation: 'vertical' })
        );
        act(() => result.current.startResize(makeMouseEvent(100, 100)));
        act(() => fireDocumentMouseMove(150, 130));
        expect(onMove).toHaveBeenCalledWith(0, 30);
    });

    it('sets correct cursor on body for horizontal orientation', () => {
        const { result } = renderHook(() =>
            useResize({ onMove: vi.fn(), orientation: 'horizontal' })
        );
        act(() => result.current.startResize(makeMouseEvent(0, 0)));
        expect(document.body.style.cursor).toBe('col-resize');
    });

    it('sets correct cursor on body for vertical orientation', () => {
        const { result } = renderHook(() =>
            useResize({ onMove: vi.fn(), orientation: 'vertical' })
        );
        act(() => result.current.startResize(makeMouseEvent(0, 0)));
        expect(document.body.style.cursor).toBe('row-resize');
    });

    it('restores cursor after mouseup', () => {
        const { result } = renderHook(() => useResize({ onMove: vi.fn() }));
        act(() => result.current.startResize(makeMouseEvent(0, 0)));
        act(() => fireDocumentMouseUp());
        expect(document.body.style.cursor).toBe('');
    });

    it('does not call onMove after mouseup', () => {
        const onMove = vi.fn();
        const { result } = renderHook(() => useResize({ onMove }));
        act(() => result.current.startResize(makeMouseEvent(100, 100)));
        act(() => fireDocumentMouseUp());
        act(() => fireDocumentMouseMove(200, 200));
        // onMove may have been called during drag but not after mouseup
        const callCount = onMove.mock.calls.length;
        act(() => fireDocumentMouseMove(300, 300));
        expect(onMove.mock.calls.length).toBe(callCount);
    });
});
