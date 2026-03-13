import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { useRef } from 'react';
import { useFocusTrap } from './useFocusTrap';

// JSDOM does not compute layout, so offsetParent is always null.
// Stub it to return document.body so useFocusTrap's visibility filter passes.
let originalOffsetParent: PropertyDescriptor | undefined;

beforeAll(() => {
    originalOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
        get() { return document.body; },
        configurable: true,
    });
});

afterAll(() => {
    if (originalOffsetParent) {
        Object.defineProperty(HTMLElement.prototype, 'offsetParent', originalOffsetParent);
    }
});

function TrapFixture({ active }: { active: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    useFocusTrap(ref, active);
    return (
        <div ref={ref}>
            <button>First</button>
            <button>Second</button>
            <button>Last</button>
        </div>
    );
}

describe('useFocusTrap — Tab key wrapping', () => {
    it('wraps Tab from last element to first', () => {
        const { getAllByRole } = render(<TrapFixture active={true} />);
        const buttons = getAllByRole('button');
        const last = buttons[buttons.length - 1];
        const first = buttons[0];

        last.focus();
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: false });

        expect(document.activeElement).toBe(first);
    });

    it('wraps Shift+Tab from first element to last', () => {
        const { getAllByRole } = render(<TrapFixture active={true} />);
        const buttons = getAllByRole('button');
        const first = buttons[0];
        const last = buttons[buttons.length - 1];

        first.focus();
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });

        expect(document.activeElement).toBe(last);
    });

    it('does not intercept Tab when active is false', () => {
        const { getAllByRole } = render(<TrapFixture active={false} />);
        const buttons = getAllByRole('button');
        const last = buttons[buttons.length - 1];

        last.focus();
        // With active=false, the listener is not attached — no wrapping occurs
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: false });

        // Focus stays on last (JSDOM does not advance focus on Tab by itself)
        expect(document.activeElement).toBe(last);
    });

    it('does not wrap non-Tab keys', () => {
        const { getAllByRole } = render(<TrapFixture active={true} />);
        const buttons = getAllByRole('button');
        const last = buttons[buttons.length - 1];

        last.focus();
        fireEvent.keyDown(document, { key: 'Enter' });

        expect(document.activeElement).toBe(last);
    });
});

describe('useFocusTrap — focus outside container', () => {
    it('Tab with focus outside container moves focus to first element', () => {
        const { getAllByRole, container } = render(
            <div>
                <button id="outside">Outside</button>
                <TrapFixture active={true} />
            </div>
        );
        const outside = container.querySelector('#outside') as HTMLElement;
        const trapButtons = getAllByRole('button').filter(b => b.id !== 'outside');
        const first = trapButtons[0];

        outside.focus();
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: false });

        expect(document.activeElement).toBe(first);
    });

    it('Shift+Tab with focus outside container moves focus to last element', () => {
        const { getAllByRole, container } = render(
            <div>
                <button id="outside">Outside</button>
                <TrapFixture active={true} />
            </div>
        );
        const outside = container.querySelector('#outside') as HTMLElement;
        const trapButtons = getAllByRole('button').filter(b => b.id !== 'outside');
        const last = trapButtons[trapButtons.length - 1];

        outside.focus();
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });

        expect(document.activeElement).toBe(last);
    });
});

describe('useFocusTrap — cleanup', () => {
    it('removes keydown listener when unmounted (no error thrown)', () => {
        const { unmount } = render(<TrapFixture active={true} />);
        unmount();
        // After unmount, the container is removed from the DOM.
        // Firing Tab should not throw (listener was cleaned up).
        expect(() => {
            fireEvent.keyDown(document, { key: 'Tab', shiftKey: false });
        }).not.toThrow();
    });
});
