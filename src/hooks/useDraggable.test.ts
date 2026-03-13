import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDraggable } from './useDraggable';

afterEach(() => {
    document.body.style.userSelect = '';
});

const makeMouseEvent = (type: string, props: Partial<MouseEvent> = {}) => {
    return new MouseEvent(type, { bubbles: true, ...props });
};

describe('useDraggable — initial state', () => {
    it('starts at default position {0, 0}', () => {
        const { result } = renderHook(() => useDraggable());
        expect(result.current.position).toEqual({ x: 0, y: 0 });
    });

    it('starts at custom initial position', () => {
        const { result } = renderHook(() => useDraggable({ x: 100, y: 200 }));
        expect(result.current.position).toEqual({ x: 100, y: 200 });
    });

    it('isDragging starts as false', () => {
        const { result } = renderHook(() => useDraggable());
        expect(result.current.isDragging).toBe(false);
    });
});

describe('useDraggable — onMouseDown', () => {
    it('sets isDragging to true on left click', () => {
        const { result } = renderHook(() => useDraggable());
        const fakeEvent = {
            button: 0,
            clientX: 50,
            clientY: 60,
            target: document.createElement('div'),
        } as unknown as React.MouseEvent;

        act(() => result.current.onMouseDown(fakeEvent));
        expect(result.current.isDragging).toBe(true);
    });

    it('does not start dragging on right click', () => {
        const { result } = renderHook(() => useDraggable());
        const fakeEvent = {
            button: 2,
            clientX: 50,
            clientY: 60,
            target: document.createElement('div'),
        } as unknown as React.MouseEvent;

        act(() => result.current.onMouseDown(fakeEvent));
        expect(result.current.isDragging).toBe(false);
    });

    it('does not start dragging when clicking a BUTTON element', () => {
        const { result } = renderHook(() => useDraggable());
        const btn = document.createElement('button');
        const fakeEvent = {
            button: 0,
            clientX: 50,
            clientY: 60,
            target: btn,
        } as unknown as React.MouseEvent;

        act(() => result.current.onMouseDown(fakeEvent));
        expect(result.current.isDragging).toBe(false);
    });

    it('does not start dragging when clicking an INPUT element', () => {
        const { result } = renderHook(() => useDraggable());
        const input = document.createElement('input');
        const fakeEvent = {
            button: 0,
            clientX: 50,
            clientY: 60,
            target: input,
        } as unknown as React.MouseEvent;

        act(() => result.current.onMouseDown(fakeEvent));
        expect(result.current.isDragging).toBe(false);
    });

    it('disables user-select on body when drag starts', () => {
        const { result } = renderHook(() => useDraggable());
        const fakeEvent = {
            button: 0,
            clientX: 50,
            clientY: 60,
            target: document.createElement('div'),
        } as unknown as React.MouseEvent;

        act(() => result.current.onMouseDown(fakeEvent));
        expect(document.body.style.userSelect).toBe('none');
    });
});

describe('useDraggable — mouse move while dragging', () => {
    it('updates position on mousemove', () => {
        const { result } = renderHook(() => useDraggable({ x: 0, y: 0 }));

        // Start dragging at (50, 60)
        const startEvent = {
            button: 0,
            clientX: 50,
            clientY: 60,
            target: document.createElement('div'),
        } as unknown as React.MouseEvent;
        act(() => result.current.onMouseDown(startEvent));

        // Move to (100, 110)
        act(() => {
            window.dispatchEvent(makeMouseEvent('mousemove', { clientX: 100, clientY: 110 }));
        });

        // Expected: (100 - 50, 110 - 60) = (50, 50)
        expect(result.current.position).toEqual({ x: 50, y: 50 });
    });

    it('does not move position when not dragging', () => {
        const { result } = renderHook(() => useDraggable({ x: 10, y: 20 }));

        act(() => {
            window.dispatchEvent(makeMouseEvent('mousemove', { clientX: 200, clientY: 300 }));
        });

        expect(result.current.position).toEqual({ x: 10, y: 20 });
    });
});

describe('useDraggable — mouseup ends dragging', () => {
    it('sets isDragging to false on mouseup', () => {
        const { result } = renderHook(() => useDraggable());

        const startEvent = {
            button: 0,
            clientX: 50,
            clientY: 60,
            target: document.createElement('div'),
        } as unknown as React.MouseEvent;
        act(() => result.current.onMouseDown(startEvent));
        expect(result.current.isDragging).toBe(true);

        act(() => {
            window.dispatchEvent(makeMouseEvent('mouseup'));
        });
        expect(result.current.isDragging).toBe(false);
    });

    it('restores user-select on body on mouseup', () => {
        const { result } = renderHook(() => useDraggable());
        const startEvent = {
            button: 0,
            clientX: 50,
            clientY: 60,
            target: document.createElement('div'),
        } as unknown as React.MouseEvent;
        act(() => result.current.onMouseDown(startEvent));
        act(() => {
            window.dispatchEvent(makeMouseEvent('mouseup'));
        });
        expect(document.body.style.userSelect).toBe('');
    });
});
