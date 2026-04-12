import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FeaturesTab } from './FeaturesTab';

describe('FeaturesTab', () => {
  it('renders all feature labels', () => {
    render(<FeaturesTab />);
    expect(screen.getByText('AI Chat')).toBeTruthy();
    expect(screen.getByText('Log Viewer')).toBeTruthy();
    expect(screen.getByText('Ping Monitor')).toBeTruthy();
    expect(screen.getByText('Text Editor')).toBeTruthy();
    expect(screen.getByText('File Explorer')).toBeTruthy();
  });

  it('all checkboxes are checked and disabled', () => {
    render(<FeaturesTab />);
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBe(5);
    for (const cb of checkboxes) {
      expect(cb).toHaveProperty('checked', true);
      expect(cb).toHaveProperty('disabled', true);
    }
  });
});
