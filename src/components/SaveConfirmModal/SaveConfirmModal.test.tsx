import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SaveConfirmModal } from './SaveConfirmModal';

describe('SaveConfirmModal', () => {
    const defaultProps = {
        fileName: 'test.txt',
        onSave: vi.fn(),
        onDiscard: vi.fn(),
        onCancel: vi.fn(),
    };

    it('renders with the file name in the message', () => {
        render(<SaveConfirmModal {...defaultProps} />);
        expect(screen.getByText(/test\.txt/)).toBeInTheDocument();
    });

    it('renders Save, Discard, and Cancel buttons', () => {
        render(<SaveConfirmModal {...defaultProps} />);
        expect(screen.getByText('Save')).toBeInTheDocument();
        expect(screen.getByText('Discard')).toBeInTheDocument();
        expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    it('renders "Unsaved Changes" title', () => {
        render(<SaveConfirmModal {...defaultProps} />);
        expect(screen.getByText('Unsaved Changes')).toBeInTheDocument();
    });

    it('clicking Save calls onSave', () => {
        const onSave = vi.fn();
        render(<SaveConfirmModal {...defaultProps} onSave={onSave} />);
        fireEvent.click(screen.getByText('Save'));
        expect(onSave).toHaveBeenCalledTimes(1);
    });

    it('clicking Discard calls onDiscard', () => {
        const onDiscard = vi.fn();
        render(<SaveConfirmModal {...defaultProps} onDiscard={onDiscard} />);
        fireEvent.click(screen.getByText('Discard'));
        expect(onDiscard).toHaveBeenCalledTimes(1);
    });

    it('clicking Cancel calls onCancel', () => {
        const onCancel = vi.fn();
        render(<SaveConfirmModal {...defaultProps} onCancel={onCancel} />);
        fireEvent.click(screen.getByText('Cancel'));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('pressing Escape calls onCancel', () => {
        const onCancel = vi.fn();
        render(<SaveConfirmModal {...defaultProps} onCancel={onCancel} />);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('auto-focuses the Cancel button', () => {
        render(<SaveConfirmModal {...defaultProps} />);
        expect(document.activeElement).toBe(screen.getByText('Cancel'));
    });
});
