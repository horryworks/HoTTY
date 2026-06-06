import { describe, it, expect } from 'vitest';
import { TERMINAL_OUTPUT_RE, parseTerminalOutputMessage, notConnectedNote } from './terminalOutputUtils';

describe('parseTerminalOutputMessage', () => {
  it('returns null when content does not start with the marker', () => {
    expect(parseTerminalOutputMessage('hello world')).toBeNull();
    expect(parseTerminalOutputMessage('')).toBeNull();
    expect(parseTerminalOutputMessage('Terminal Output Command: ls')).toBeNull();
  });

  it('parses a simple single-line command and output', () => {
    const result = parseTerminalOutputMessage('Terminal Output (Command: ls):\nfile1\nfile2\n');
    expect(result).toEqual({ cmd: 'ls', output: 'file1\nfile2\n' });
  });

  it('parses an empty output', () => {
    const result = parseTerminalOutputMessage('Terminal Output (Command: pwd):\n');
    expect(result).toEqual({ cmd: 'pwd', output: '' });
  });

  it('preserves multi-line output verbatim', () => {
    const output = 'line1\nline2\n\nline4';
    const result = parseTerminalOutputMessage(`Terminal Output (Command: cat file):\n${output}`);
    expect(result?.output).toBe(output);
  });

  it('handles multi-line commands inside the parentheses', () => {
    const cmd = "echo a\necho b";
    const result = parseTerminalOutputMessage(`Terminal Output (Command: ${cmd}):\nresult`);
    expect(result?.cmd).toBe(cmd);
    expect(result?.output).toBe('result');
  });

  it('returns null when the closing paren and colon are missing', () => {
    expect(parseTerminalOutputMessage('Terminal Output (Command: ls\nfile1')).toBeNull();
  });

  it('exports a regex that matches valid messages', () => {
    expect(TERMINAL_OUTPUT_RE.test('Terminal Output (Command: ls):\noutput')).toBe(true);
    expect(TERMINAL_OUTPUT_RE.test('something else')).toBe(false);
  });
});

describe('notConnectedNote', () => {
  it('produces a parseable Terminal Output envelope with the command', () => {
    const note = notConnectedNote('display version', 'disconnected');
    const parsed = parseTerminalOutputMessage(note);
    expect(parsed?.cmd).toBe('display version');
    expect(parsed?.output).toContain('not connected (disconnected)');
    expect(parsed?.output).toContain('press Watch');
  });

  it('defaults the status to disconnected when the session is gone', () => {
    const note = notConnectedNote('ls');
    expect(note).toContain('(disconnected)');
  });

  it('reflects a connecting status', () => {
    expect(notConnectedNote('ls', 'connecting')).toContain('(connecting)');
  });
});
