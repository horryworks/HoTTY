import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContextGauge } from './ContextGauge';

describe('ContextGauge', () => {
    it('shows the rounded percentage and the exact counts in its label', () => {
        render(<ContextGauge used={50_000} limit={200_000} />);
        const gauge = screen.getByRole('img', { name: 'Context: 50,000 / 200,000 tokens (25%)' });
        expect(gauge.textContent).toBe('25%');
        expect(gauge.className).toContain('ai-chat-context--ok');
    });

    it('turns to warning at 80% and danger at 95%', () => {
        const { rerender } = render(<ContextGauge used={160_000} limit={200_000} />);
        expect(screen.getByRole('img').className).toContain('ai-chat-context--warn');
        rerender(<ContextGauge used={190_000} limit={200_000} />);
        expect(screen.getByRole('img').className).toContain('ai-chat-context--danger');
    });

    it('caps the pie at 100% when usage exceeds the window', () => {
        render(<ContextGauge used={300_000} limit={200_000} />);
        expect(screen.getByRole('img').textContent).toBe('100%');
    });
});
