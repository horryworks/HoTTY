import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import HelpModal from './HelpModal';

describe('HelpModal', () => {
    const baseProps = {
        isOpen: true,
        onClose: vi.fn(),
    };

    it('returns nothing when isOpen is false', () => {
        const { container } = render(<HelpModal isOpen={false} onClose={vi.fn()} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders "Help & Documentation" when open', () => {
        render(<HelpModal {...baseProps} />);
        expect(screen.getByText('Help & Documentation')).toBeInTheDocument();
    });

    it('clicking the close button calls onClose', () => {
        const onClose = vi.fn();
        render(<HelpModal {...baseProps} onClose={onClose} />);
        // The close button contains an SVG; locate it via its class
        const closeButton = document.querySelector('.settings-close') as HTMLElement;
        expect(closeButton).not.toBeNull();
        fireEvent.click(closeButton);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('renders the "Shortcuts" section', () => {
        render(<HelpModal {...baseProps} />);
        expect(screen.getByText(/Shortcuts/)).toBeInTheDocument();
    });
});
