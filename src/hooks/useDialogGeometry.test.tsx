import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useRef } from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { useDialogGeometry, type ResizeDir, type DialogSize } from './useDialogGeometry';

const DIRS: ResizeDir[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

const DEFAULT_SIZE: DialogSize = { width: 400, height: 300 };
const MIN_SIZE: DialogSize = { width: 200, height: 150 };

function setViewport(width: number, height: number) {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: height, configurable: true, writable: true });
}

interface HarnessProps {
    open?: boolean;
    storedSize?: DialogSize | null;
    onSizeCommit?: (s: DialogSize) => void;
    onSizeReset?: () => void;
    onReady?: (reset: () => void) => void;
}

function Harness({ open = true, storedSize = null, onSizeCommit, onSizeReset, onReady }: HarnessProps) {
    const ref = useRef<HTMLDivElement | null>(null);
    const { moveHandleProps, startResize, resetGeometry } = useDialogGeometry({
        open,
        dialogRef: ref,
        defaultSize: DEFAULT_SIZE,
        minSize: MIN_SIZE,
        storedSize,
        onSizeCommit,
        onSizeReset,
    });
    onReady?.(resetGeometry);
    return (
        <div data-testid="dialog" ref={ref}>
            <div data-testid="titlebar" {...moveHandleProps}>
                <button data-testid="titlebar-button">x</button>
            </div>
            {DIRS.map((d) => (
                <div key={d} data-testid={`handle-${d}`} onPointerDown={(e) => startResize(d, e)} />
            ))}
        </div>
    );
}

/** The four numbers the hook writes, as numbers. */
function geom(el: HTMLElement) {
    const n = (v: string) => Number.parseFloat(v || '0');
    return {
        left: n(el.style.left),
        top: n(el.style.top),
        width: n(el.style.width),
        height: n(el.style.height),
    };
}

/** One complete drag: press the handle, move, release. */
function drag(handle: HTMLElement, dx: number, dy: number, release = true) {
    fireEvent.pointerDown(handle, { clientX: 500, clientY: 400, button: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 500 + dx, clientY: 400 + dy, pointerId: 1 });
    if (release) fireEvent.pointerUp(window, { clientX: 500 + dx, clientY: 400 + dy, pointerId: 1 });
}

describe('useDialogGeometry', () => {
    beforeEach(() => {
        setViewport(1000, 800);
    });

    describe('opening', () => {
        it('centres at the default size', () => {
            const { getByTestId } = render(<Harness />);
            // (1000-400)/2, (800-300)/2
            expect(geom(getByTestId('dialog'))).toEqual({ left: 300, top: 250, width: 400, height: 300 });
        });

        it('centres at the stored size when one was saved', () => {
            const { getByTestId } = render(<Harness storedSize={{ width: 600, height: 500 }} />);
            expect(geom(getByTestId('dialog'))).toEqual({ left: 200, top: 150, width: 600, height: 500 });
        });

        it('clamps a stored size larger than the viewport', () => {
            setViewport(500, 400);
            const { getByTestId } = render(<Harness storedSize={{ width: 900, height: 900 }} />);
            const g = geom(getByTestId('dialog'));
            expect(g.width).toBe(500);
            expect(g.height).toBe(400);
        });

        it('positions the dialog itself rather than relying on the overlay', () => {
            const { getByTestId } = render(<Harness />);
            expect(getByTestId('dialog').style.position).toBe('fixed');
            expect(getByTestId('dialog').style.margin).toBe('0px');
        });
    });

    describe('resizing holds the opposite edge still', () => {
        it('se leaves the top-left where it was', () => {
            const { getByTestId } = render(<Harness />);
            const el = getByTestId('dialog');
            const before = geom(el);

            drag(getByTestId('handle-se'), 120, 90);

            const after = geom(el);
            expect(after.left).toBe(before.left);
            expect(after.top).toBe(before.top);
            expect(after.width).toBe(before.width + 120);
            expect(after.height).toBe(before.height + 90);
        });

        it('nw leaves the bottom-right where it was', () => {
            const { getByTestId } = render(<Harness />);
            const el = getByTestId('dialog');
            const before = geom(el);
            const right = before.left + before.width;
            const bottom = before.top + before.height;

            drag(getByTestId('handle-nw'), -60, -40);

            const after = geom(el);
            expect(after.left + after.width).toBe(right);
            expect(after.top + after.height).toBe(bottom);
            expect(after.width).toBe(before.width + 60);
            expect(after.height).toBe(before.height + 40);
        });

        it('w moves only the west edge', () => {
            const { getByTestId } = render(<Harness />);
            const el = getByTestId('dialog');
            const before = geom(el);

            drag(getByTestId('handle-w'), 50, 999);

            const after = geom(el);
            expect(after.left).toBe(before.left + 50);
            expect(after.width).toBe(before.width - 50);
            // The vertical component of the gesture is ignored on a side edge.
            expect(after.top).toBe(before.top);
            expect(after.height).toBe(before.height);
        });

        it('n moves only the north edge', () => {
            const { getByTestId } = render(<Harness />);
            const el = getByTestId('dialog');
            const before = geom(el);

            drag(getByTestId('handle-n'), 999, 40);

            const after = geom(el);
            expect(after.top).toBe(before.top + 40);
            expect(after.height).toBe(before.height - 40);
            expect(after.left).toBe(before.left);
            expect(after.width).toBe(before.width);
        });
    });

    describe('limits', () => {
        it('stops at the minimum width without the west edge passing the east one', () => {
            const { getByTestId } = render(<Harness />);
            const el = getByTestId('dialog');
            const right = geom(el).left + geom(el).width;

            drag(getByTestId('handle-w'), 9999, 0);

            const after = geom(el);
            expect(after.width).toBe(MIN_SIZE.width);
            expect(after.left + after.width).toBe(right);
        });

        it('stops at the minimum height without the north edge passing the south one', () => {
            const { getByTestId } = render(<Harness />);
            const el = getByTestId('dialog');
            const bottom = geom(el).top + geom(el).height;

            drag(getByTestId('handle-n'), 0, 9999);

            const after = geom(el);
            expect(after.height).toBe(MIN_SIZE.height);
            expect(after.top + after.height).toBe(bottom);
        });

        it('never lets a west drag push the dialog off the left of the screen', () => {
            const { getByTestId } = render(<Harness />);
            const el = getByTestId('dialog');

            drag(getByTestId('handle-w'), -9999, 0);

            expect(geom(el).left).toBeGreaterThanOrEqual(0);
        });

        it('keeps a grabbable strip on screen when dragged to the right', () => {
            const { getByTestId } = render(<Harness />);
            const el = getByTestId('dialog');

            drag(getByTestId('titlebar'), 9999, 9999);

            const after = geom(el);
            // 80px of the dialog stays in view, and the title bar stays reachable.
            expect(after.left).toBe(window.innerWidth - 80);
            expect(after.top).toBe(window.innerHeight - 32);
        });

        it('never lets the title bar go above the top edge', () => {
            const { getByTestId } = render(<Harness />);
            const el = getByTestId('dialog');

            drag(getByTestId('titlebar'), 0, -9999);

            expect(geom(el).top).toBe(0);
        });
    });

    describe('the dialog stays where it was put', () => {
        it('does not re-centre when it is resized after being moved', () => {
            const { getByTestId } = render(<Harness />);
            const el = getByTestId('dialog');

            drag(getByTestId('titlebar'), -200, -100);
            const moved = geom(el);
            expect(moved.left).toBe(100);
            expect(moved.top).toBe(150);

            drag(getByTestId('handle-se'), 50, 50);

            const after = geom(el);
            // The regression: the old code re-centred on every size change.
            expect(after.left).toBe(moved.left);
            expect(after.top).toBe(moved.top);
        });

        it('does not re-centre when the window is resized', () => {
            const { getByTestId } = render(<Harness />);
            const el = getByTestId('dialog');

            drag(getByTestId('titlebar'), -250, -200);
            const moved = geom(el);

            act(() => {
                setViewport(900, 700);
                window.dispatchEvent(new Event('resize'));
            });

            const after = geom(el);
            expect(after.left).toBe(moved.left);
            expect(after.top).toBe(moved.top);
        });

        it('pulls the dialog back into view when the window shrinks past it', () => {
            const { getByTestId } = render(<Harness />);
            const el = getByTestId('dialog');

            drag(getByTestId('titlebar'), 400, 300);

            act(() => {
                setViewport(300, 250);
                window.dispatchEvent(new Event('resize'));
            });

            const after = geom(el);
            expect(after.left).toBeLessThanOrEqual(300 - 80);
            expect(after.top).toBeLessThanOrEqual(250 - 32);
            // Shrunk to fit, but never below the floor.
            expect(after.width).toBe(MIN_SIZE.width + 100);
            expect(after.height).toBe(MIN_SIZE.height + 100);
        });
    });

    describe('persistence', () => {
        it('commits the size once, on release', () => {
            const onSizeCommit = vi.fn();
            const { getByTestId } = render(<Harness onSizeCommit={onSizeCommit} />);

            const handle = getByTestId('handle-se');
            fireEvent.pointerDown(handle, { clientX: 500, clientY: 400, button: 0, pointerId: 1 });
            fireEvent.pointerMove(window, { clientX: 540, clientY: 430, pointerId: 1 });
            fireEvent.pointerMove(window, { clientX: 580, clientY: 460, pointerId: 1 });
            expect(onSizeCommit).not.toHaveBeenCalled();

            fireEvent.pointerUp(window, { clientX: 580, clientY: 460, pointerId: 1 });
            expect(onSizeCommit).toHaveBeenCalledTimes(1);
            expect(onSizeCommit).toHaveBeenCalledWith({ width: 480, height: 360 });
        });

        it('commits no position, only a size', () => {
            const onSizeCommit = vi.fn();
            const { getByTestId } = render(<Harness onSizeCommit={onSizeCommit} />);

            drag(getByTestId('handle-se'), 10, 10);

            expect(Object.keys(onSizeCommit.mock.calls[0][0]).sort()).toEqual(['height', 'width']);
        });

        it('does not commit when the dialog is merely moved', () => {
            const onSizeCommit = vi.fn();
            const { getByTestId } = render(<Harness onSizeCommit={onSizeCommit} />);

            drag(getByTestId('titlebar'), 40, 40);

            expect(onSizeCommit).not.toHaveBeenCalled();
        });

        it('resets to the default size, centred, and says so', () => {
            const onSizeReset = vi.fn();
            let reset: (() => void) | null = null;
            const { getByTestId } = render(
                <Harness
                    storedSize={{ width: 700, height: 600 }}
                    onSizeReset={onSizeReset}
                    onReady={(r) => {
                        reset = r;
                    }}
                />
            );
            const el = getByTestId('dialog');
            drag(getByTestId('titlebar'), 100, 100);

            act(() => {
                reset?.();
            });

            expect(geom(el)).toEqual({ left: 300, top: 250, width: 400, height: 300 });
            expect(onSizeReset).toHaveBeenCalledTimes(1);
        });
    });

    describe('what does not start a drag', () => {
        it('ignores a press on a control inside the title bar', () => {
            const { getByTestId } = render(<Harness />);
            const el = getByTestId('dialog');
            const before = geom(el);

            fireEvent.pointerDown(getByTestId('titlebar-button'), {
                clientX: 500,
                clientY: 400,
                button: 0,
                pointerId: 1,
            });
            fireEvent.pointerMove(window, { clientX: 600, clientY: 500, pointerId: 1 });
            fireEvent.pointerUp(window, { clientX: 600, clientY: 500, pointerId: 1 });

            expect(geom(el)).toEqual(before);
        });

        it('ignores a non-primary button', () => {
            const { getByTestId } = render(<Harness />);
            const el = getByTestId('dialog');
            const before = geom(el);

            fireEvent.pointerDown(getByTestId('handle-se'), {
                clientX: 500,
                clientY: 400,
                button: 2,
                pointerId: 1,
            });
            fireEvent.pointerMove(window, { clientX: 600, clientY: 500, pointerId: 1 });
            fireEvent.pointerUp(window, { clientX: 600, clientY: 500, pointerId: 1 });

            expect(geom(el)).toEqual(before);
        });

        it('stops tracking the pointer once the drag ends', () => {
            const { getByTestId } = render(<Harness />);
            const el = getByTestId('dialog');

            drag(getByTestId('handle-se'), 50, 50);
            const after = geom(el);

            fireEvent.pointerMove(window, { clientX: 900, clientY: 900, pointerId: 1 });
            expect(geom(el)).toEqual(after);
        });
    });
});
