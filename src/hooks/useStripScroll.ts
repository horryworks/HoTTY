import { useCallback, useEffect, useRef, useState } from 'react';

export interface StripScrollState {
    /** Attach to the scrolling container. */
    ref: React.RefObject<HTMLDivElement | null>;
    /** Spread onto the container. */
    handlers: {
        onWheel: (e: React.WheelEvent) => void;
    };
    /** False once the content is scrolled away from the left edge. */
    atStart: boolean;
    /** False while there is still content to the right. */
    atEnd: boolean;
    /** True when the content does not overflow — no arrows, no fades. */
    fits: boolean;
    /** Scroll one item further in `dir` (1 = right, -1 = left). */
    scrollByStep: (dir: 1 | -1) => void;
    /** Scroll an element inside the container into view. */
    revealChild: (child: HTMLElement | null) => void;
}

/**
 * Horizontal scrolling for a strip that overflows — the tab rows.
 *
 * Deliberately NOT drag-to-scroll. The terminal tab bar reorders tabs by
 * dragging them, so a drag there cannot also mean "scroll"; rather than have
 * one strip behave differently from the other two, every strip scrolls the same
 * way: the arrow buttons `ScrollStrip` renders, the wheel, and the arrow keys
 * (`useTabKeyboardNav`).
 *
 * A vertical wheel is translated into horizontal scroll, since most mice have
 * no horizontal wheel.
 */
export function useStripScroll(): StripScrollState {
    const ref = useRef<HTMLDivElement | null>(null);
    const [atStart, setAtStart] = useState(true);
    const [atEnd, setAtEnd] = useState(true);
    const [fits, setFits] = useState(true);

    const measure = useCallback(() => {
        const el = ref.current;
        if (!el) return;
        const max = el.scrollWidth - el.clientWidth;
        // 1px of slack: fractional layout widths otherwise leave `atEnd` false
        // forever and the arrow never turns off.
        setFits(max <= 1);
        setAtStart(el.scrollLeft <= 1);
        setAtEnd(el.scrollLeft >= max - 1);
    }, []);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        measure();
        el.addEventListener('scroll', measure, { passive: true });
        // Re-measure when the strip resizes (window resize, sidebar toggle) and
        // when tabs are added or removed.
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        for (const child of Array.from(el.children)) observer.observe(child);
        return () => {
            el.removeEventListener('scroll', measure);
            observer.disconnect();
        };
    }, [measure]);

    const onWheel = useCallback((e: React.WheelEvent) => {
        const el = ref.current;
        if (!el || el.scrollWidth <= el.clientWidth) return;
        if (e.deltaY === 0) return;
        el.scrollLeft += e.deltaY;
    }, []);

    /**
     * Move by one item, not by a fixed number of pixels: landing halfway
     * through a tab is what makes a scrolling tab strip feel broken.
     */
    const scrollByStep = useCallback((dir: 1 | -1) => {
        const el = ref.current;
        if (!el) return;
        const children = Array.from(el.children) as HTMLElement[];
        const viewLeft = el.scrollLeft;
        const viewRight = viewLeft + el.clientWidth;

        if (dir > 0) {
            // The first item not fully visible on the right; align its right edge.
            const next = children.find((c) => c.offsetLeft + c.offsetWidth > viewRight + 1);
            el.scrollLeft = next
                ? next.offsetLeft + next.offsetWidth - el.clientWidth
                : el.scrollWidth;
        } else {
            // The last item not fully visible on the left; align its left edge.
            const prev = children.filter((c) => c.offsetLeft < viewLeft - 1).pop();
            el.scrollLeft = prev ? prev.offsetLeft : 0;
        }
    }, []);

    const revealChild = useCallback((child: HTMLElement | null) => {
        const el = ref.current;
        if (!el || !child) return;
        // Deliberately not `scrollIntoView`: inside a modal that can scroll the
        // dialog itself, and in some browsers the page behind it.
        const left = child.offsetLeft;
        const right = left + child.offsetWidth;
        if (left < el.scrollLeft) {
            el.scrollLeft = left;
        } else if (right > el.scrollLeft + el.clientWidth) {
            el.scrollLeft = right - el.clientWidth;
        }
    }, []);

    return {
        ref,
        handlers: { onWheel },
        atStart,
        atEnd,
        fits,
        scrollByStep,
        revealChild,
    };
}
