import { describe, it, expect } from 'vitest';
import { describeLogFile, groupByDay, isLive } from './logFileInfo';

const file = (name: string, mtime: number) => ({ name, path: `/logs/${name}`, mtime, size: 1 });

describe('logFileInfo', () => {
  it('reads the kind and the device out of a session log name', () => {
    expect(describeLogFile('20261009140322-SSH-sw-01.txt')).toEqual({ kind: 'ssh', badge: 'SSH', title: 'sw-01' });
    expect(describeLogFile('20261009140322-SERIAL-COM3.txt')).toEqual({ kind: 'serial', badge: 'COM', title: 'COM3' });
    expect(describeLogFile('20261009140322-GIT-BASH-Git Bash.txt').kind).toBe('gitbash');
    expect(describeLogFile('20261009140322-GCLOUD-IAP-vm-01.txt')).toEqual({ kind: 'gcp', badge: 'GCP', title: 'vm-01' });
  });

  it('names chat transcripts by their title and the Ping Monitor CSV by the tool', () => {
    expect(describeLogFile('20260727091402-AICHAT-router-a.md')).toEqual({ kind: 'aichat', badge: 'AI', title: 'router-a' });
    expect(describeLogFile('20260820120000-PING-MONITOR.csv')).toEqual({ kind: 'ping', badge: 'PING', title: 'Ping Monitor' });
  });

  it('keeps any other file under its own name, badged by extension', () => {
    expect(describeLogFile('notes.txt')).toEqual({ kind: 'other', badge: 'TXT', title: 'notes.txt' });
    expect(describeLogFile('20261009140322-UNKNOWN-x.txt').kind).toBe('other');
  });

  it('treats a file written to in the last minute as still being written', () => {
    const now = 1_000_000_000;
    expect(isLive(file('a', now - 10_000), now)).toBe(true);
    expect(isLive(file('a', now - 120_000), now)).toBe(false);
    expect(isLive(file('a', 0), now)).toBe(false);
  });

  it('groups newest-first files into today, yesterday and older days', () => {
    const now = new Date(2026, 9, 9, 15, 0, 0).getTime();
    const groups = groupByDay([
      file('a', new Date(2026, 9, 9, 14, 0).getTime()),
      file('b', new Date(2026, 9, 9, 1, 0).getTime()),
      file('c', new Date(2026, 9, 8, 23, 0).getTime()),
      file('d', new Date(2026, 9, 6, 12, 0).getTime()),
    ], now);
    expect(groups.map((g) => [g.key === 'today' || g.key === 'yesterday' ? g.key : 'older', g.files.map((f) => f.name)])).toEqual([
      ['today', ['a', 'b']],
      ['yesterday', ['c']],
      ['older', ['d']],
    ]);
  });
});

describe('followInterval', () => {
  it('reads a small file every 2 s and a big one less often, up to 15 s', async () => {
    const { followInterval } = await import('./logFileInfo');
    expect(followInterval(10_000)).toBe(2000);
    expect(followInterval(5 * 1_048_576)).toBe(7000);
    expect(followInterval(50 * 1_048_576)).toBe(15000);
  });
});
