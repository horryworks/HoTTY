import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PaneBadge } from './PaneBadge';

describe('PaneBadge', () => {
  it('numbers a grid pane from 1 in that pane\'s color', () => {
    const { container } = render(<PaneBadge paneId="2" />);
    const badge = container.querySelector('.pane-badge') as HTMLElement;
    expect(badge.textContent).toBe('3');
    expect(badge.style.getPropertyValue('--pane-badge-color')).toBe('var(--pane-badge-3)');
    expect(badge.getAttribute('aria-label')).toBe('Pane 3');
  });

  it('marks an edge bar by its edge in the edge color', () => {
    const { container } = render(<PaneBadge paneId="bar-left" />);
    const badge = container.querySelector('.pane-badge') as HTMLElement;
    expect(badge.textContent).toBe('L');
    expect(badge.style.getPropertyValue('--pane-badge-color')).toBe('var(--pane-badge-edge)');
  });

  it('renders nothing for an unknown pane', () => {
    const { container } = render(<PaneBadge paneId="nope" />);
    expect(container.querySelector('.pane-badge')).toBeNull();
  });

  it('has a large form that names the pane for an empty one', () => {
    const { container } = render(<PaneBadge paneId="2" variant="large" />);
    const badge = container.querySelector('.pane-badge-large') as HTMLElement;
    expect(badge.textContent).toBe('3');
    expect(badge.getAttribute('aria-label')).toBe('Pane 3');
  });
});
