import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useStripScroll } from './useStripScroll';

/** Give an element the layout geometry jsdom never computes. */
function setBox(el: HTMLElement, box: { scrollWidth?: number; clientWidth?: number; offsetLeft?: number; offsetWidth?: number }) {
    for (const [k, value] of Object.entries(box)) {
        Object.defineProperty(el, k, { value, configurable: true });
    }
}

/** Three 100px items in a 250px viewport: item 2 is clipped, item 3 is hidden. */
function layOutItems(strip: HTMLElement) {
    setBox(strip, { scrollWidth: 300, clientWidth: 250 });
    const items = Array.from(strip.children) as HTMLElement[];
    items.forEach((item, i) => setBox(item, { offsetLeft: i * 100, offsetWidth: 100 }));
    return items;
}

function Strip() {
    const { ref, handlers, atStart, atEnd, fits, scrollByStep, revealChild } = useStripScroll();
    return (
        <>
            <span data-testid="state">
                {[fits && 'fits', atStart && 'start', atEnd && 'end'].filter(Boolean).join(' ')}
            </span>
            <button data-testid="step-right" onClick={() => scrollByStep(1)} />
            <button data-testid="step-left" onClick={() => scrollByStep(-1)} />
            <button
                data-testid="reveal-last"
                onClick={() => {
                    const strip = document.querySelector('[data-testid="strip"]');
                    revealChild((strip?.lastElementChild as HTMLElement) ?? null);
                }}
            />
            <div data-testid="strip" ref={ref} {...handlers}>
                <div>a</div>
                <div>b</div>
                <div>c</div>
            </div>
        </>
    );
}

describe('useStripScroll', () => {
    it('turns a vertical wheel into horizontal scroll', () => {
        render(<Strip />);
        const strip = screen.getByTestId('strip');
        layOutItems(strip);
        strip.scrollLeft = 10;

        fireEvent.wheel(strip, { deltaY: 50 });
        // Most mice have no horizontal wheel, so the vertical one drives it.
        expect(strip.scrollLeft).toBe(60);
    });

    it('does not hijack the wheel when nothing overflows', () => {
        render(<Strip />);
        const strip = screen.getByTestId('strip');
        setBox(strip, { scrollWidth: 250, clientWidth: 250 });
        strip.scrollLeft = 0;

        fireEvent.wheel(strip, { deltaY: 50 });
        expect(strip.scrollLeft).toBe(0);
    });

    it('steps right by exactly one item, not a fixed distance', () => {
        render(<Strip />);
        const strip = screen.getByTestId('strip');
        layOutItems(strip);
        strip.scrollLeft = 0;

        fireEvent.click(screen.getByTestId('step-right'));
        // Item "b" spans 100..200 and the view is 250 wide, so the first item
        // NOT fully visible is "c" (200..300): align its right edge -> 300-250.
        expect(strip.scrollLeft).toBe(50);
    });

    it('steps left back to the previous item boundary', () => {
        render(<Strip />);
        const strip = screen.getByTestId('strip');
        layOutItems(strip);
        strip.scrollLeft = 150;

        fireEvent.click(screen.getByTestId('step-left'));
        // "b" starts at 100, which is left of the viewport: align to its left
        // edge rather than landing mid-item.
        expect(strip.scrollLeft).toBe(100);
    });

    it('clamps at the ends instead of overshooting', () => {
        render(<Strip />);
        const strip = screen.getByTestId('strip');
        layOutItems(strip);

        strip.scrollLeft = 50;
        fireEvent.click(screen.getByTestId('step-right'));
        expect(strip.scrollLeft).toBe(300);

        strip.scrollLeft = 0;
        fireEvent.click(screen.getByTestId('step-left'));
        expect(strip.scrollLeft).toBe(0);
    });

    it('reveals a child that is scrolled out of view', () => {
        render(<Strip />);
        const strip = screen.getByTestId('strip');
        layOutItems(strip);
        strip.scrollLeft = 0;

        fireEvent.click(screen.getByTestId('reveal-last'));
        // "c" ends at 300; the smallest scroll that shows all of it is 300-250.
        expect(strip.scrollLeft).toBe(50);
    });

    it('leaves a child alone when it is already visible', () => {
        render(<Strip />);
        const strip = screen.getByTestId('strip');
        layOutItems(strip);
        strip.scrollLeft = 50;

        fireEvent.click(screen.getByTestId('reveal-last'));
        expect(strip.scrollLeft).toBe(50);
    });

    it('tracks whether it fits and which edge it is at', () => {
        render(<Strip />);
        const strip = screen.getByTestId('strip');
        layOutItems(strip);

        // Re-measure by firing the scroll event the hook listens for.
        strip.scrollLeft = 0;
        act(() => {
            strip.dispatchEvent(new Event('scroll'));
        });
        expect(screen.getByTestId('state').textContent).toBe('start');

        strip.scrollLeft = 50;
        act(() => {
            strip.dispatchEvent(new Event('scroll'));
        });
        expect(screen.getByTestId('state').textContent).toBe('end');
    });
});
