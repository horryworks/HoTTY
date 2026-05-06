import { describe, it, expect } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { TerminalOutputBlock } from './TerminalOutputBlock';

describe('TerminalOutputBlock', () => {
  it('renders the command first line and meta in the collapsed header', () => {
    render(<TerminalOutputBlock cmd="ls -la" output={'a\nb\nc'} />);
    expect(screen.getByText('ls -la')).toBeTruthy();
    expect(screen.getByText('Terminal output')).toBeTruthy();
    expect(screen.getByText(/3 lines · 5 chars/)).toBeTruthy();
  });

  it('shows only the first line of a multi-line command in the collapsed header', () => {
    render(<TerminalOutputBlock cmd={"echo a\necho b"} output="x" />);
    expect(screen.getByText('echo a')).toBeTruthy();
    expect(screen.queryByText('echo b')).toBeNull();
  });

  it('starts collapsed and toggles open on click', () => {
    const { container } = render(<TerminalOutputBlock cmd="ls" output="hello" />);
    const block = container.querySelector('.ai-terminal-output-block');
    expect(block?.classList.contains('expanded')).toBe(false);
    expect(container.querySelector('.ai-terminal-output-body')).toBeNull();

    fireEvent.click(screen.getByRole('button'));
    expect(container.querySelector('.ai-terminal-output-block')?.classList.contains('expanded')).toBe(true);
    expect(container.querySelector('.ai-terminal-output-body')).toBeTruthy();
  });

  it('toggles via Enter and Space keys', () => {
    const { container } = render(<TerminalOutputBlock cmd="ls" output="hi" />);
    const header = screen.getByRole('button');

    fireEvent.keyDown(header, { key: 'Enter' });
    expect(container.querySelector('.ai-terminal-output-block')?.classList.contains('expanded')).toBe(true);

    fireEvent.keyDown(header, { key: ' ' });
    expect(container.querySelector('.ai-terminal-output-block')?.classList.contains('expanded')).toBe(false);
  });

  it('does not toggle on other keys', () => {
    const { container } = render(<TerminalOutputBlock cmd="ls" output="hi" />);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'a' });
    expect(container.querySelector('.ai-terminal-output-block')?.classList.contains('expanded')).toBe(false);
  });

  it('shows the full multi-line command when expanded', () => {
    const { container } = render(<TerminalOutputBlock cmd={"echo a\necho b"} output="x" />);
    fireEvent.click(screen.getByRole('button'));
    const cmdFull = container.querySelector('.ai-terminal-output-cmd-full');
    expect(cmdFull?.textContent).toBe('echo a\necho b');
  });

  it('does not show the full command pre-block when the command is single-line', () => {
    const { container } = render(<TerminalOutputBlock cmd="ls" output="x" />);
    fireEvent.click(screen.getByRole('button'));
    expect(container.querySelector('.ai-terminal-output-cmd-full')).toBeNull();
  });

  it('renders "(no output)" placeholder when output is empty after trimming trailing newlines', () => {
    const { container } = render(<TerminalOutputBlock cmd="ls" output={"\n\n"} />);
    fireEvent.click(screen.getByRole('button'));
    expect(container.querySelector('.ai-terminal-output-empty')?.textContent).toBe('(no output)');
    expect(container.querySelector('.ai-terminal-output-body pre')).toBeNull();
  });

  it('counts lines and chars from the trimmed output', () => {
    render(<TerminalOutputBlock cmd="ls" output={"a\nb\n\n"} />);
    // trailing newlines trimmed → "a\nb" → 2 lines, 3 chars
    expect(screen.getByText(/2 lines · 3 chars/)).toBeTruthy();
  });

  it('reports 0 lines and 0 chars for empty output', () => {
    render(<TerminalOutputBlock cmd="ls" output="" />);
    expect(screen.getByText(/0 lines · 0 chars/)).toBeTruthy();
  });

  it('exposes aria-expanded on the toggle', () => {
    render(<TerminalOutputBlock cmd="ls" output="x" />);
    const header = screen.getByRole('button');
    expect(header.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('true');
  });
});
