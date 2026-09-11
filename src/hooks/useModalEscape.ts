import { useEffect, useRef } from 'react';

/**
 * Modal Escape stack. Each `useModalEscape` registration is pushed onto a
 * module-level stack on mount and popped on unmount. A single window-level
 * keydown listener invokes only the topmost registered callback when Escape
 * is pressed, so background modals don't fire alongside the foreground one.
 *
 * The stack is module-level so the topmost handler is unambiguous: position is
 * decided by mount order alone — a modal mounted later (rendered on top) wins,
 * and nothing an already-mounted modal does can move it.
 */

type EscapeHandler = () => void;

const stack: EscapeHandler[] = [];
let listenerAttached = false;

function ensureListener() {
    if (listenerAttached) return;
    listenerAttached = true;
    window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const top = stack[stack.length - 1];
        if (!top) return;
        e.preventDefault();
        e.stopPropagation();
        top();
    });
}

export function useModalEscape(onEscape: EscapeHandler | null | undefined): void {
    // The live callback, read at key-press time rather than captured at
    // registration time. Almost every caller passes an inline arrow, so the
    // callback is a new function on every render; registering on its identity
    // would pop and re-push the modal on every render, moving it back to the
    // TOP of the stack. A background modal that merely re-rendered would then
    // steal Escape from the modal in front of it — and because effects run
    // child-before-parent, the background one is the parent and always wins.
    // Stack position must depend on mount order alone.
    const latest = useRef(onEscape);
    useEffect(() => {
        latest.current = onEscape;
    });

    // Only whether a handler exists may move the modal in the stack: passing
    // null is how a caller says "I am closed", and re-opening genuinely does
    // belong on top.
    const active = onEscape != null;
    useEffect(() => {
        if (!active) return;
        ensureListener();
        // A per-registration entry, so two modals sharing one callback still
        // pop their own slot instead of each other's.
        const entry: EscapeHandler = () => latest.current?.();
        stack.push(entry);
        return () => {
            // Remove this registration. Search from the top to handle the
            // common LIFO case in O(1); fall back to filter if mismatched.
            const idx = stack.lastIndexOf(entry);
            if (idx >= 0) stack.splice(idx, 1);
        };
    }, [active]);
}
