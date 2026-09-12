import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { useDragSafeClick, useOverlayDismiss } from './useDragSafeClick';

/** Overlay wrapping a dialog box, which in turn holds a resize grip. */
function Overlay({ onDismiss }: { onDismiss: (() => void) | null }) {
    const props = useOverlayDismiss<HTMLDivElement>(onDismiss);
    return (
        <div data-testid="overlay" {...props}>
            {/* No stopPropagation here on purpose: the press check replaces it. */}
            <div data-testid="box">
                <div
                    data-testid="grip"
                    // Mirrors useResize.startResize, which swallows the mousedown.
                    onMouseDown={(e) => e.stopPropagation()}
                />
            </div>
        </div>
    );
}

function Guarded({ onClick }: { onClick: () => void }) {
    const props = useDragSafeClick<HTMLDivElement>(onClick);
    return (
        <div data-testid="outer" {...props}>
            <button data-testid="inner">inner</button>
        </div>
    );
}

describe('useDragSafeClick', () => {
    it('runs the handler when the press and the click are on the same element', () => {
        const onClick = vi.fn();
        const { getByTestId } = render(<Guarded onClick={onClick} />);
        const outer = getByTestId('outer');

        fireEvent.mouseDown(outer);
        fireEvent.click(outer);
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('ignores the click a drag leaves behind', () => {
        const onClick = vi.fn();
        const { getByTestId } = render(<Guarded onClick={onClick} />);

        // Pressed on the child, released elsewhere: the click surfaces on the
        // common ancestor, which is the guarded element itself.
        fireEvent.mouseDown(getByTestId('inner'));
        fireEvent.click(getByTestId('outer'));
        expect(onClick).not.toHaveBeenCalled();
    });

    it('ignores a click with no press before it (keyboard activation)', () => {
        const onClick = vi.fn();
        const { getByTestId } = render(<Guarded onClick={onClick} />);

        fireEvent.click(getByTestId('outer'));
        expect(onClick).not.toHaveBeenCalled();
    });

    it('ignores a non-primary button press', () => {
        const onClick = vi.fn();
        const { getByTestId } = render(<Guarded onClick={onClick} />);
        const outer = getByTestId('outer');

        fireEvent.mouseDown(outer, { button: 2 });
        fireEvent.click(outer);
        expect(onClick).not.toHaveBeenCalled();
    });
});

describe('useOverlayDismiss', () => {
    it('dismisses when the press and the click are both on the overlay', () => {
        const onDismiss = vi.fn();
        const { getByTestId } = render(<Overlay onDismiss={onDismiss} />);
        const overlay = getByTestId('overlay');

        fireEvent.mouseDown(overlay);
        fireEvent.click(overlay);
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('does not dismiss on a click inside the dialog', () => {
        const onDismiss = vi.fn();
        const { getByTestId } = render(<Overlay onDismiss={onDismiss} />);

        fireEvent.mouseDown(getByTestId('box'));
        fireEvent.click(getByTestId('box'));
        expect(onDismiss).not.toHaveBeenCalled();
    });

    it('does not dismiss when a drag started on the grip and ended on the overlay', () => {
        const onDismiss = vi.fn();
        const { getByTestId } = render(<Overlay onDismiss={onDismiss} />);

        // The grip swallows the mousedown, exactly as useResize does. The
        // capture-phase listener still sees it, so the stale-target trap the
        // bubble phase would fall into does not happen here.
        fireEvent.mouseDown(getByTestId('grip'));
        // Released off the dialog: the click lands on the overlay.
        fireEvent.click(getByTestId('overlay'));
        expect(onDismiss).not.toHaveBeenCalled();
    });

    it('stays inert when no dismiss handler is given', () => {
        const { getByTestId } = render(<Overlay onDismiss={null} />);
        const overlay = getByTestId('overlay');

        fireEvent.mouseDown(overlay);
        expect(() => fireEvent.click(overlay)).not.toThrow();
    });
});
