import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { useDialogStack, __resetDialogStack, DIALOG_Z_BASE } from './useDialogStack';

function Probe({ open = true, label }: { open?: boolean; label: string }) {
    const { depth, zIndex, isTop } = useDialogStack(open);
    return (
        <div
            data-testid={label}
            data-depth={depth}
            data-z={zIndex}
            data-top={isTop ? 'yes' : 'no'}
        />
    );
}

const read = (el: HTMLElement) => ({
    depth: Number(el.dataset.depth),
    z: Number(el.dataset.z),
    isTop: el.dataset.top === 'yes',
});

describe('useDialogStack', () => {
    beforeEach(() => {
        __resetDialogStack();
    });

    it('puts a lone dialog on the base tier, in front', () => {
        const { getByTestId } = render(<Probe label="only" />);
        expect(read(getByTestId('only'))).toEqual({ depth: 0, z: DIALOG_Z_BASE, isTop: true });
    });

    it('stacks a second dialog above the first', () => {
        const { getByTestId } = render(
            <>
                <Probe label="base" />
                <Probe label="nested" />
            </>
        );
        expect(read(getByTestId('base'))).toEqual({ depth: 0, z: DIALOG_Z_BASE, isTop: false });
        expect(read(getByTestId('nested'))).toEqual({
            depth: 1,
            z: DIALOG_Z_BASE + 1,
            isTop: true,
        });
    });

    it('ranks by the order dialogs opened, not by where they are rendered', () => {
        // The second probe is nested *inside* the first in the tree, which in
        // React means it mounts first. Order still follows mount order, which is
        // what "the one opened last is in front" means here.
        function Outer() {
            useDialogStack(true);
            return <Probe label="inner" />;
        }
        const { getByTestId } = render(<Outer />);
        // The inner one mounted first, so the outer is in front of it.
        expect(read(getByTestId('inner')).isTop).toBe(false);
    });

    it('gives the front position back when the dialog above it closes', () => {
        const { getByTestId, rerender } = render(
            <>
                <Probe label="base" />
                <Probe label="nested" open />
            </>
        );
        expect(read(getByTestId('base')).isTop).toBe(false);

        rerender(
            <>
                <Probe label="base" />
                <Probe label="nested" open={false} />
            </>
        );

        expect(read(getByTestId('base'))).toEqual({ depth: 0, z: DIALOG_Z_BASE, isTop: true });
    });

    it('holds no slot while a mounted dialog is closed', () => {
        const { getByTestId } = render(
            <>
                <Probe label="closed" open={false} />
                <Probe label="open" />
            </>
        );
        expect(read(getByTestId('open'))).toEqual({ depth: 0, z: DIALOG_Z_BASE, isTop: true });
    });

    it('frees its slot on unmount', () => {
        const { unmount } = render(<Probe label="temp" />);
        unmount();
        const { getByTestId } = render(<Probe label="after" />);
        expect(read(getByTestId('after'))).toEqual({ depth: 0, z: DIALOG_Z_BASE, isTop: true });
    });

    it('keeps three dialogs in distinct tiers', () => {
        const { getByTestId } = render(
            <>
                <Probe label="a" />
                <Probe label="b" />
                <Probe label="c" />
            </>
        );
        expect(read(getByTestId('a')).z).toBe(DIALOG_Z_BASE);
        expect(read(getByTestId('b')).z).toBe(DIALOG_Z_BASE + 1);
        expect(read(getByTestId('c')).z).toBe(DIALOG_Z_BASE + 2);
        expect([
            read(getByTestId('a')).isTop,
            read(getByTestId('b')).isTop,
            read(getByTestId('c')).isTop,
        ]).toEqual([false, false, true]);
    });
});
