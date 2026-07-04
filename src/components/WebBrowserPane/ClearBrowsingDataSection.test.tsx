import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClearBrowsingDataSection } from './ClearBrowsingDataSection';

describe('ClearBrowsingDataSection', () => {
  it('lists every category, all selected by default (full reset)', () => {
    render(<ClearBrowsingDataSection onClear={() => {}} />);
    expect(screen.getByText('Clear browsing data')).toBeTruthy();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(5);
    for (const box of boxes) expect(box).toHaveProperty('checked', true);
  });

  it('passes the exact selection to onClear', () => {
    const onClear = vi.fn();
    render(<ClearBrowsingDataSection onClear={onClear} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Saved passwords' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClear).toHaveBeenCalledWith({
      cookiesAndSiteData: true,
      cache: true,
      history: true,
      passwords: false,
      autofill: true,
    });
  });

  it('disables Clear when no category is selected', () => {
    const onClear = vi.fn();
    render(<ClearBrowsingDataSection onClear={onClear} />);
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
    const btn = screen.getByRole('button', { name: 'Clear' });
    expect(btn).toHaveProperty('disabled', true);
    fireEvent.click(btn);
    expect(onClear).not.toHaveBeenCalled();
  });
});
