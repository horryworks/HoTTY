import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HelpModal } from './HelpModal';

describe('HelpModal', () => {
  it('renders nothing when open is false', () => {
    const { container } = render(<HelpModal open={false} onClose={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders the modal when open is true', () => {
    render(<HelpModal open={true} onClose={() => {}} />);
    expect(screen.getByText('Help & Documentation')).toBeTruthy();
  });

  it('renders collapsible help sections', () => {
    render(<HelpModal open={true} onClose={() => {}} />);
    expect(screen.getByText('Shortcuts')).toBeTruthy();
    expect(screen.getByText('Getting Started')).toBeTruthy();
    expect(screen.getByText('AI Quick Start Guide')).toBeTruthy();
    expect(screen.getByText('Themes & Appearance')).toBeTruthy();
  });

  it('renders keyboard shortcuts', () => {
    render(<HelpModal open={true} onClose={() => {}} />);
    expect(screen.getAllByText('Ctrl + N').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Ctrl + W')).toBeTruthy();
    expect(screen.getAllByText('Ctrl + V').length).toBeGreaterThanOrEqual(1);
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<HelpModal open={true} onClose={onClose} />);
    fireEvent.click(document.querySelector('.help-modal-close')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when overlay is clicked', () => {
    const onClose = vi.fn();
    render(<HelpModal open={true} onClose={onClose} />);
    fireEvent.click(document.querySelector('.settings-modal-overlay')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when modal body is clicked', () => {
    const onClose = vi.fn();
    render(<HelpModal open={true} onClose={onClose} />);
    fireEvent.click(document.querySelector('.help-modal')!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders terminal marker visual guide', () => {
    render(<HelpModal open={true} onClose={() => {}} />);
    expect(document.querySelector('.help-visual-guide')).toBeTruthy();
    expect(document.querySelector('.marker-red')).toBeTruthy();
    expect(document.querySelector('.marker-blue')).toBeTruthy();
  });

  it('renders AI provider comparison table', () => {
    render(<HelpModal open={true} onClose={() => {}} />);
    expect(document.querySelector('.help-auth-table')).toBeTruthy();
  });
});
