import { describe, it, expect } from 'vitest';
import { normalizeLineEnding } from './lineEndings';

describe('normalizeLineEnding', () => {
  describe("to 'LF'", () => {
    it('converts CRLF to LF', () => {
      expect(normalizeLineEnding('a\r\nb\r\nc', 'LF')).toBe('a\nb\nc');
    });

    it('leaves existing LF untouched', () => {
      expect(normalizeLineEnding('a\nb\nc', 'LF')).toBe('a\nb\nc');
    });

    it('collapses mixed CRLF/LF to LF', () => {
      expect(normalizeLineEnding('a\r\nb\nc\r\n', 'LF')).toBe('a\nb\nc\n');
    });
  });

  describe("to 'CRLF'", () => {
    it('converts LF to CRLF', () => {
      expect(normalizeLineEnding('a\nb\nc', 'CRLF')).toBe('a\r\nb\r\nc');
    });

    it('is idempotent on existing CRLF (no \\r\\r\\n doubling)', () => {
      expect(normalizeLineEnding('a\r\nb\r\nc', 'CRLF')).toBe('a\r\nb\r\nc');
    });

    it('normalizes mixed CRLF/LF to CRLF without doubling', () => {
      expect(normalizeLineEnding('a\r\nb\nc', 'CRLF')).toBe('a\r\nb\r\nc');
    });
  });

  it('returns empty string unchanged for both styles', () => {
    expect(normalizeLineEnding('', 'LF')).toBe('');
    expect(normalizeLineEnding('', 'CRLF')).toBe('');
  });

  it('leaves content without line breaks unchanged', () => {
    expect(normalizeLineEnding('no breaks here', 'LF')).toBe('no breaks here');
    expect(normalizeLineEnding('no breaks here', 'CRLF')).toBe('no breaks here');
  });

  it('preserves a trailing newline', () => {
    expect(normalizeLineEnding('a\n', 'CRLF')).toBe('a\r\n');
    expect(normalizeLineEnding('a\r\n', 'LF')).toBe('a\n');
  });
});
