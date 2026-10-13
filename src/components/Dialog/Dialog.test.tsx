import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Dialog, type DialogGeometry } from './Dialog';
import { __resetDialogStack, DIALOG_Z_BASE } from '../../hooks/useDialogStack';
import { useSettingsStore } from '../../stores/settingsStore';

const GEOMETRY: DialogGeometry = {
    persistKey: 'help',
    defaultSize: { width: 600, height: 400 },
    minSize: { width: 300, height: 200 },
};

/** The backdrop is the dialog's parent element. */
const overlayOf = (dialog: HTMLElement) => dialog.parentElement as HTMLElement;

describe('Dialog', () => {
    beforeEach(() => {
        __resetDialogStack();
        useSettingsStore.setState({ dialogSizes: {} });
    });

    it('renders nothing while closed', () => {
        render(<Dialog open={false} onClose={vi.fn()} title="Hidden">body</Dialog>);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.queryByText('body')).toBeNull();
    });

    it('renders a modal dialog labelled by its title, with body and footer', () => {
        render(
            <Dialog open onClose={vi.fn()} title="Rename host" footer={<button>Save</button>}>
                <p>Form goes here</p>
            </Dialog>
        );
        const dialog = screen.getByRole('dialog', { name: 'Rename host' });
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(screen.getByText('Form goes here')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    });

    it('renders no footer row when no footer is given', () => {
        render(<Dialog open onClose={vi.fn()} title="Info">body</Dialog>);
        expect(screen.getByRole('dialog').querySelector('.dlg-footer')).toBeNull();
    });

    it('closes from the close button, and hides it when asked to', () => {
        const onClose = vi.fn();
        const { rerender } = render(<Dialog open onClose={onClose} title="Info">body</Dialog>);
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(onClose).toHaveBeenCalledTimes(1);

        rerender(<Dialog open onClose={onClose} title="Info" showClose={false}>body</Dialog>);
        expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    });

    it('closes on Escape', () => {
        const onClose = vi.fn();
        render(<Dialog open onClose={onClose} title="Info">body</Dialog>);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('sends Escape only to the dialog in front', () => {
        const outer = vi.fn();
        const inner = vi.fn();
        render(
            <>
                <Dialog open onClose={outer} title="Outer">outer</Dialog>
                <Dialog open onClose={inner} title="Inner">inner</Dialog>
            </>
        );
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(inner).toHaveBeenCalledTimes(1);
        expect(outer).not.toHaveBeenCalled();
    });

    it('stacks a second dialog above the first', () => {
        render(
            <>
                <Dialog open onClose={vi.fn()} title="Outer">outer</Dialog>
                <Dialog open onClose={vi.fn()} title="Inner">inner</Dialog>
            </>
        );
        const outer = overlayOf(screen.getByRole('dialog', { name: 'Outer' }));
        const inner = overlayOf(screen.getByRole('dialog', { name: 'Inner' }));
        expect(outer.style.zIndex).toBe(String(DIALOG_Z_BASE));
        expect(inner.style.zIndex).toBe(String(DIALOG_Z_BASE + 1));
    });

    it('ignores a backdrop click by default, so a form is never lost', () => {
        const onClose = vi.fn();
        render(<Dialog open onClose={onClose} title="Form">body</Dialog>);
        const overlay = overlayOf(screen.getByRole('dialog'));
        fireEvent.mouseDown(overlay);
        fireEvent.click(overlay);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('closes on a backdrop click when opted in, but not on a click inside or a drag out', () => {
        const onClose = vi.fn();
        render(
            <Dialog open onClose={onClose} title="Preview" dismissOnOutsideClick>
                <p>inside</p>
            </Dialog>
        );
        const overlay = overlayOf(screen.getByRole('dialog'));

        fireEvent.mouseDown(screen.getByText('inside'));
        fireEvent.click(screen.getByText('inside'));
        expect(onClose).not.toHaveBeenCalled();

        // A drag that began inside the dialog and ended on the backdrop.
        fireEvent.mouseDown(screen.getByText('inside'));
        fireEvent.click(overlay);
        expect(onClose).not.toHaveBeenCalled();

        fireEvent.mouseDown(overlay);
        fireEvent.click(overlay);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('lets only the dialog in front close from its backdrop', () => {
        const outer = vi.fn();
        render(
            <>
                <Dialog open onClose={outer} title="Outer" dismissOnOutsideClick>outer</Dialog>
                <Dialog open onClose={vi.fn()} title="Inner">inner</Dialog>
            </>
        );
        const overlay = overlayOf(screen.getByRole('dialog', { name: 'Outer' }));
        fireEvent.mouseDown(overlay);
        fireEvent.click(overlay);
        expect(outer).not.toHaveBeenCalled();
    });

    it('applies a fixed or bounded width and the warning tone', () => {
        const { rerender } = render(
            <Dialog open onClose={vi.fn()} title="Delete" width={520} tone="warning">body</Dialog>
        );
        const dialog = screen.getByRole('dialog');
        expect(dialog.style.width).toBe('520px');
        expect(dialog.classList.contains('dlg-warning')).toBe(true);

        rerender(
            <Dialog open onClose={vi.fn()} title="Delete" width={{ width: '90%', minWidth: 320, maxWidth: 460 }}>
                body
            </Dialog>
        );
        expect(dialog.style.width).toBe('90%');
        expect(dialog.style.minWidth).toBe('320px');
        expect(dialog.style.maxWidth).toBe('460px');
        expect(dialog.classList.contains('dlg-warning')).toBe(false);
    });

    it('takes keyboard focus on open', async () => {
        render(<Dialog open onClose={vi.fn()} title="Info">body</Dialog>);
        await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('dialog')));
    });

    it('leaves focus on a field inside that already has it', async () => {
        render(
            <Dialog open onClose={vi.fn()} title="Rename">
                <input aria-label="Name" autoFocus />
            </Dialog>
        );
        const field = screen.getByLabelText('Name');
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        expect(document.activeElement).toBe(field);
    });

    it('starts a movable dialog at its remembered size, ignoring width', () => {
        useSettingsStore.setState({ dialogSizes: { help: { width: 700, height: 500 } } });
        render(
            <Dialog open onClose={vi.fn()} title="Help" width={300} geometry={GEOMETRY}>body</Dialog>
        );
        const dialog = screen.getByRole('dialog');
        expect(dialog.style.width).toBe('700px');
        expect(dialog.style.height).toBe('500px');
    });

    it('remembers the size a resize drag ends at', () => {
        render(<Dialog open onClose={vi.fn()} title="Help" geometry={GEOMETRY}>body</Dialog>);
        const corner = screen.getByRole('dialog').querySelector('.drf-se') as HTMLElement;
        fireEvent.pointerDown(corner, { button: 0, clientX: 100, clientY: 100 });
        fireEvent.pointerMove(window, { clientX: 150, clientY: 130 });
        fireEvent.pointerUp(window);
        expect(useSettingsStore.getState().dialogSizes.help).toEqual({ width: 650, height: 430 });
    });

    it('forgets the remembered size on a double-click of the corner', () => {
        useSettingsStore.setState({ dialogSizes: { help: { width: 700, height: 500 } } });
        render(<Dialog open onClose={vi.fn()} title="Help" geometry={GEOMETRY}>body</Dialog>);
        const dialog = screen.getByRole('dialog');
        fireEvent.doubleClick(dialog.querySelector('.drf-se') as HTMLElement);
        // The key is dropped, not set to the default, so "never resized" stays visible.
        expect('help' in useSettingsStore.getState().dialogSizes).toBe(false);
        expect(dialog.style.width).toBe('600px');
    });
});
