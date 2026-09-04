import { describe, it, expect } from 'vitest';
import {
  TERMINAL_OUTPUT_RE,
  parseTerminalOutputMessage,
  notConnectedNote,
  declinedNote,
  unknownTargetNote,
  parseConnectEnvelope,
  isMachineEnvelope,
  connectedNote,
  alreadyOpenNote,
  connectFailedNote,
  connectDeclinedNote,
  connectRefusedNote,
} from './terminalOutputUtils';

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

describe('declinedNote', () => {
  it('produces a parseable Terminal Output envelope with the command', () => {
    const note = declinedNote('rm -rf /tmp/cache');
    const parsed = parseTerminalOutputMessage(note);
    expect(parsed?.cmd).toBe('rm -rf /tmp/cache');
    expect(parsed?.output).toContain('chose NOT to run');
    expect(parsed?.output).toContain('Do not run it');
    expect(parsed?.output).toContain('suggest a different approach');
  });

  it('starts with the Terminal Output marker so sendMessage skips the watch-buffer prepend', () => {
    expect(declinedNote('ls').startsWith('Terminal Output (Command:')).toBe(true);
  });

  it('preserves a multi-line command inside the parentheses', () => {
    const cmd = 'echo a\necho b';
    expect(parseTerminalOutputMessage(declinedNote(cmd))?.cmd).toBe(cmd);
  });
});

describe('unknownTargetNote', () => {
  it('is a Terminal Output envelope that says the command was NOT run', () => {
    const note = unknownTargetNote('show ip route', 'sw-99');
    const parsed = parseTerminalOutputMessage(note);
    expect(parsed?.cmd).toBe('show ip route');
    expect(parsed?.output).toContain('"sw-99"');
    expect(parsed?.output).toContain('NOT run');
  });
});

describe('connect envelopes', () => {
  const key = 'ssh:alice@192.0.2.10:22';

  it('round-trips every envelope kind through parseConnectEnvelope', () => {
    const connected = parseConnectEnvelope(connectedNote(key, 'sw-01', 'sw-01', 'sw-01#'));
    expect(connected).toMatchObject({ kind: 'connected', key, alias: 'sw-01' });
    expect(connected?.body).toContain('target=sw-01');
    expect(connected?.body.endsWith('sw-01#')).toBe(true);

    expect(parseConnectEnvelope(alreadyOpenNote(key, 'core-01'))).toMatchObject({ kind: 'connected', key, alias: 'core-01' });
    expect(parseConnectEnvelope(connectFailedNote(key, 'Connection refused'))).toMatchObject({ kind: 'failed', key, alias: undefined });
    expect(parseConnectEnvelope(connectDeclinedNote(key))).toMatchObject({ kind: 'declined', key });
    expect(parseConnectEnvelope(connectRefusedNote('local:powershell', 'Limit reached'))).toMatchObject({ kind: 'refused', key: 'local:powershell' });
    expect(parseConnectEnvelope(connectRefusedNote('local:powershell', 'Limit reached'))?.body).toBe('[Limit reached]');
  });

  it('omits the tail line when there is no captured output', () => {
    const note = connectedNote('local:powershell', 'powershell-ai', 'PowerShell (AI)', '');
    expect(note.split('\n')).toHaveLength(2);
  });

  it('rejects prose that merely starts with a similar word', () => {
    expect(parseConnectEnvelope('Connection to the device seems fine.')).toBeNull();
    expect(parseConnectEnvelope('Terminal Connected but no parens')).toBeNull();
    expect(parseConnectEnvelope('')).toBeNull();
  });

  it('isMachineEnvelope covers command results and every connect outcome, not user prose', () => {
    expect(isMachineEnvelope('Terminal Output (Command: ls):\nfoo')).toBe(true);
    expect(isMachineEnvelope(connectedNote(key, 'sw-01', 'sw-01', ''))).toBe(true);
    expect(isMachineEnvelope(connectFailedNote(key, 'x'))).toBe(true);
    expect(isMachineEnvelope(connectDeclinedNote(key))).toBe(true);
    expect(isMachineEnvelope(connectRefusedNote(key, 'x'))).toBe(true);
    expect(isMachineEnvelope('please connect to the switch')).toBe(false);
  });
});
