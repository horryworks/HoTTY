import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { TerminalContextMenu } from './TerminalContextMenu';

describe('TerminalContextMenu', () => {
  it('renders the input at the given position', () => {
    const { container } = render(
      <TerminalContextMenu x={120} y={80} onSubmit={vi.fn()} onClose={vi.fn()} />
    );
    const menu = container.querySelector('.terminal-context-menu') as HTMLElement;
    expect(menu).toBeTruthy();
    expect(menu.style.left).toBe('120px');
    expect(menu.style.top).toBe('80px');
    expect(container.querySelector('.terminal-context-menu-input')).toBeTruthy();
    // A persistent "Ask AI" title makes it clear this is an AI question, not a paste box.
    const title = container.querySelector('.terminal-context-menu-title') as HTMLElement;
    expect(title).toBeTruthy();
    expect(title.textContent).toBe('Ask AI');
  });

  it('submits the typed question on Enter then closes', () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <TerminalContextMenu x={0} y={0} onSubmit={onSubmit} onClose={onClose} />
    );
    const input = container.querySelector('.terminal-context-menu-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'why did this fail?' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('why did this fail?');
    expect(onClose).toHaveBeenCalled();
  });

  it('does not submit an empty/whitespace question', () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <TerminalContextMenu x={0} y={0} onSubmit={onSubmit} onClose={vi.fn()} />
    );
    const input = container.querySelector('.terminal-context-menu-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Shift+Enter inserts a newline instead of submitting', () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <TerminalContextMenu x={0} y={0} onSubmit={onSubmit} onClose={vi.fn()} />
    );
    const input = container.querySelector('.terminal-context-menu-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'line one' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('closes on an outside mousedown but not on a mousedown inside the menu', () => {
    const onClose = vi.fn();
    const { container } = render(
      <TerminalContextMenu x={0} y={0} onSubmit={vi.fn()} onClose={onClose} />
    );
    // Mousedown inside the menu must not close it.
    fireEvent.mouseDown(container.querySelector('.terminal-context-menu') as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
    // Mousedown elsewhere closes it.
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<TerminalContextMenu x={0} y={0} onSubmit={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
