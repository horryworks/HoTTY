import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * The stack of dialogs that are currently open, in the order they opened.
 *
 * One list answers two questions that used to be answered separately, and
 * inconsistently:
 *
 *  - **How high does this dialog sit?** z-index was hand-assigned per
 *    component, 10000 or 10001, each with a comment naming the other dialog it
 *    had to clear. `ConfirmModal` is opened from nine places, several of them
 *    inside a dialog that was also 10000, so it only landed on top because of
 *    DOM order. Counting the stack instead makes "the one opened last is in
 *    front" true by construction, wherever it happens to be rendered.
 *  - **Is this the front dialog?** Escape and a backdrop click must reach only
 *    the frontmost one.
 *
 * Order is decided by mount order alone. Nothing a dialog does after mounting
 * can move it — the property the Escape handling has always depended on: a
 * background dialog that merely re-rendered must not steal the key from the one
 * in front of it.
 */

/** Base tier for dialogs. Matches the long-standing `z-index: 10000`. */
export const DIALOG_Z_BASE = 10000;

type Entry = { readonly id: symbol };

const stack: Entry[] = [];
const subscribers = new Set<() => void>();

function notify(): void {
    for (const fn of subscribers) fn();
}

function subscribe(onChange: () => void): () => void {
    subscribers.add(onChange);
    return () => {
        subscribers.delete(onChange);
    };
}

/** Snapshots are plain numbers, so React can compare them without memoisation. */
const getSize = () => stack.length;

export interface DialogStackPosition {
    /** 0 for the bottom-most open dialog; -1 before this dialog has registered. */
    depth: number;
    /** `z-index` for this dialog's overlay. */
    zIndex: number;
    /** True only for the dialog in front. Escape and backdrop clicks use this. */
    isTop: boolean;
}

/**
 * Registers an open dialog and reports where it sits.
 *
 * Pass `false` while the dialog is closed: several dialogs stay mounted between
 * openings and must not hold a slot in the stack the whole time.
 */
export function useDialogStack(open: boolean): DialogStackPosition {
    // A stable per-instance identity, created without a ref so nothing is read
    // from a ref during render.
    const [self] = useState<Entry>(() => ({ id: Symbol('dialog') }));

    useEffect(() => {
        if (!open) return;
        stack.push(self);
        notify();
        return () => {
            // Search from the top: closing is almost always LIFO.
            const i = stack.lastIndexOf(self);
            if (i >= 0) {
                stack.splice(i, 1);
                notify();
            }
        };
    }, [open, self]);

    const index = useSyncExternalStore(subscribe, () => stack.indexOf(self));
    const size = useSyncExternalStore(subscribe, getSize);

    // The effect runs after the first paint, so a freshly opened dialog reports
    // -1 for exactly one frame. Treat that as "in front" only when nothing else
    // is open, so a nested dialog never briefly outranks its parent.
    const depth = index >= 0 ? index : Math.max(0, size);
    return {
        depth,
        zIndex: DIALOG_Z_BASE + depth,
        isTop: index >= 0 ? index === size - 1 : size === 0,
    };
}

/** Test seam: drops anything an unmounted tree left behind. */
export function __resetDialogStack(): void {
    stack.length = 0;
}
