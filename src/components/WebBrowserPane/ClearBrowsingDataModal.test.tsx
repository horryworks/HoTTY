import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClearBrowsingDataModal } from './ClearBrowsingDataModal';

describe('ClearBrowsingDataModal', () => {
  it('renders five categories, all checked by default', () => {
    render(<ClearBrowsingDataModal onConfirm={() => {}} onCancel={() => {}} />);
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes).toHaveLength(5);
    expect(boxes.every((b) => b.checked)).toBe(true);
  });

  it('confirms with every category selected by default', () => {
    const onConfirm = vi.fn();
    render(<ClearBrowsingDataModal onConfirm={onConfirm} onCancel={() => {}} />);
    fireEvent.click(screen.getByText('Clear'));
    expect(onConfirm).toHaveBeenCalledWith({
      cookiesAndSiteData: true,
      cache: true,
      history: true,
      passwords: true,
      autofill: true,
    });
  });

  it('reflects unchecked categories in the confirmed options', () => {
    const onConfirm = vi.fn();
    render(<ClearBrowsingDataModal onConfirm={onConfirm} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Browsing history' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Saved passwords' }));
    fireEvent.click(screen.getByText('Clear'));
    expect(onConfirm).toHaveBeenCalledWith({
      cookiesAndSiteData: true,
      cache: true,
      history: false,
      passwords: false,
      autofill: true,
    });
  });

  it('disables Clear and does not confirm when nothing is selected', () => {
    const onConfirm = vi.fn();
    render(<ClearBrowsingDataModal onConfirm={onConfirm} onCancel={() => {}} />);
    screen.getAllByRole('checkbox').forEach((b) => fireEvent.click(b));
    const clearBtn = screen.getByText('Clear').closest('button') as HTMLButtonElement;
    expect(clearBtn.disabled).toBe(true);
    fireEvent.click(clearBtn);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Cancel calls onCancel without confirming', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ClearBrowsingDataModal onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
