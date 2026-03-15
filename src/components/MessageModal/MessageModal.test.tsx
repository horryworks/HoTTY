import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageModal } from './MessageModal';

vi.mock('../../hooks/useDraggable', () => ({
    useDraggable: () => ({ position: { x: 0, y: 0 }, onMouseDown: vi.fn() })
}));

vi.mock('./MessageModal.css', () => ({}));

describe('MessageModal', () => {
    const baseProps = {
        type: 'error' as const,
        message: 'Something went wrong.',
        onClose: vi.fn(),
    };

    it('renders the message text', () => {
        render(<MessageModal {...baseProps} />);
        expect(screen.getByText('Something went wrong.')).toBeInTheDocument();
    });

    it('uses default title "Error" for error type', () => {
        render(<MessageModal {...baseProps} type="error" />);
        expect(screen.getByText('Error', { exact: false })).toBeInTheDocument();
    });

    it('uses default title "Success" for success type', () => {
        render(<MessageModal {...baseProps} type="success" />);
        expect(screen.getByText('Success', { exact: false })).toBeInTheDocument();
    });

    it('uses default title "Information" for info type', () => {
        render(<MessageModal {...baseProps} type="info" />);
        expect(screen.getByText('Information', { exact: false })).toBeInTheDocument();
    });

    it('renders a custom title when provided', () => {
        render(<MessageModal {...baseProps} title="Custom Title" />);
        expect(screen.getByText('Custom Title', { exact: false })).toBeInTheDocument();
    });

    it('clicking the Close button calls onClose', () => {
        const onClose = vi.fn();
        render(<MessageModal {...baseProps} onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('pressing Escape key calls onClose', () => {
        const onClose = vi.fn();
        render(<MessageModal {...baseProps} onClose={onClose} />);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('pressing Enter key calls onClose', () => {
        const onClose = vi.fn();
        render(<MessageModal {...baseProps} onClose={onClose} />);
        fireEvent.keyDown(window, { key: 'Enter' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
