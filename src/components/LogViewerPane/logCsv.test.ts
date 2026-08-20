import { describe, it, expect } from 'vitest';
import { buildSearchRegex } from './logSearch';
import { isCsvFile, parseCsv, buildCsvView, MAX_CSV_ROWS } from './logCsv';

/** The header the Ping Monitor writes, plus a couple of real-shaped rows. */
const PING_CSV = [
  'timestamp,target,status,rtt_ms,ttl',
  '2026-08-20 12:00:00.123,8.8.8.8,ok,12,118',
  '2026-08-20 12:00:05.456,10.255.255.1,fail,,',
  '',
].join('\n');

const re = (query: string, useRegex = false) =>
  buildSearchRegex(query, { caseSensitive: false, useRegex })!;

describe('isCsvFile', () => {
  it('matches .csv regardless of case', () => {
    expect(isCsvFile('20260820120000-PING-MONITOR.csv')).toBe(true);
    expect(isCsvFile('REPORT.CSV')).toBe(true);
  });

  it('rejects every other log extension', () => {
    expect(isCsvFile('session.txt')).toBe(false);
    expect(isCsvFile('chat.md')).toBe(false);
    expect(isCsvFile('csv')).toBe(false);
  });
});

describe('parseCsv', () => {
  it('splits a Ping Monitor log into a header and body rows', () => {
    const table = parseCsv(PING_CSV);
    expect(table.header).toEqual(['timestamp', 'target', 'status', 'rtt_ms', 'ttl']);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]).toEqual(['2026-08-20 12:00:00.123', '8.8.8.8', 'ok', '12', '118']);
    expect(table.truncated).toBe(false);
  });

  it('keeps empty trailing fields rather than dropping the columns', () => {
    // A timeout row has no RTT and no TTL — both cells must still exist.
    const table = parseCsv(PING_CSV);
    expect(table.rows[1]).toEqual(['2026-08-20 12:00:05.456', '10.255.255.1', 'fail', '', '']);
  });

  it('honours quoted fields containing commas, quotes and newlines', () => {
    const table = parseCsv('a,b\n"x,y","he said ""hi"""\n"two\nlines",z');
    expect(table.header).toEqual(['a', 'b']);
    expect(table.rows[0]).toEqual(['x,y', 'he said "hi"']);
    expect(table.rows[1]).toEqual(['two\nlines', 'z']);
  });

  it('treats a quote inside an unquoted field as literal data', () => {
    const table = parseCsv('a\nx"y');
    expect(table.rows[0]).toEqual(['x"y']);
  });

  it('handles CRLF line endings', () => {
    const table = parseCsv('a,b\r\n1,2\r\n');
    expect(table.header).toEqual(['a', 'b']);
    expect(table.rows).toEqual([['1', '2']]);
  });

  it('keeps the last row when the file does not end in a newline', () => {
    const table = parseCsv('a,b\n1,2');
    expect(table.rows).toEqual([['1', '2']]);
  });

  it('pads ragged records to the widest one so the grid stays rectangular', () => {
    const table = parseCsv('a,b,c\n1\n2,3,4,5');
    expect(table.header).toEqual(['a', 'b', 'c', '']);
    expect(table.rows[0]).toEqual(['1', '', '', '']);
    expect(table.rows[1]).toEqual(['2', '3', '4', '5']);
  });

  it('drops blank lines instead of emitting empty rows', () => {
    const table = parseCsv('a\n1\n\n2\n');
    expect(table.rows).toEqual([['1'], ['2']]);
  });

  it('returns an empty table for empty input', () => {
    const table = parseCsv('');
    expect(table.header).toEqual([]);
    expect(table.rows).toEqual([]);
    expect(table.truncated).toBe(false);
  });

  it('stops at the row cap and says so', () => {
    const text = ['h', ...Array.from({ length: 10 }, (_, i) => String(i))].join('\n');
    const table = parseCsv(text, 4);
    expect(table.rows).toHaveLength(4);
    expect(table.truncated).toBe(true);
  });

  it('defaults the cap to MAX_CSV_ROWS', () => {
    const text = ['h', ...Array.from({ length: MAX_CSV_ROWS + 10 }, (_, i) => String(i))].join('\n');
    const table = parseCsv(text);
    expect(table.rows).toHaveLength(MAX_CSV_ROWS);
    expect(table.truncated).toBe(true);
  });
});

describe('buildCsvView', () => {
  const table = parseCsv(PING_CSV);

  it('returns every row unhighlighted when there is no query', () => {
    const view = buildCsvView(table, null, false);
    expect(view.rows).toHaveLength(2);
    expect(view.total).toBe(0);
    expect(view.rows[0].cells.every((c) => c.matchStart === -1)).toBe(true);
  });

  it('highlights matches and numbers them across the whole table', () => {
    const view = buildCsvView(table, re('0'), false);
    // Ordinals must run in reading order, so previous/next steps sensibly.
    const starts = view.rows.flatMap((r) => r.cells.map((c) => c.matchStart)).filter((n) => n >= 0);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(view.total).toBeGreaterThan(0);
  });

  it('never alters the cell text while highlighting', () => {
    const view = buildCsvView(table, re('8'), false);
    const rebuilt = view.rows.map((r) => r.cells.map((c) => c.segments.map((s) => s.text).join('')));
    expect(rebuilt).toEqual(table.rows);
  });

  it('keeps only matching rows in filter mode', () => {
    const view = buildCsvView(table, re('fail'), true);
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0].cells[1].segments.map((s) => s.text).join('')).toBe('10.255.255.1');
  });

  it('filters on the comma-joined row so a query can span two columns', () => {
    const view = buildCsvView(table, re('ok,12'), true);
    expect(view.rows).toHaveLength(1);
  });

  it('reports no rows when nothing matches in filter mode', () => {
    const view = buildCsvView(table, re('nothing-here'), true);
    expect(view.rows).toHaveLength(0);
    expect(view.total).toBe(0);
  });

  it('still renders rows past the match cap, just unhighlighted', () => {
    const view = buildCsvView(table, re('.', true), false, 3);
    expect(view.rows).toHaveLength(2);
    expect(view.truncated).toBe(true);
    expect(view.total).toBeLessThanOrEqual(3);
  });
});
