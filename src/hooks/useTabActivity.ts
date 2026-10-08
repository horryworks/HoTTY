import { useEffect, useRef } from 'react';
import type { Terminal } from '@xterm/xterm';
import { tauriService } from '../services/tauriService';
import { useTabActivityStore, type TabActivity } from '../stores/tabActivityStore';
import type { SessionRecord } from './useSessionManager';

/** How often counted output is written to the store. Output arrives in many
 *  small chunks; writing per chunk would re-render the tab list on every one. */
export const TAB_ACTIVITY_FLUSH_MS = 500;

/** How far up from the cursor to look for something worth showing. */
const LAST_LINE_SCAN_ROWS = 50;
const LAST_LINE_MAX_CHARS = 200;

/** A bare prompt ("sw-01#", "PS C:\work>", "[user@host ~]$") says nothing
 *  about what just happened, so the line above it is the better summary. */
const PS_PROMPT = /^PS .{1,200}>$/;
const BRACKET_PROMPT = /^\[[^\]]{1,80}\][#$%]$/;
const WORD_PROMPT = /^\S{1,60}[#>$%]$/;

/** Output such as "100%" or "-->" also ends in a prompt character; a real
 *  prompt names something, so it carries a letter or a "~". */
export function isBarePrompt(line: string): boolean {
  const text = line.trimEnd();
  if (PS_PROMPT.test(text) || BRACKET_PROMPT.test(text)) return true;
  return WORD_PROMPT.test(text) && /[A-Za-z~]/.test(text);
}

/** The newest meaningful line on a terminal's screen, for a hidden tab's
 *  second line. Reads the buffer, which xterm keeps current even while the
 *  terminal is not mounted anywhere. */
export function lastMeaningfulLine(term: Terminal): string {
  const buf = term.buffer.active;
  const bottom = buf.baseY + buf.cursorY;
  let fallback = '';
  for (let y = bottom; y >= 0 && y > bottom - LAST_LINE_SCAN_ROWS; y--) {
    const text = buf.getLine(y)?.translateToString(true).trim() ?? '';
    if (!text) continue;
    if (isBarePrompt(text)) {
      if (!fallback) fallback = text;
      continue;
    }
    return text.slice(0, LAST_LINE_MAX_CHARS);
  }
  return fallback.slice(0, LAST_LINE_MAX_CHARS);
}

/** Lines in one output chunk; a chunk without a newline still counts once. */
export function countLines(data: string): number {
  let n = 0;
  for (let i = data.indexOf('\n'); i !== -1; i = data.indexOf('\n', i + 1)) n++;
  return Math.max(1, n);
}

/**
 * Counts output that arrives for sessions which are not on screen, so the tab
 * list can say "something happened back there". Counting happens in a ref and
 * reaches the store at most every TAB_ACTIVITY_FLUSH_MS. A tab's count is
 * dropped as soon as it is on screen again.
 */
export function useTabActivity(
  visibleTabIds: readonly string[],
  getSession: (id: string | null) => SessionRecord | undefined
): void {
  const visibleRef = useRef<ReadonlySet<string>>(new Set());
  const pendingRef = useRef(new Map<string, number>());
  const getSessionRef = useRef(getSession);

  useEffect(() => {
    getSessionRef.current = getSession;
  }, [getSession]);

  const visibleKey = visibleTabIds.join('\n');
  useEffect(() => {
    const visible = new Set(visibleKey ? visibleKey.split('\n') : []);
    visibleRef.current = visible;
    for (const id of visible) pendingRef.current.delete(id);
    const { activity, clear } = useTabActivityStore.getState();
    const stale = Object.keys(activity).filter(
      (id) => visible.has(id) || !getSessionRef.current(id)
    );
    clear(stale);
  }, [visibleKey]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    tauriService
      .onSessionData(({ sessionId, data }) => {
        if (visibleRef.current.has(sessionId) || !getSessionRef.current(sessionId)) return;
        const pending = pendingRef.current;
        pending.set(sessionId, (pending.get(sessionId) ?? 0) + countLines(data));
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // No event bridge (tests, a browser preview): nothing to count.
      });

    const timer = setInterval(() => {
      // A tab closed while hidden leaves the visible set unchanged, so the
      // effect above never sees it go; drop its record here.
      const { activity, clear } = useTabActivityStore.getState();
      const gone = Object.keys(activity).filter((id) => !getSessionRef.current(id));
      if (gone.length > 0) clear(gone);
      const pending = pendingRef.current;
      if (pending.size === 0) return;
      const batch: Record<string, TabActivity> = {};
      for (const [id, lines] of pending) {
        const rec = getSessionRef.current(id);
        if (!rec || visibleRef.current.has(id)) continue;
        batch[id] = { lines, lastLine: lastMeaningfulLine(rec.term) };
      }
      pending.clear();
      useTabActivityStore.getState().record(batch);
    }, TAB_ACTIVITY_FLUSH_MS);

    return () => {
      disposed = true;
      unlisten?.();
      clearInterval(timer);
    };
  }, []);
}
