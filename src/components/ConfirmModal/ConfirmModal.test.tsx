import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmModal } from './ConfirmModal';

describe('ConfirmModal', () => {
  it('renders title and message', () => {
    render(
      <ConfirmModal
        title="Delete Host"
        message="Are you sure?"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText('Delete Host')).toBeTruthy();
    expect(screen.getByText('Are you sure?')).toBeTruthy();
  });

  it('uses default title and confirmLabel', () => {
    render(
      <ConfirmModal message="test" onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(screen.getByText('Confirm')).toBeTruthy();
    expect(screen.getByText('Delete')).toBeTruthy();
  });

  it('calls onConfirm when confirm button clicked', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmModal message="test" onConfirm={onConfirm} onCancel={() => {}} />
    );
    fireEvent.click(screen.getByText('Delete'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when cancel button clicked', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmModal message="test" onConfirm={() => {}} onCancel={onCancel} />
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Escape key triggers onCancel', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmModal message="test" onConfirm={() => {}} onCancel={onCancel} />
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('auto-focuses cancel button on mount', () => {
    render(
      <ConfirmModal message="test" onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(document.activeElement?.textContent).toBe('Cancel');
  });

  it('uses custom confirmLabel', () => {
    render(
      <ConfirmModal
        message="test"
        confirmLabel="Remove"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText('Remove')).toBeTruthy();
  });
});
