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
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when overlay is clicked', () => {
    const onClose = vi.fn();
    render(<HelpModal open={true} onClose={onClose} />);
    const overlay = document.querySelector('.dlg-overlay') as HTMLElement;
    // Press and release on the backdrop. A bare click is ignored on purpose:
    // that is what the tail of a drag released off-dialog looks like.
    fireEvent.mouseDown(overlay);
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when modal body is clicked', () => {
    const onClose = vi.fn();
    render(<HelpModal open={true} onClose={onClose} />);
    const body = document.querySelector('.help-modal') as HTMLElement;
    fireEvent.mouseDown(body);
    fireEvent.click(body);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close when a resize drag is released on the overlay', () => {
    const onClose = vi.fn();
    render(<HelpModal open={true} onClose={onClose} />);
    const overlay = document.querySelector('.dlg-overlay') as HTMLElement;

    fireEvent.mouseDown(document.querySelector('.drf-se') as HTMLElement);
    fireEvent.mouseUp(document, { clientX: 900, clientY: 900 });
    fireEvent.click(overlay);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('brings its own shell rather than borrowing the settings dialog stylesheet', () => {
    render(<HelpModal open={true} onClose={() => {}} />);
    // Both are lazy-loaded, and `.settings-modal*` ships in the settings chunk,
    // so borrowing those class names left Help unstyled until Settings had been
    // opened once.
    expect(document.querySelector('.dlg-overlay')).toBeTruthy();
    expect(document.querySelector('.dlg-surface')).toBeTruthy();
    expect(document.querySelector('.settings-modal-overlay')).toBeNull();
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

describe('HelpModal — Escape', () => {
  // The modal lists "Escape — close dialog" among the shortcuts it documents,
  // so this is the app agreeing with its own help.
  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<HelpModal open={true} onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not fire Escape while closed', () => {
    const onClose = vi.fn();
    render(<HelpModal open={false} onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });
});
