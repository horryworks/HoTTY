import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmModal } from './ConfirmModal';

vi.mock('../../hooks/useDraggable', () => ({
    useDraggable: () => ({ position: { x: 0, y: 0 }, onMouseDown: vi.fn() })
}));

vi.mock('./ConfirmModal.css', () => ({}));

describe('ConfirmModal', () => {
    const baseProps = {
        message: 'Are you sure you want to delete this?',
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
    };

    it('renders the message text', () => {
        render(<ConfirmModal {...baseProps} />);
        expect(screen.getByText('Are you sure you want to delete this?')).toBeInTheDocument();
    });

    it('renders the default title "Confirm" when no title prop is provided', () => {
        render(<ConfirmModal {...baseProps} />);
        expect(screen.getByText('Confirm', { exact: false })).toBeInTheDocument();
    });

    it('renders a custom title when provided', () => {
        render(<ConfirmModal {...baseProps} title="Delete Host" />);
        expect(screen.getByText('Delete Host', { exact: false })).toBeInTheDocument();
    });

    it('clicking the Cancel button calls onCancel', () => {
        const onCancel = vi.fn();
        render(<ConfirmModal {...baseProps} onCancel={onCancel} />);
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('clicking the Delete button calls onConfirm', () => {
        const onConfirm = vi.fn();
        render(<ConfirmModal {...baseProps} onConfirm={onConfirm} />);
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('pressing Escape key calls onCancel', () => {
        const onCancel = vi.fn();
        render(<ConfirmModal {...baseProps} onCancel={onCancel} />);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('Cancel button is focused on mount', () => {
        render(<ConfirmModal {...baseProps} />);
        expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    });
});
