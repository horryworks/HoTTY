import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ConnectingOverlay } from './ConnectingOverlay';

describe('ConnectingOverlay', () => {
  it('renders the displayName as the connection target', () => {
    const { getByText } = render(<ConnectingOverlay displayName="prod-db.example.com" />);
    expect(getByText('prod-db.example.com')).toBeTruthy();
    expect(getByText('Connecting to')).toBeTruthy();
  });

  it('marks itself as a polite live region for accessibility', () => {
    const { container } = render(<ConnectingOverlay displayName="x" />);
    const root = container.querySelector('.connecting-overlay');
    expect(root?.getAttribute('role')).toBe('status');
    expect(root?.getAttribute('aria-live')).toBe('polite');
  });

  it('renders three pulse dots', () => {
    const { container } = render(<ConnectingOverlay displayName="x" />);
    expect(container.querySelectorAll('.connecting-overlay-dot')).toHaveLength(3);
  });
});
