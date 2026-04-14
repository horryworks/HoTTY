import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SaveConfirmModal } from './SaveConfirmModal';

describe('SaveConfirmModal', () => {
  it('renders the filename in the prompt', () => {
    render(
      <SaveConfirmModal
        filename="notes.txt"
        onSave={() => {}}
        onDiscard={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText('notes.txt')).toBeTruthy();
    expect(screen.getAllByText(/unsaved changes/i).length).toBeGreaterThan(0);
  });

  it('calls onSave when Save is clicked', () => {
    const onSave = vi.fn();
    render(
      <SaveConfirmModal
        filename="f"
        onSave={onSave}
        onDiscard={() => {}}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("calls onDiscard when Don't save is clicked", () => {
    const onDiscard = vi.fn();
    render(
      <SaveConfirmModal
        filename="f"
        onSave={() => {}}
        onDiscard={onDiscard}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByText(/don'?t save/i));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when Cancel is clicked', () => {
    const onCancel = vi.fn();
    render(
      <SaveConfirmModal
        filename="f"
        onSave={() => {}}
        onDiscard={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when Escape is pressed', () => {
    const onCancel = vi.fn();
    render(
      <SaveConfirmModal
        filename="f"
        onSave={() => {}}
        onDiscard={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('autofocuses the Save button', () => {
    render(
      <SaveConfirmModal
        filename="f"
        onSave={() => {}}
        onDiscard={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(document.activeElement?.textContent).toBe('Save');
  });
});
