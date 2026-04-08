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

    it('strips CSI sequence ending in s (save cursor)', () => {
        expect(stripAnsiCodes('prompt\x1b[s')).toBe('prompt');
    });

    it('strips CSI sequence ending in t (window manipulation)', () => {
        expect(stripAnsiCodes('text\x1b[8;24;80t')).toBe('text');
    });

    it('strips CSI sequence ending in @ (insert characters)', () => {
        expect(stripAnsiCodes('text\x1b[2@')).toBe('text');
    });

    it('strips CSI sequence ending in u (restore cursor)', () => {
        expect(stripAnsiCodes('\x1b[utext')).toBe('text');
    });

    it('strips CSI sequence ending in d (VPA)', () => {
        expect(stripAnsiCodes('\x1b[5dtext')).toBe('text');
    });

    it('strips bracketed paste mode enable/disable', () => {
        expect(stripAnsiCodes('$ \x1b[?2004h')).toBe('$ ');
        expect(stripAnsiCodes('$ \x1b[?2004l')).toBe('$ ');
    });
});
