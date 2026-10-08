// Pure helpers for the Ping Monitor table, kept out of the component so they can
// be unit-tested and the component module exports only a component.

import type { PingResult } from '../../types/appTypes';

/** Split pasted or typed text into targets: one per line, comma or space. */
export function parseTargets(input: string): string[] {
  return input
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Append `added` to `current`, skipping any already in the list (case-insensitive). */
export function addTargets(current: readonly string[], added: readonly string[]): string[] {
  const seen = new Set(current.map((t) => t.toLowerCase()));
  const next = [...current];
  for (const t of added) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(t);
  }
  return next;
}

export interface PingSummary {
  /** One entry per probe, oldest first: the reply time, or null for no reply. */
  bars: (number | null)[];
  /** Share of probes with no reply, 0–100; null before the first probe. */
  lossPct: number | null;
  /** Mean reply time over the probes that answered; null if none did. */
  avgRtt: number | null;
}

/** Summarise one target's recent results for its row. */
export function summarize(history: readonly PingResult[] | undefined): PingSummary {
  if (!history || history.length === 0) return { bars: [], lossPct: null, avgRtt: null };
  const bars = history.map((r) => (r.status === 'ok' && r.rtt !== null ? r.rtt : null));
  const replies = bars.filter((v): v is number => v !== null);
  return {
    bars,
    lossPct: Math.round(((history.length - replies.length) / history.length) * 100),
    avgRtt: replies.length ? Math.round(replies.reduce((a, b) => a + b, 0) / replies.length) : null,
  };
}

/** "HH:MM:SS" out of the backend's "YYYY-MM-DD HH:MM:SS.mmm". */
export function timeOfDay(timestamp: string): string {
  return timestamp.split(' ').pop()?.split('.')[0] ?? timestamp;
}
