import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ScrollStrip } from './ScrollStrip';

function setBox(
    el: HTMLElement,
    box: { scrollWidth?: number; clientWidth?: number; offsetLeft?: number; offsetWidth?: number },
) {
    for (const [k, value] of Object.entries(box)) {
        Object.defineProperty(el, k, { value, configurable: true });
    }
}

function renderStrip() {
    const result = render(
        <ScrollStrip className="test-strip">
            <div>a</div>
            <div>b</div>
            <div>c</div>
        </ScrollStrip>,
    );
    return result;
}

/** Make the strip overflow and re-measure by firing the scroll event. */
function overflow(scrollLeft = 0) {
    const strip = document.querySelector('.test-strip') as HTMLElement;
    setBox(strip, { scrollWidth: 300, clientWidth: 250 });
    Array.from(strip.children).forEach((c, i) =>
        setBox(c as HTMLElement, { offsetLeft: i * 100, offsetWidth: 100 }),
    );
    strip.scrollLeft = scrollLeft;
    act(() => {
        strip.dispatchEvent(new Event('scroll'));
    });
    return strip;
}

afterEach(() => {
    vi.useRealTimers();
});

describe('ScrollStrip', () => {
    it('shows no arrows while everything fits', () => {
        renderStrip();
        // A short row must look exactly as it did before this component existed.
        expect(screen.queryByLabelText('Scroll tabs left')).toBeNull();
        expect(screen.queryByLabelText('Scroll tabs right')).toBeNull();
    });

    it('shows both arrows once the row overflows', () => {
        renderStrip();
        overflow();
        expect(screen.getByLabelText('Scroll tabs left')).toBeTruthy();
        expect(screen.getByLabelText('Scroll tabs right')).toBeTruthy();
    });

    it('disables the arrow pointing at the edge already reached', () => {
        renderStrip();
        overflow(0);
        expect((screen.getByLabelText('Scroll tabs left') as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByLabelText('Scroll tabs right') as HTMLButtonElement).disabled).toBe(
            false,
        );

        overflow(50);
        expect((screen.getByLabelText('Scroll tabs left') as HTMLButtonElement).disabled).toBe(
            false,
        );
        expect((screen.getByLabelText('Scroll tabs right') as HTMLButtonElement).disabled).toBe(
            true,
        );
    });

    it('scrolls one item per press', () => {
        renderStrip();
        const strip = overflow(0);
        fireEvent.pointerDown(screen.getByLabelText('Scroll tabs right'));
        expect(strip.scrollLeft).toBe(50);
    });

    it('repeats while the button is held, then stops on release', () => {
        vi.useFakeTimers();
        renderStrip();
        const strip = overflow(0);
        const right = screen.getByLabelText('Scroll tabs right');

        fireEvent.pointerDown(right);
        expect(strip.scrollLeft).toBe(50);

        // A short press must move exactly one item — the repeat only starts
        // after the hold delay.
        act(() => {
            vi.advanceTimersByTime(200);
        });
        expect(strip.scrollLeft).toBe(50);

        strip.scrollLeft = 0;
        act(() => {
            vi.advanceTimersByTime(200 + 120 * 2);
        });
        expect(strip.scrollLeft).toBeGreaterThan(0);

        fireEvent.pointerUp(right);
        const settled = strip.scrollLeft;
        act(() => {
            vi.advanceTimersByTime(1000);
        });
        expect(strip.scrollLeft).toBe(settled);
    });

    it('stops repeating when the pointer leaves the button', () => {
        vi.useFakeTimers();
        renderStrip();
        const strip = overflow(0);
        const right = screen.getByLabelText('Scroll tabs right');

        fireEvent.pointerDown(right);
        fireEvent.pointerLeave(right);
        strip.scrollLeft = 0;
        act(() => {
            vi.advanceTimersByTime(2000);
        });
        expect(strip.scrollLeft).toBe(0);
    });

    it('marks the scrolling element so the edge fades apply', () => {
        renderStrip();
        const strip = overflow(0);
        expect(strip.className).toContain('scroll-strip');
        expect(strip.className).toContain('scrollable');
        expect(strip.className).toContain('at-start');
        expect(strip.className).not.toContain('at-end');
    });

    it('passes through the caller class, role and keyboard handler', () => {
        const onKeyDown = vi.fn();
        render(
            <ScrollStrip
                className="test-strip"
                role="tablist"
                ariaLabel="Tabs"
                tabIndex={0}
                onKeyDown={onKeyDown}
            >
                <div>a</div>
            </ScrollStrip>,
        );
        const strip = screen.getByRole('tablist');
        expect(strip.className).toContain('test-strip');
        expect(strip.getAttribute('aria-label')).toBe('Tabs');
        fireEvent.keyDown(strip, { key: 'ArrowRight' });
        expect(onKeyDown).toHaveBeenCalled();
    });
});
