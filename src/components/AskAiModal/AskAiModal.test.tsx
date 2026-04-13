import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AskAiModal } from './AskAiModal';

describe('AskAiModal', () => {
  const defaultProps = {
    isOpen: true,
    selection: 'selected text',
    onClose: vi.fn(),
    onSubmit: vi.fn(),
  };

  it('renders nothing when not open', () => {
    const { container } = render(<AskAiModal {...defaultProps} isOpen={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders modal when open', () => {
    render(<AskAiModal {...defaultProps} />);
    expect(screen.getByText('Ask AI')).toBeTruthy();
  });

  it('displays selection text', () => {
    render(<AskAiModal {...defaultProps} />);
    const preview = screen.getByDisplayValue('selected text');
    expect(preview).toBeTruthy();
    expect(preview).toHaveProperty('readOnly', true);
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(<AskAiModal {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<AskAiModal {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByTitle('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('disables Ask button when prompt is empty', () => {
    render(<AskAiModal {...defaultProps} />);
    const askBtn = screen.getByText('Ask');
    expect(askBtn).toHaveProperty('disabled', true);
  });

  it('enables Ask button when prompt is entered', () => {
    render(<AskAiModal {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/What would you like to ask/);
    fireEvent.change(textarea, { target: { value: 'What is this?' } });
    const askBtn = screen.getByText('Ask');
    expect(askBtn).toHaveProperty('disabled', false);
  });

  it('calls onSubmit and onClose when Ask is clicked', () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    render(<AskAiModal {...defaultProps} onSubmit={onSubmit} onClose={onClose} />);
    const textarea = screen.getByPlaceholderText(/What would you like to ask/);
    fireEvent.change(textarea, { target: { value: 'Explain this' } });
    fireEvent.click(screen.getByText('Ask'));
    expect(onSubmit).toHaveBeenCalledWith('Explain this', 'selected text');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape key', () => {
    const onClose = vi.fn();
    render(<AskAiModal {...defaultProps} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
