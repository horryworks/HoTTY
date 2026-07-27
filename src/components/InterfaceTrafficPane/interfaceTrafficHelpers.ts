// Pure row filtering/sorting for the Interface Traffic table.
//
// Kept out of the component file so it can be unit-tested directly and so the
// component module exports only a component (react-refresh requirement) —
// same split as GcpInstancesPane/gcpAccessHelpers.ts.

import type { SnmpIfRow } from '../../types/appTypes';

export type SortKey =
  | 'ifIndex'
  | 'name'
  | 'alias'
  | 'operStatus'
  | 'speedMbps'
  | 'bpsIn'
  | 'bpsOut'
  | 'ppsIn'
  | 'ppsOut'
  | 'inErrors'
  | 'outErrors'
  | 'inDiscards'
  | 'outDiscards';

/** Identifier-ish columns read best ascending; rates and counters worst-first. */
export function defaultAscending(key: SortKey): boolean {
  return key === 'ifIndex' || key === 'name' || key === 'alias';
}

function sortValue(row: SnmpIfRow, key: SortKey): number | string | null {
  switch (key) {
    case 'ifIndex':
      return row.ifIndex;
    case 'name':
      return row.name ?? row.descr ?? null;
    case 'alias':
      return row.alias ?? null;
    case 'operStatus':
      return row.operStatus ?? null;
    case 'speedMbps':
      return row.speedMbps ?? null;
    case 'bpsIn':
      return row.bpsIn ?? null;
    case 'bpsOut':
      return row.bpsOut ?? null;
    case 'ppsIn':
      return row.ppsIn ?? null;
    case 'ppsOut':
      return row.ppsOut ?? null;
    case 'inErrors':
      return row.inErrors ?? null;
    case 'outErrors':
      return row.outErrors ?? null;
    case 'inDiscards':
      return row.inDiscards ?? null;
    case 'outDiscards':
      return row.outDiscards ?? null;
    default:
      return null;
  }
}

/**
 * Sort a copy of `rows`.
 *
 * Rows with no value for the sort column always sink to the bottom, in both
 * directions — "we could not measure this" is never the most interesting row on
 * screen. Ties break on ifIndex so the order is stable across polls.
 */
export function sortRows(rows: SnmpIfRow[], key: SortKey, ascending: boolean): SnmpIfRow[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    if (av === null && bv === null) return a.ifIndex - b.ifIndex;
    if (av === null) return 1;
    if (bv === null) return -1;
    let cmp: number;
    if (typeof av === 'string' || typeof bv === 'string') {
      // `numeric` so Gi0/2 sorts before Gi0/10.
      cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
    } else {
      cmp = av - bv;
    }
    if (cmp === 0) return a.ifIndex - b.ifIndex;
    return ascending ? cmp : -cmp;
  });
  return sorted;
}

/** Substring match over ifName/ifDescr/ifAlias, plus an optional up-only gate. */
export function filterRows(rows: SnmpIfRow[], query: string, upOnly: boolean): SnmpIfRow[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (upOnly && row.operStatus !== 1) return false;
    if (!needle) return true;
    const haystack = `${row.name ?? ''} ${row.descr ?? ''} ${row.alias ?? ''}`.toLowerCase();
    return haystack.includes(needle);
  });
}
