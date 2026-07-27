import { describe, it, expect } from 'vitest';
import {
  MAX_MATCHES,
  buildSearchRegex,
  escapeRegExp,
  filterMatchingLines,
  splitByMatches,
} from './logSearch';

const literal = { caseSensitive: false, useRegex: false };
const regex = { caseSensitive: false, useRegex: true };

function matched(text: string, query: string, opts = literal): string[] {
  const re = buildSearchRegex(query, opts);
  if (!re) return [];
  return splitByMatches(text, re).segments.filter((s) => s.isMatch).map((s) => s.text);
}

describe('escapeRegExp', () => {
  it('escapes every regex metacharacter', () => {
    const re = new RegExp(escapeRegExp('a.*+?^${}()|[]\\b'));
    expect(re.test('a.*+?^${}()|[]\\b')).toBe(true);
    expect(re.test('axxb')).toBe(false);
  });
});

describe('buildSearchRegex', () => {
  it('returns null for an empty query', () => {
    expect(buildSearchRegex('', literal)).toBeNull();
    expect(buildSearchRegex('', regex)).toBeNull();
  });

  it('returns null for an invalid regex instead of throwing', () => {
    expect(buildSearchRegex('[unclosed', regex)).toBeNull();
    expect(buildSearchRegex('a{2,1}', regex)).toBeNull();
  });

  it('treats an invalid-regex query as a literal when regex mode is off', () => {
    expect(buildSearchRegex('[unclosed', literal)).not.toBeNull();
    expect(matched('found [unclosed here', '[unclosed')).toEqual(['[unclosed']);
  });

  it('is case-insensitive by default and case-sensitive when asked', () => {
    expect(matched('Error error ERROR', 'error')).toEqual(['Error', 'error', 'ERROR']);
    expect(matched('Error error ERROR', 'error', { caseSensitive: true, useRegex: false }))
      .toEqual(['error']);
  });

  it('applies regex syntax only in regex mode', () => {
    expect(matched('ERROR and WARN', 'ERROR|WARN', regex)).toEqual(['ERROR', 'WARN']);
    expect(matched('ERROR|WARN literal', 'ERROR|WARN')).toEqual(['ERROR|WARN']);
  });

  it('escapes Windows paths and bracketed levels typed as literals', () => {
    expect(matched('read C:\\logs\\a.txt now', 'C:\\logs\\a.txt')).toEqual(['C:\\logs\\a.txt']);
    expect(matched('[ERROR] boom', '[ERROR]')).toEqual(['[ERROR]']);
  });
});

describe('splitByMatches', () => {
  it('preserves the original text exactly', () => {
    const text = 'alpha beta alpha gamma';
    const re = buildSearchRegex('alpha', literal)!;
    const { segments } = splitByMatches(text, re);
    expect(segments.map((s) => s.text).join('')).toBe(text);
  });

  it('alternates plain and match segments', () => {
    const re = buildSearchRegex('b', literal)!;
    const { segments, total, truncated } = splitByMatches('abc', re);
    expect(segments).toEqual([
      { text: 'a', isMatch: false },
      { text: 'b', isMatch: true },
      { text: 'c', isMatch: false },
    ]);
    expect(total).toBe(1);
    expect(truncated).toBe(false);
  });

  it('handles a match at the very start and end', () => {
    const re = buildSearchRegex('x', literal)!;
    const { segments, total } = splitByMatches('xax', re);
    expect(segments).toEqual([
      { text: 'x', isMatch: true },
      { text: 'a', isMatch: false },
      { text: 'x', isMatch: true },
    ]);
    expect(total).toBe(2);
  });

  it('returns no matches when nothing matches', () => {
    const re = buildSearchRegex('zzz', literal)!;
    const { segments, total } = splitByMatches('abc', re);
    expect(total).toBe(0);
    expect(segments).toEqual([{ text: 'abc', isMatch: false }]);
  });

  it('terminates on zero-length matches instead of looping forever', () => {
    for (const pattern of ['a*', '^', '\\b', 'x?']) {
      const re = buildSearchRegex(pattern, regex)!;
      const { segments } = splitByMatches('bbb', re);
      expect(segments.map((s) => s.text).join('')).toBe('bbb');
    }
  });

  it('still highlights the non-empty matches of a partly-empty pattern', () => {
    const re = buildSearchRegex('a*', regex)!;
    const { segments } = splitByMatches('baab', re);
    expect(segments.filter((s) => s.isMatch).map((s) => s.text)).toEqual(['aa']);
    expect(segments.map((s) => s.text).join('')).toBe('baab');
  });

  it('stops at the cap and reports truncation without losing text', () => {
    const text = 'x'.repeat(10);
    const re = buildSearchRegex('x', literal)!;
    const { segments, total, truncated } = splitByMatches(text, re, 4);
    expect(total).toBe(4);
    expect(truncated).toBe(true);
    expect(segments.filter((s) => s.isMatch)).toHaveLength(4);
    expect(segments.map((s) => s.text).join('')).toBe(text);
  });

  it('defaults the cap to MAX_MATCHES', () => {
    const text = 'x'.repeat(MAX_MATCHES + 10);
    const re = buildSearchRegex('x', literal)!;
    const { total, truncated } = splitByMatches(text, re);
    expect(total).toBe(MAX_MATCHES);
    expect(truncated).toBe(true);
  });

  it('can be called repeatedly with the same regex object', () => {
    const re = buildSearchRegex('a', literal)!;
    expect(splitByMatches('aaa', re).total).toBe(3);
    expect(splitByMatches('aaa', re).total).toBe(3);
  });
});

describe('filterMatchingLines', () => {
  const content = [
    '2026-07-27 10:01:03 ssh: connect',
    '2026-07-27 10:01:09 read timeout after 30s',
    '2026-07-27 10:01:10 retrying',
    '2026-07-27 10:02:44 socket timeout',
  ].join('\n');

  it('keeps only the lines that contain a match', () => {
    const re = buildSearchRegex('timeout', literal)!;
    const { lines, truncated } = filterMatchingLines(content, re);
    expect(lines).toEqual([
      '2026-07-27 10:01:09 read timeout after 30s',
      '2026-07-27 10:02:44 socket timeout',
    ]);
    expect(truncated).toBe(false);
  });

  it('returns nothing when no line matches', () => {
    const re = buildSearchRegex('nosuchthing', literal)!;
    expect(filterMatchingLines(content, re).lines).toEqual([]);
  });

  it('supports regex mode', () => {
    const re = buildSearchRegex('retry|connect', regex)!;
    expect(filterMatchingLines(content, re).lines).toEqual([
      '2026-07-27 10:01:03 ssh: connect',
      '2026-07-27 10:01:10 retrying',
    ]);
  });

  it('does not lose lines to a stale regex lastIndex', () => {
    // A `g` regex reused via .test() advances lastIndex; every line must still
    // be evaluated from position 0.
    const re = buildSearchRegex('a', literal)!;
    expect(filterMatchingLines('a\na\na', re).lines).toEqual(['a', 'a', 'a']);
  });

  it('stops at the cap and reports truncation', () => {
    const many = Array.from({ length: 10 }, (_, i) => `hit ${i}`).join('\n');
    const re = buildSearchRegex('hit', literal)!;
    const { lines, truncated } = filterMatchingLines(many, re, 3);
    expect(lines).toEqual(['hit 0', 'hit 1', 'hit 2']);
    expect(truncated).toBe(true);
  });

  it('handles content with no trailing newline and CRLF line endings', () => {
    const re = buildSearchRegex('b', literal)!;
    expect(filterMatchingLines('a\r\nb\r\nc', re).lines).toEqual(['b\r']);
  });
});
