import { describe, it, expect } from 'vitest';
import { defaultAscending, filterRows, sortRows } from './interfaceTrafficHelpers';
import type { SnmpIfRow } from '../../types/appTypes';

function row(partial: Partial<SnmpIfRow> & { ifIndex: number }): SnmpIfRow {
  return { discontinuity: false, ...partial };
}

describe('filterRows', () => {
  const rows = [
    row({ ifIndex: 1, name: 'Gi0/1', alias: 'uplink', operStatus: 1 }),
    row({ ifIndex: 2, name: 'Gi0/2', alias: 'to-core', operStatus: 2 }),
    row({ ifIndex: 3, descr: 'Vlan10', operStatus: 1 }),
  ];

  it('returns everything with no filter', () => {
    expect(filterRows(rows, '', false)).toHaveLength(3);
  });

  it('matches name, description and alias case-insensitively', () => {
    expect(filterRows(rows, 'gi0/2', false).map((r) => r.ifIndex)).toEqual([2]);
    expect(filterRows(rows, 'UPLINK', false).map((r) => r.ifIndex)).toEqual([1]);
    expect(filterRows(rows, 'vlan', false).map((r) => r.ifIndex)).toEqual([3]);
  });

  it('drops non-up interfaces when upOnly is set', () => {
    expect(filterRows(rows, '', true).map((r) => r.ifIndex)).toEqual([1, 3]);
  });

  it('combines the text filter with upOnly', () => {
    expect(filterRows(rows, 'gi0/', true).map((r) => r.ifIndex)).toEqual([1]);
  });
});

describe('sortRows', () => {
  const rows = [
    row({ ifIndex: 3, name: 'Gi0/10', bpsIn: 500 }),
    row({ ifIndex: 1, name: 'Gi0/2', bpsIn: 1500 }),
    row({ ifIndex: 2, name: 'Gi0/1' }), // no rate yet
  ];

  it('sorts numerically ascending and descending', () => {
    expect(sortRows(rows, 'ifIndex', true).map((r) => r.ifIndex)).toEqual([1, 2, 3]);
    expect(sortRows(rows, 'ifIndex', false).map((r) => r.ifIndex)).toEqual([3, 2, 1]);
  });

  // "We could not measure this" is never the most interesting row on screen.
  it('keeps rows with no value last in both directions', () => {
    expect(sortRows(rows, 'bpsIn', false).map((r) => r.ifIndex)).toEqual([1, 3, 2]);
    expect(sortRows(rows, 'bpsIn', true).map((r) => r.ifIndex)).toEqual([3, 1, 2]);
  });

  it('sorts names naturally, so Gi0/2 precedes Gi0/10', () => {
    expect(sortRows(rows, 'name', true).map((r) => r.name)).toEqual(['Gi0/1', 'Gi0/2', 'Gi0/10']);
  });

  it('does not mutate the input array', () => {
    const original = [...rows];
    sortRows(rows, 'ifIndex', false);
    expect(rows).toEqual(original);
  });
});

describe('defaultAscending', () => {
  // Identifier columns read best low-to-high; a rate or error column is only
  // worth sorting to find the worst offender, so it starts descending.
  it('starts identifier columns ascending', () => {
    expect(defaultAscending('ifIndex')).toBe(true);
    expect(defaultAscending('name')).toBe(true);
    expect(defaultAscending('alias')).toBe(true);
  });

  it('starts rate and counter columns descending', () => {
    expect(defaultAscending('bpsIn')).toBe(false);
    expect(defaultAscending('ppsOut')).toBe(false);
    expect(defaultAscending('inErrors')).toBe(false);
    expect(defaultAscending('speedMbps')).toBe(false);
  });
});
