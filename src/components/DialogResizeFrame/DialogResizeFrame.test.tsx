import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { DialogResizeFrame } from './DialogResizeFrame';
import type { ResizeDir } from '../../hooks/useDialogGeometry';

const DIRS: ResizeDir[] = ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'];

describe('DialogResizeFrame', () => {
    it('renders a handle for every edge and corner', () => {
        const { container } = render(<DialogResizeFrame onResizeStart={() => {}} />);
        for (const d of DIRS) {
            expect(container.querySelector(`.drf-${d}`)).toBeTruthy();
        }
        expect(container.querySelectorAll('.drf-edge')).toHaveLength(8);
    });

    it('puts the corners after the edges so they win the overlap', () => {
        const { container } = render(<DialogResizeFrame onResizeStart={() => {}} />);
        const classes = Array.from(container.querySelectorAll('.drf-edge')).map(
            (el) => el.className.split(' ')[1]
        );
        expect(classes.slice(0, 4)).toEqual(['drf-n', 'drf-s', 'drf-w', 'drf-e']);
        expect(classes.slice(4)).toEqual(['drf-nw', 'drf-ne', 'drf-sw', 'drf-se']);
    });

    it('reports the direction of the handle that was pressed', () => {
        const onResizeStart = vi.fn();
        const { container } = render(<DialogResizeFrame onResizeStart={onResizeStart} />);

        for (const d of DIRS) {
            fireEvent.pointerDown(container.querySelector(`.drf-${d}`) as HTMLElement);
        }

        expect(onResizeStart.mock.calls.map((c) => c[0])).toEqual(DIRS);
    });

    it('draws nothing and announces nothing', () => {
        const { container } = render(<DialogResizeFrame onResizeStart={() => {}} />);

        // Pointer affordances, like a window border: the cursor says what they
        // do, and eight invisible strips reading themselves out would be noise.
        expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(8);
        expect(container.querySelector('[role="separator"]')).toBeNull();
        // The diagonal mark that used to sit in the corner is gone; every edge
        // resizes now, so it marked nothing the cursor did not already say.
        expect(container.querySelector('.drf-grip')).toBeNull();
    });

    it('resets the size on a double-click of the bottom-right corner', () => {
        const onResetSize = vi.fn();
        const { container } = render(
            <DialogResizeFrame onResizeStart={() => {}} onResetSize={onResetSize} />
        );
        const corner = container.querySelector('.drf-se') as HTMLElement;

        // The tooltip is the only thing left that mentions the gesture.
        expect(corner.getAttribute('title')).toBe('Drag to resize. Double-click to reset.');
        fireEvent.doubleClick(corner);
        expect(onResetSize).toHaveBeenCalledTimes(1);
    });
});
