import { useEffect } from 'react';

/**
 * Modal Escape stack. Each `useModalEscape` registration is pushed onto a
 * module-level stack on mount and popped on unmount. A single window-level
 * keydown listener invokes only the topmost registered callback when Escape
 * is pressed, so background modals don't fire alongside the foreground one.
 *
 * The stack is module-level so the topmost handler is unambiguous regardless
 * of mount order — modals pushed later (rendered on top) win.
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
    useEffect(() => {
        if (!onEscape) return;
        ensureListener();
        stack.push(onEscape);
        return () => {
            // Remove this registration. Search from the top to handle the
            // common LIFO case in O(1); fall back to filter if mismatched.
            const idx = stack.lastIndexOf(onEscape);
            if (idx >= 0) stack.splice(idx, 1);
        };
    }, [onEscape]);
}
