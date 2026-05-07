import { type RefObject, useEffect } from 'react';

const FOCUSABLE_SELECTORS = [
    'a[href]',
    'button:not([disabled])',
    'textarea:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Traps Tab/Shift+Tab focus within `containerRef` while `active` is true.
 *
 * Also captures the element that had focus when the trap activated and
 * restores focus to it on deactivation, so closing a modal returns focus
 * to whatever the user was working on (input, button, terminal, …).
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active: boolean) {
    useEffect(() => {
        if (!active) return;

        const previouslyFocused =
            (document.activeElement as HTMLElement | null) ?? null;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Tab') return;
            const container = containerRef.current;
            if (!container) return;

            const focusable = Array.from(
                container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)
            ).filter(el => !el.closest('[hidden]') && el.offsetParent !== null);

            if (focusable.length === 0) return;

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const activeEl = document.activeElement;

            if (e.shiftKey) {
                if (activeEl === first || !container.contains(activeEl)) {
                    e.preventDefault();
                    last.focus();
                }
            } else {
                if (activeEl === last || !container.contains(activeEl)) {
                    e.preventDefault();
                    first.focus();
                }
            }
        };

        // Capture the container at effect-setup time. Reading
        // containerRef.current inside the cleanup function would race against
        // React unmounting the node and clearing the ref.
        const containerAtSetup = containerRef.current;

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            // Restore focus only if it is currently inside the (about-to-unmount)
            // container — otherwise the user may have already moved focus
            // intentionally and we shouldn't yank it back.
            const activeEl = document.activeElement as HTMLElement | null;
            const focusEscaped = !containerAtSetup || !activeEl || !containerAtSetup.contains(activeEl);
            if (!focusEscaped && previouslyFocused && document.contains(previouslyFocused)) {
                try {
                    previouslyFocused.focus();
                } catch {
                    /* element became unfocusable — ignore */
                }
            }
        };
    }, [containerRef, active]);
}
