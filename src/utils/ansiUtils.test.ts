import { describe, it, expect } from 'vitest';
import { stripAnsiCodes } from './ansiUtils';

describe('stripAnsiCodes', () => {
    it('returns plain text unchanged', () => {
        expect(stripAnsiCodes('hello world')).toBe('hello world');
    });

    it('strips CSI color codes', () => {
        expect(stripAnsiCodes('\x1b[31mred text\x1b[0m')).toBe('red text');
    });

    it('strips bold/reset sequences', () => {
        expect(stripAnsiCodes('\x1b[1mbold\x1b[0m')).toBe('bold');
    });

    it('strips cursor movement sequences', () => {
        expect(stripAnsiCodes('\x1b[2J\x1b[H')).toBe('');
    });

    it('strips OSC window title sequence', () => {
        expect(stripAnsiCodes('\x1b]0;window title\x07plain')).toBe('plain');
    });

    it('strips OSC sequence with ST terminator', () => {
        expect(stripAnsiCodes('\x1b]2;title\x1b\\plain')).toBe('plain');
    });

    it('normalizes CRLF to LF', () => {
        expect(stripAnsiCodes('line1\r\nline2')).toBe('line1\nline2');
    });

    it('normalizes bare CR to LF', () => {
        expect(stripAnsiCodes('line1\rline2')).toBe('line1\nline2');
    });

    it('handles complex mixed input', () => {
        const input = '\x1b[32mConnected\x1b[0m to \x1b]0;SSH\x07host\r\n';
        expect(stripAnsiCodes(input)).toBe('Connected to host\n');
    });

    it('handles empty string', () => {
        expect(stripAnsiCodes('')).toBe('');
    });
});
