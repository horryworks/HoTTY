import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PaneBadge } from './PaneBadge';

describe('PaneBadge', () => {
  it('shows a grid pane\'s number in that pane\'s color', () => {
    const { container } = render(<PaneBadge paneId="2" number={3} />);
    const badge = container.querySelector('.pane-badge') as HTMLElement;
    expect(badge.textContent).toBe('3');
    expect(badge.style.getPropertyValue('--pane-badge-color')).toBe('var(--pane-badge-3)');
    expect(badge.getAttribute('aria-label')).toBe('Pane 3');
  });

  it('shows an edge bar\'s number in the edge color', () => {
    const { container } = render(<PaneBadge paneId="bar-left" number={5} />);
    const badge = container.querySelector('.pane-badge') as HTMLElement;
    expect(badge.textContent).toBe('5');
    expect(badge.style.getPropertyValue('--pane-badge-color')).toBe('var(--pane-badge-edge)');
    expect(badge.getAttribute('aria-label')).toBe('Pane 5');
  });

  it('renders nothing for an unknown pane or a pane with no number', () => {
    expect(render(<PaneBadge paneId="nope" number={1} />).container.querySelector('.pane-badge')).toBeNull();
    expect(render(<PaneBadge paneId="bar-top" number={null} />).container.querySelector('.pane-badge')).toBeNull();
  });

  it('has a large form for an empty pane', () => {
    const { container } = render(<PaneBadge paneId="bar-bottom" number={6} variant="large" />);
    const badge = container.querySelector('.pane-badge-large') as HTMLElement;
    expect(badge.textContent).toBe('6');
  });
});
