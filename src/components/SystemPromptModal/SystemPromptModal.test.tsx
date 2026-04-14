import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SystemPromptModal } from './SystemPromptModal';

describe('SystemPromptModal', () => {
  beforeEach(() => {
    // Fresh clipboard stub per test
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('renders the persona label and instruction', () => {
    render(
      <SystemPromptModal
        personaLabel="Network Expert"
        systemInstruction="You are a network engineer."
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/Network Expert/)).toBeTruthy();
    expect(screen.getByText('You are a network engineer.')).toBeTruthy();
  });

  it('calls onClose when the Close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <SystemPromptModal
        personaLabel="P"
        systemInstruction="x"
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the ✕ button is clicked', () => {
    const onClose = vi.fn();
    render(
      <SystemPromptModal
        personaLabel="P"
        systemInstruction="x"
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(
      <SystemPromptModal
        personaLabel="P"
        systemInstruction="x"
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the overlay is clicked', () => {
    const onClose = vi.fn();
    render(
      <SystemPromptModal
        personaLabel="P"
        systemInstruction="x"
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when the inner panel is clicked', () => {
    const onClose = vi.fn();
    render(
      <SystemPromptModal
        personaLabel="P"
        systemInstruction="hello"
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByText('hello'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('copies the instruction to the clipboard when Copy is clicked', async () => {
    render(
      <SystemPromptModal
        personaLabel="P"
        systemInstruction="copy me"
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('Copy'));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('copy me');
    });
    expect(await screen.findByText('Copied')).toBeTruthy();
  });

  it('autofocuses the Close button', () => {
    render(
      <SystemPromptModal
        personaLabel="P"
        systemInstruction="x"
        onClose={() => {}}
      />,
    );
    expect(document.activeElement?.textContent).toBe('Close');
  });
});
