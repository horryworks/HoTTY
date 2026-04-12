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
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active: boolean) {
    useEffect(() => {
        if (!active) return;

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

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [containerRef, active]);
}
