import { describe, it, expect } from 'vitest';
import { addTargets, parseTargets, summarize, timeOfDay } from './pingStats';
import type { PingResult } from '../../types/appTypes';

const r = (status: 'ok' | 'fail', rtt: number | null): PingResult => ({
  target: '192.0.2.1', status, rtt, ttl: rtt === null ? null : 64, timestamp: '2026-10-09 14:03:21.123',
});

describe('pingStats', () => {
  it('splits targets on lines, commas and spaces', () => {
    expect(parseTargets('192.0.2.1\n198.51.100.20, sw-01  ap-01\r\n')).toEqual([
      '192.0.2.1', '198.51.100.20', 'sw-01', 'ap-01',
    ]);
  });

  it('appends only targets not already listed, ignoring case', () => {
    expect(addTargets(['sw-01'], ['SW-01', 'ap-01', 'ap-01'])).toEqual(['sw-01', 'ap-01']);
  });

  it('summarises loss and the average over the replies', () => {
    expect(summarize([r('ok', 10), r('fail', null), r('ok', 20), r('ok', 30)])).toEqual({
      bars: [10, null, 20, 30], lossPct: 25, avgRtt: 20,
    });
  });

  it('has no figures before the first result', () => {
    expect(summarize(undefined)).toEqual({ bars: [], lossPct: null, avgRtt: null });
  });

  it('reads the time of day out of the backend timestamp', () => {
    expect(timeOfDay('2026-10-09 14:03:21.123')).toBe('14:03:21');
  });
});
