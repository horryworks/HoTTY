import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import HelpTooltip from './HelpTooltip';

describe('HelpTooltip', () => {
    it('renders the ? icon', () => {
        const { container } = render(<HelpTooltip text="Test help text" />);
        const icon = container.querySelector('.help-tooltip-icon');
        expect(icon).toBeInTheDocument();
        expect(icon?.textContent).toBe('?');
    });

    it('does not show tooltip content by default', () => {
        render(<HelpTooltip text="Some description" />);
        const content = document.body.querySelector('.help-tooltip-content');
        expect(content).not.toBeInTheDocument();
    });

    it('shows tooltip content on mouse enter via portal', () => {
        const { container } = render(<HelpTooltip text="Some description" />);
        const wrapper = container.querySelector('.help-tooltip') as HTMLElement;
        fireEvent.mouseEnter(wrapper);
        const content = document.body.querySelector('.help-tooltip-content');
        expect(content).toBeInTheDocument();
        expect(content?.textContent).toBe('Some description');
    });

    it('hides tooltip content on mouse leave', () => {
        const { container } = render(<HelpTooltip text="Some description" />);
        const wrapper = container.querySelector('.help-tooltip') as HTMLElement;
        fireEvent.mouseEnter(wrapper);
        expect(document.body.querySelector('.help-tooltip-content')).toBeInTheDocument();
        fireEvent.mouseLeave(wrapper);
        expect(document.body.querySelector('.help-tooltip-content')).not.toBeInTheDocument();
    });

    it('supports ReactNode as text prop', () => {
        const { container } = render(
            <HelpTooltip text={<span data-testid="custom">Custom content</span>} />
        );
        const wrapper = container.querySelector('.help-tooltip') as HTMLElement;
        fireEvent.mouseEnter(wrapper);
        const content = document.body.querySelector('.help-tooltip-content');
        expect(content?.querySelector('[data-testid="custom"]')).toBeInTheDocument();
    });

    it('prevents default on click to avoid checkbox toggle', () => {
        const { container } = render(<HelpTooltip text="Test" />);
        const wrapper = container.querySelector('.help-tooltip') as HTMLElement;
        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        wrapper.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
    });
});
