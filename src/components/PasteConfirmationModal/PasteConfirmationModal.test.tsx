import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PasteConfirmationModal } from './PasteConfirmationModal';

vi.mock('../../hooks/useDraggable', () => ({
    useDraggable: () => ({ position: { x: 0, y: 0 }, onMouseDown: vi.fn() })
}));

vi.mock('./PasteConfirmationModal.css', () => ({}));

describe('PasteConfirmationModal', () => {
    const baseProps = {
        content: 'hello world',
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
    };

    it('renders the "Paste Confirmation" title', () => {
        render(<PasteConfirmationModal {...baseProps} />);
        expect(screen.getByText('Paste Confirmation')).toBeInTheDocument();
    });

    it('renders the content text', () => {
        render(<PasteConfirmationModal {...baseProps} content="hello world" />);
        expect(screen.getByText('hello world')).toBeInTheDocument();
    });

    it('shows the newline warning when content contains \\n', () => {
        render(<PasteConfirmationModal {...baseProps} content={'line1\nline2'} />);
        expect(screen.getByText(/Warning: Contains newline characters/)).toBeInTheDocument();
    });

    it('does NOT show the newline warning when content has no newlines', () => {
        render(<PasteConfirmationModal {...baseProps} content="no newlines here" />);
        expect(screen.queryByText(/Warning: Contains newline characters/)).not.toBeInTheDocument();
    });

    it('clicking Paste calls onConfirm', () => {
        const onConfirm = vi.fn();
        render(<PasteConfirmationModal {...baseProps} onConfirm={onConfirm} />);
        fireEvent.click(screen.getByRole('button', { name: 'Paste' }));
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('clicking Cancel calls onCancel', () => {
        const onCancel = vi.fn();
        render(<PasteConfirmationModal {...baseProps} onCancel={onCancel} />);
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('pressing Enter calls onConfirm', () => {
        const onConfirm = vi.fn();
        render(<PasteConfirmationModal {...baseProps} onConfirm={onConfirm} />);
        fireEvent.keyDown(window, { key: 'Enter' });
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('pressing Escape calls onCancel', () => {
        const onCancel = vi.fn();
        render(<PasteConfirmationModal {...baseProps} onCancel={onCancel} />);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});
