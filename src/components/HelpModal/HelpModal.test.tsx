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

    it('renders the AI Quick Start Guide section', () => {
        render(<HelpModal {...baseProps} />);
        expect(screen.getByText(/AI Quick Start Guide/)).toBeInTheDocument();
    });

    it('renders the AI Features Overview section', () => {
        render(<HelpModal {...baseProps} />);
        expect(screen.getByText(/AI Features Overview/)).toBeInTheDocument();
    });

    it('renders the Choosing an AI Provider section with experimental notices', () => {
        render(<HelpModal {...baseProps} />);
        expect(screen.getByText(/Choosing an AI Provider/)).toBeInTheDocument();
        // Verify experimental/untested notices are present for Anthropic and OpenAI
        const experimentalLabels = screen.getAllByText(/untested/);
        expect(experimentalLabels.length).toBeGreaterThanOrEqual(2);
    });

    it('renders the AI Setup & Authentication section', () => {
        render(<HelpModal {...baseProps} />);
        expect(screen.getByText(/AI Setup & Authentication/)).toBeInTheDocument();
    });
});
