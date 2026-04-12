import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PasteConfirmationModal } from './PasteConfirmationModal';

describe('PasteConfirmationModal', () => {
  it('renders content and Paste button is auto-focused', () => {
    render(
      <PasteConfirmationModal content="hello world" onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(screen.getByText(/hello world/)).toBeTruthy();
    expect(document.activeElement?.textContent).toBe('Paste');
  });

  it('shows newline warning only when content has newlines', () => {
    const { rerender } = render(
      <PasteConfirmationModal content="single line" onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(screen.queryByRole('alert')).toBeNull();
    rerender(
      <PasteConfirmationModal content={'a\nb'} onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('Enter key triggers onConfirm', () => {
    const onConfirm = vi.fn();
    render(
      <PasteConfirmationModal content="x" onConfirm={onConfirm} onCancel={() => {}} />
    );
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('Escape key triggers onCancel', () => {
    const onCancel = vi.fn();
    render(
      <PasteConfirmationModal content="x" onConfirm={() => {}} onCancel={onCancel} />
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Cancel button triggers onCancel', () => {
    const onCancel = vi.fn();
    render(
      <PasteConfirmationModal content="x" onConfirm={() => {}} onCancel={onCancel} />
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
