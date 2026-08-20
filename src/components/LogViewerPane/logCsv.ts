// Pure helpers for rendering a `.csv` log as a table in the Log Viewer.
//
// The Ping Monitor writes `<timestamp>-PING-MONITOR.csv` into the app-wide log
// folder, and a long-running monitor produces tens of thousands of rows, so
// everything here is bounded by an explicit cap — the project has no
// virtualization library and the backend reads files up to 50 MB.
//
// Like `logSearch.ts`, highlighting is expressed as plain data (segments) that
// the component renders with React elements — never innerHTML.

import { MAX_MATCHES, splitByMatches, type Segment } from './logSearch';

/** Hard ceiling on body rows parsed out of a CSV file. */
export const MAX_CSV_ROWS = 5000;

/** A parsed CSV file, normalized to a rectangular grid. */
export interface CsvTable {
  /** First record of the file. Empty when the file itself is empty. */
  header: string[];
  /** Every record after the header, padded to the widest record. */
  rows: string[][];
  /** True when parsing stopped at `MAX_CSV_ROWS` and later rows were dropped. */
  truncated: boolean;
}

/** One cell, pre-split for highlighting. */
export interface CsvCell {
  segments: Segment[];
  /**
   * Ordinal of this cell's first match within the whole rendered table, or -1
   * when the cell holds no match. The component adds the match's index within
   * the cell to get its global ordinal, which is what the find bar's
   * previous/next navigation steps through.
   */
  matchStart: number;
}

export interface CsvViewRow {
  cells: CsvCell[];
}

/** A table ready to render: cells split into segments, rows optionally filtered. */
export interface CsvView {
  header: string[];
  rows: CsvViewRow[];
  /** Highlighted matches across every rendered row. */
  total: number;
  /** True when the match cap was reached and later matches are unhighlighted. */
  truncated: boolean;
}

/** Whether a log file should be offered as a table. Extension-only, like the backend. */
export function isCsvFile(name: string): boolean {
  return name.toLowerCase().endsWith('.csv');
}

/**
 * Parse CSV text into a rectangular grid.
 *
 * Follows RFC 4180 for quoting — `"a,b"`, `"he said ""hi"""`, and newlines
 * inside quotes all survive intact. The Ping Monitor's own writer never quotes
 * (it strips commas from targets instead), but the log folder is a user folder
 * and may hold CSVs written by anything, so a naive `split(',')` would corrupt
 * them silently.
 *
 * Records are padded to the widest record: a ragged file still renders as a
 * table instead of a staircase, and no field is ever dropped.
 */
export function parseCsv(text: string, cap: number = MAX_CSV_ROWS): CsvTable {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;
  let truncated = false;

  // A record limit of `cap` body rows means cap + 1 records including the header.
  const maxRecords = cap + 1;

  const endRecord = (): boolean => {
    record.push(field);
    field = '';
    // Blank lines carry no data — dropping them keeps a trailing newline (and
    // any stray blank line mid-file) from becoming an empty table row.
    const blank = record.length === 1 && record[0] === '';
    if (!blank) records.push(record);
    record = [];
    if (records.length >= maxRecords) {
      truncated = true;
      return false;
    }
    return true;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    // A quote only opens a quoted field at the field's start; anywhere else it
    // is literal data (`a"b`), which is what spreadsheets do with malformed input.
    if (ch === '"' && field === '') {
      inQuotes = true;
    } else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\r') {
      // CRLF — the '\n' that follows closes the record.
    } else if (ch === '\n') {
      if (!endRecord()) break;
    } else {
      field += ch;
    }
  }

  // A file that does not end in a newline still has one record pending.
  if (!truncated && (field !== '' || record.length > 0)) endRecord();

  const width = records.reduce((w, r) => Math.max(w, r.length), 0);
  const pad = (r: string[]): string[] =>
    r.length === width ? r : [...r, ...Array(width - r.length).fill('')];

  return {
    header: records.length > 0 ? pad(records[0]) : [],
    rows: records.slice(1).map(pad),
    truncated,
  };
}

/** A cell with nothing highlighted. */
function plainCell(text: string): CsvCell {
  return { segments: [{ text, isMatch: false }], matchStart: -1 };
}

/**
 * Split every cell into highlight segments, optionally dropping rows that hold
 * no match at all.
 *
 * The filter decision joins the row with commas rather than testing cells one
 * by one, so a query that spans a separator (`ok,12`) matches the same way it
 * would against the raw file.
 */
export function buildCsvView(
  table: CsvTable,
  re: RegExp | null,
  filterOnly: boolean,
  cap: number = MAX_MATCHES,
): CsvView {
  if (!re) {
    return {
      header: table.header,
      rows: table.rows.map((cells) => ({ cells: cells.map(plainCell) })),
      total: 0,
      truncated: false,
    };
  }

  const rows: CsvViewRow[] = [];
  let total = 0;
  let truncated = false;

  for (const cells of table.rows) {
    re.lastIndex = 0;
    if (filterOnly && !re.test(cells.join(','))) continue;

    // Past the cap the row still renders — it just renders unhighlighted, the
    // same bargain `splitByMatches` makes within a single string.
    if (total >= cap) {
      truncated = true;
      rows.push({ cells: cells.map(plainCell) });
      continue;
    }

    const viewCells = cells.map((text) => {
      const split = splitByMatches(text, re, cap - total);
      const cell: CsvCell = {
        segments: split.segments,
        matchStart: split.total > 0 ? total : -1,
      };
      total += split.total;
      if (split.truncated) truncated = true;
      return cell;
    });
    rows.push({ cells: viewCells });
  }

  return { header: table.header, rows, total, truncated };
}
