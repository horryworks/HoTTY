import { useCallback, useRef } from 'react';

/**
 * Click handlers that ignore the leftover click a drag produces.
 *
 * The browser dispatches `click` at the nearest common ancestor of the
 * mousedown target and the mouseup target. So a drag that starts on a resize
 * grip inside a dialog and ends out on the backdrop fires a `click` whose
 * target is the backdrop — and a plain `onClick={onClose}` there closes the
 * dialog the user was in the middle of resizing.
 *
 * Neither of the obvious guards works:
 *  - `e.target === e.currentTarget` is *true* in that case, because the common
 *    ancestor really is the overlay itself.
 *  - An `isResizing` flag is already false by then: `mouseup` runs before
 *    `click`.
 *  - A `stopPropagation` on the inner dialog never runs, because the dialog is
 *    not on the click's propagation path at all.
 *
 * The one thing that does distinguish them is where the press landed: if the
 * mousedown and the click report different targets, the pointer moved between
 * press and release, and that is a drag being cleaned up rather than a click.
 */

/** Records the press target. Capture phase — see the note in `useDragSafeClick`. */
function useDownTarget<T extends HTMLElement>() {
    const downTarget = useRef<EventTarget | null>(null);

    // Capture phase, deliberately. `useResize.startResize` calls
    // `e.stopPropagation()` on mousedown, so a bubble-phase listener here would
    // miss exactly the presses that start a drag — leaving a stale target in
    // the ref that can accidentally match the next click.
    const onMouseDownCapture = useCallback((e: React.MouseEvent<T>) => {
        // Only the primary button. A right-click can synthesize a click on some
        // platforms, and dismissing a dialog on a context-menu press is wrong.
        downTarget.current = e.button === 0 ? e.target : null;
    }, []);

    /** Reads and clears in one step: a drag that ended outside the window never
     *  produces the click that would otherwise clear it. */
    const takeDownTarget = useCallback(() => {
        const t = downTarget.current;
        downTarget.current = null;
        return t;
    }, []);

    return { onMouseDownCapture, takeDownTarget };
}

/**
 * Runs `handler` only when the press and the click landed on the same element.
 *
 * Spread the result onto the element whose clicks you are guarding:
 * `<div {...useDragSafeClick(onBlankClick)}>`.
 */
export function useDragSafeClick<T extends HTMLElement>(
    handler: (e: React.MouseEvent<T>) => void
) {
    const { onMouseDownCapture, takeDownTarget } = useDownTarget<T>();

    const onClick = useCallback(
        (e: React.MouseEvent<T>) => {
            if (takeDownTarget() !== e.target) return;
            handler(e);
        },
        [handler, takeDownTarget]
    );

    return { onMouseDownCapture, onClick };
}

/**
 * Backdrop dismissal. Fires only when both the press and the click landed on
 * the overlay itself — never on anything inside the dialog, and never as the
 * tail end of a drag that began inside it.
 *
 * Because the press is checked too, the dialog no longer needs an inner
 * `onClick={(e) => e.stopPropagation()}` to defend itself.
 *
 * Pass `null`/`undefined` to opt out (a dialog that does not dismiss on an
 * outside click); the handlers are still returned so the props can be spread
 * unconditionally.
 */
export function useOverlayDismiss<T extends HTMLElement>(
    onDismiss: (() => void) | null | undefined
) {
    const { onMouseDownCapture, takeDownTarget } = useDownTarget<T>();

    const onClick = useCallback(
        (e: React.MouseEvent<T>) => {
            const down = takeDownTarget();
            if (!onDismiss) return;
            // `e.currentTarget` is the overlay. Requiring both the press and the
            // click to be on it rules out anything that touched the dialog.
            if (e.target !== e.currentTarget) return;
            if (down !== e.currentTarget) return;
            onDismiss();
        },
        [onDismiss, takeDownTarget]
    );

    return { onMouseDownCapture, onClick };
}
