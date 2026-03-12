import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

// A component that throws on demand
function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
    if (shouldThrow) throw new Error('Test explosion');
    return <div>OK</div>;
}

// Suppress console.error noise from intentional throws
beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('ErrorBoundary', () => {
    it('renders children when no error', () => {
        render(
            <ErrorBoundary>
                <div>normal content</div>
            </ErrorBoundary>
        );
        expect(screen.getByText('normal content')).toBeInTheDocument();
    });

    it('shows fallback UI when child throws', () => {
        render(
            <ErrorBoundary fallbackLabel="Test Pane">
                <Bomb shouldThrow={true} />
            </ErrorBoundary>
        );
        expect(screen.getByText('Test Pane crashed')).toBeInTheDocument();
        expect(screen.getByText('Test explosion')).toBeInTheDocument();
    });

    it('shows default label when fallbackLabel is not provided', () => {
        render(
            <ErrorBoundary>
                <Bomb shouldThrow={true} />
            </ErrorBoundary>
        );
        expect(screen.getByText('Component crashed')).toBeInTheDocument();
    });

    it('shows Retry button in fallback UI', () => {
        render(
            <ErrorBoundary>
                <Bomb shouldThrow={true} />
            </ErrorBoundary>
        );
        expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    it('resets and re-renders children after clicking Retry', () => {
        // Use a wrapper that controls shouldThrow via a ref so we can change it
        // before the ErrorBoundary resets (otherwise Bomb would throw again on retry).
        let triggerThrow = true;

        function ControlledBomb() {
            if (triggerThrow) throw new Error('Test explosion');
            return <div>OK</div>;
        }

        const { rerender } = render(
            <ErrorBoundary>
                <ControlledBomb />
            </ErrorBoundary>
        );

        expect(screen.getByText('Component crashed')).toBeInTheDocument();

        // Stop throwing, then click Retry
        triggerThrow = false;
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

        // Force a rerender so the ErrorBoundary re-evaluates with the new child behavior
        rerender(
            <ErrorBoundary>
                <ControlledBomb />
            </ErrorBoundary>
        );

        expect(screen.getByText('OK')).toBeInTheDocument();
    });
});
