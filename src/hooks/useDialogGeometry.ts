import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/** Which edges a drag moves. Corners move two. */
export type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface DialogSize {
    width: number;
    height: number;
}

interface Rect extends DialogSize {
    left: number;
    top: number;
}

export interface UseDialogGeometryOptions {
    /** Open state. Each false-to-true transition centres the dialog once. */
    open: boolean;
    /** The dialog box. Share the ref with `useFocusTrap`. */
    dialogRef: React.RefObject<HTMLElement | null>;
    /** Size before the user has ever dragged. Keep in step with the stylesheet. */
    defaultSize: DialogSize;
    /** Floor. Below this the dialog stops shrinking rather than inverting. */
    minSize: DialogSize;
    /** Persisted size, or null when the user has never resized this dialog. */
    storedSize?: DialogSize | null;
    /** Called once when a resize drag ends, never per frame. */
    onSizeCommit?: (size: DialogSize) => void;
    /** Called when the size is reset to `defaultSize` (grip double-click). */
    onSizeReset?: () => void;
}

/**
 * How much of the dialog must stay reachable when it is dragged off an edge.
 * Windows keeps a grabbable strip on screen; without this a dialog can be
 * pushed somewhere it can never be pulled back from.
 */
const EDGE_KEEP = 80;
/** Vertical equivalent: enough of the title bar to grab. */
const TITLEBAR_KEEP = 32;

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

/** -1 = the west/north edge moves, +1 = east/south, 0 = that axis is fixed. */
const EDGE: Record<ResizeDir, { x: -1 | 0 | 1; y: -1 | 0 | 1 }> = {
    n: { x: 0, y: -1 },
    s: { x: 0, y: 1 },
    e: { x: 1, y: 0 },
    w: { x: -1, y: 0 },
    ne: { x: 1, y: -1 },
    nw: { x: -1, y: -1 },
    se: { x: 1, y: 1 },
    sw: { x: -1, y: 1 },
};

const CURSOR: Record<ResizeDir, string> = {
    n: 'ns-resize',
    s: 'ns-resize',
    e: 'ew-resize',
    w: 'ew-resize',
    ne: 'nesw-resize',
    sw: 'nesw-resize',
    nw: 'nwse-resize',
    se: 'nwse-resize',
};

/** Controls that own their own press; a drag must not start from them. */
const NO_DRAG_FROM = 'button, a, input, select, textarea, [role="tab"], [contenteditable]';

/**
 * Position and size for a movable, resizable dialog, Windows-style.
 *
 * Three rules make it behave like a real window:
 *
 *  1. **The opposite edge is a fixed point.** Dragging the west edge holds
 *     `left + width` still and moves `left`; dragging the east edge holds
 *     `left`. Expressing it that way means a dialog squeezed to its minimum
 *     stops instead of inverting, with no extra guards.
 *  2. **The geometry lives in the DOM, not in React state.** Every frame of a
 *     drag writes straight to `style`. State would re-render the whole dialog
 *     (and, for the session dialog, the host tree inside it) on every pointer
 *     move, and — worse — it would let an effect depend on the size and write
 *     the position back, which is exactly the bug that made a resize re-centre
 *     the dialog. There is no size here for an effect to depend on.
 *  3. **Centring happens once, when the dialog opens.** A window resize
 *     afterwards only pulls the dialog back into view; it never re-centres.
 *
 * Pointer capture keeps a drag alive past the window edge, and has the useful
 * side effect of retargeting the trailing `click` to the handle, so a drag that
 * ends out on the backdrop cannot be mistaken for a click there.
 */
export function useDialogGeometry({
    open,
    dialogRef,
    defaultSize,
    minSize,
    storedSize,
    onSizeCommit,
    onSizeReset,
}: UseDialogGeometryOptions) {
    /** The single source of truth while open. Mirrored to the node, never to state. */
    const rect = useRef<Rect>({ left: 0, top: 0, width: 0, height: 0 });
    /** Cleanup for an in-flight drag, so unmounting mid-drag cannot leak listeners. */
    const endDrag = useRef<(() => void) | null>(null);

    // Read at gesture time, never during render, so a changing callback does not
    // have to re-create the handlers.
    const latest = useRef({ defaultSize, minSize, onSizeCommit, onSizeReset });
    useEffect(() => {
        latest.current = { defaultSize, minSize, onSizeCommit, onSizeReset };
    });

    const apply = useCallback(() => {
        const el = dialogRef.current;
        if (!el) return;
        const r = rect.current;
        el.style.left = `${r.left}px`;
        el.style.top = `${r.top}px`;
        el.style.width = `${r.width}px`;
        el.style.height = `${r.height}px`;
    }, [dialogRef]);

    /** Size to the given box and place it in the middle of the viewport. */
    const centre = useCallback(
        (size: DialogSize) => {
            const min = latest.current.minSize;
            const width = clamp(size.width, min.width, window.innerWidth);
            const height = clamp(size.height, min.height, window.innerHeight);
            rect.current = {
                width,
                height,
                left: Math.max(0, Math.round((window.innerWidth - width) / 2)),
                top: Math.max(0, Math.round((window.innerHeight - height) / 2)),
            };
            apply();
        },
        [apply]
    );

    // Centre on open. `storedSize` is deliberately NOT a dependency: it is the
    // starting size, not a live input. Depending on it would re-run this on
    // every committed resize and snap the dialog back to the middle, the exact
    // failure this hook exists to remove.
    useLayoutEffect(() => {
        if (!open) return;
        const el = dialogRef.current;
        if (!el) return;
        el.style.position = 'fixed';
        el.style.margin = '0';
        centre(storedSize ?? defaultSize);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // A smaller viewport pulls the dialog back into reach. It does not re-centre:
    // moving a window the user placed is exactly what Windows does not do.
    useEffect(() => {
        if (!open) return;
        const onWindowResize = () => {
            const min = latest.current.minSize;
            const r = rect.current;
            const width = clamp(r.width, min.width, window.innerWidth);
            const height = clamp(r.height, min.height, window.innerHeight);
            rect.current = {
                width,
                height,
                left: clamp(r.left, -(width - EDGE_KEEP), window.innerWidth - EDGE_KEEP),
                top: clamp(r.top, 0, window.innerHeight - TITLEBAR_KEEP),
            };
            apply();
        };
        window.addEventListener('resize', onWindowResize);
        return () => window.removeEventListener('resize', onWindowResize);
    }, [open, apply]);

    // Never leave a drag running past unmount.
    useEffect(() => () => endDrag.current?.(), []);

    /** Shared drag plumbing: capture the pointer, track it, clean up exactly once. */
    const beginDrag = useCallback(
        (
            e: React.PointerEvent,
            cursor: string,
            onMove: (dx: number, dy: number) => void,
            onDone?: () => void
        ) => {
            e.preventDefault();
            e.stopPropagation();
            endDrag.current?.();

            const handle = e.currentTarget as HTMLElement;
            const startX = e.clientX;
            const startY = e.clientY;
            const pointerId = e.pointerId;

            // Absent in jsdom, and a browser can refuse a stale pointer id. The
            // window listeners below carry the drag either way.
            try {
                handle.setPointerCapture?.(pointerId);
            } catch {
                /* fall back to the window listeners */
            }

            const prevCursor = document.body.style.cursor;
            const prevSelect = document.body.style.userSelect;
            document.body.style.cursor = cursor;
            document.body.style.userSelect = 'none';

            const handleMove = (ev: PointerEvent) =>
                onMove(ev.clientX - startX, ev.clientY - startY);

            const finish = () => {
                if (endDrag.current !== finish) return;
                endDrag.current = null;
                window.removeEventListener('pointermove', handleMove);
                window.removeEventListener('pointerup', finish);
                window.removeEventListener('pointercancel', finish);
                document.body.style.cursor = prevCursor;
                document.body.style.userSelect = prevSelect;
                try {
                    handle.releasePointerCapture?.(pointerId);
                } catch {
                    /* already released */
                }
                onDone?.();
            };

            endDrag.current = finish;
            window.addEventListener('pointermove', handleMove);
            window.addEventListener('pointerup', finish);
            window.addEventListener('pointercancel', finish);
        },
        []
    );

    /** Title-bar drag. Spread onto the header. */
    const onPointerDown = useCallback(
        (e: React.PointerEvent) => {
            if (e.button !== 0) return;
            // A press that lands on a control belongs to the control.
            if ((e.target as HTMLElement).closest(NO_DRAG_FROM)) return;

            const start = { ...rect.current };
            beginDrag(e, 'grabbing', (dx, dy) => {
                rect.current = {
                    ...rect.current,
                    left: clamp(
                        start.left + dx,
                        -(start.width - EDGE_KEEP),
                        window.innerWidth - EDGE_KEEP
                    ),
                    top: clamp(start.top + dy, 0, window.innerHeight - TITLEBAR_KEEP),
                };
                apply();
            });
        },
        [beginDrag, apply]
    );

    /** Edge or corner drag. Wire to every handle of `DialogResizeFrame`. */
    const startResize = useCallback(
        (dir: ResizeDir, e: React.PointerEvent) => {
            if (e.button !== 0) return;
            const start = { ...rect.current };
            const edge = EDGE[dir];

            beginDrag(
                e,
                CURSOR[dir],
                (dx, dy) => {
                    const min = latest.current.minSize;
                    const next = { ...start };

                    if (edge.x === 1) {
                        next.width = clamp(start.width + dx, min.width, window.innerWidth);
                    } else if (edge.x === -1) {
                        // Hold the east edge still and let `left` follow the width.
                        // Capping the width at `right` is what keeps `left >= 0`.
                        const right = start.left + start.width;
                        next.width = clamp(
                            start.width - dx,
                            min.width,
                            Math.min(window.innerWidth, right)
                        );
                        next.left = right - next.width;
                    }

                    if (edge.y === 1) {
                        next.height = clamp(start.height + dy, min.height, window.innerHeight);
                    } else if (edge.y === -1) {
                        const bottom = start.top + start.height;
                        next.height = clamp(
                            start.height - dy,
                            min.height,
                            Math.min(window.innerHeight, bottom)
                        );
                        next.top = bottom - next.height;
                    }

                    rect.current = next;
                    apply();
                },
                () => {
                    const r = rect.current;
                    latest.current.onSizeCommit?.({ width: r.width, height: r.height });
                }
            );
        },
        [beginDrag, apply]
    );

    /** Back to the stylesheet size, centred again. Bound to the grip's double-click. */
    const resetGeometry = useCallback(() => {
        centre(latest.current.defaultSize);
        latest.current.onSizeReset?.();
    }, [centre]);

    return { moveHandleProps: { onPointerDown }, startResize, resetGeometry };
}
