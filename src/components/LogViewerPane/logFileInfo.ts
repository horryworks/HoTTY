// What the Log Viewer's file list shows for a file: a short type badge and the
// device or chat it came from, instead of the raw `<timestamp>-<KIND>-<host>`
// name. Pure, so it can be unit-tested and kept out of the component.

import type { LogFile } from '../../types/appTypes';

export type LogKind =
  | 'ssh' | 'telnet' | 'serial' | 'wsl' | 'cmd' | 'powershell' | 'gitbash' | 'gcp'
  | 'aichat' | 'ping' | 'other';

export interface LogFileInfo {
  kind: LogKind;
  /** Short text for the badge ("SSH", "AI", "COM"). */
  badge: string;
  /** The device, shell or chat title; the file name when it cannot be parsed. */
  title: string;
}

// The kinds the backend writes, as they appear in the name. Longest first so
// "PING-MONITOR" is not read as kind "PING" with host "MONITOR".
const KINDS: readonly [string, LogKind, string][] = [
  ['PING-MONITOR', 'ping', 'PING'],
  ['GCLOUD-IAP', 'gcp', 'GCP'],
  ['GIT-BASH', 'gitbash', 'BASH'],
  ['POWERSHELL', 'powershell', 'PS'],
  ['AICHAT', 'aichat', 'AI'],
  ['TELNET', 'telnet', 'TEL'],
  ['SERIAL', 'serial', 'COM'],
  ['SSH', 'ssh', 'SSH'],
  ['WSL', 'wsl', 'WSL'],
  ['CMD', 'cmd', 'CMD'],
];

const STAMP = /^\d{14}-/;
const EXT = /\.(txt|log|md|csv)$/i;

export function describeLogFile(name: string): LogFileInfo {
  const ext = EXT.exec(name)?.[1]?.toLowerCase();
  if (STAMP.test(name)) {
    const rest = name.slice(15).replace(EXT, '');
    for (const [prefix, kind, badge] of KINDS) {
      if (rest === prefix) return { kind, badge, title: kind === 'ping' ? 'Ping Monitor' : prefix };
      if (rest.startsWith(`${prefix}-`)) return { kind, badge, title: rest.slice(prefix.length + 1) };
    }
  }
  return { kind: 'other', badge: ext ? ext.toUpperCase() : 'LOG', title: name };
}

/** A file written to within this long is treated as still being written. */
export const LIVE_WINDOW_MS = 60_000;

export function isLive(file: LogFile, now: number): boolean {
  return file.mtime > 0 && now - file.mtime < LIVE_WINDOW_MS;
}

export interface LogFileGroup {
  /** 'today', 'yesterday', or a local date string for anything older. */
  key: string;
  files: LogFile[];
}

function dayStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Split files (already newest first) into today / yesterday / one group per older day. */
export function groupByDay(files: readonly LogFile[], now: number): LogFileGroup[] {
  const today = dayStart(now);
  const yesterday = today - 86_400_000;
  const groups: LogFileGroup[] = [];
  for (const f of files) {
    const day = dayStart(f.mtime);
    const key = day >= today ? 'today' : day >= yesterday ? 'yesterday' : new Date(day).toLocaleDateString();
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.files.push(f);
    else groups.push({ key, files: [f] });
  }
  return groups;
}

/** How often a followed file is checked for new output... */
const FOLLOW_REFRESH_MS = 2000;
/** ...plus this much per megabyte, since a change means reading the whole file again. */
const FOLLOW_MS_PER_MB = 1000;
/** Never slower than this, however big the file. */
const FOLLOW_REFRESH_MAX_MS = 15000;

/** How long to wait between reads of a followed file of `size` bytes. */
export function followInterval(size: number): number {
  return Math.min(FOLLOW_REFRESH_MAX_MS, FOLLOW_REFRESH_MS + Math.floor(size / 1_048_576) * FOLLOW_MS_PER_MB);
}
