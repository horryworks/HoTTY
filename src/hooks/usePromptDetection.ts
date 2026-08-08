import { useEffect, useState } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { PromptPattern } from '../types/appTypes';

export interface DetectedMarker {
  /** Logical buffer Y of the marker (absolute, includes scrollback). */
  line: number;
  /** True when the line matches a prompt pattern; false for non-prompt content. */
  isPrompt: boolean;
  /** Visual row count (1 for unwrapped lines, more for wrapped). */
  lineCount: number;
}

/**
 * True when `s` contains any code unit above U+007F.
 *
 * `String.prototype.normalize` goes through ICU and allocates even when the
 * input is already in NFC, and this runs for every rendered row during bulk
 * output. Every combining mark lives above U+007F, so an all-ASCII line is
 * normalisation-invariant and can skip the call entirely.
 */
function hasNonAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0x7f) return true;
  }
  return false;
}

/**
 * Pure prompt detection hook. Watches the terminal buffer and emits an
 * up-to-date array of detected lines (prompt or non-prompt content). Empty
 * lines that have no content anywhere below them in the buffer are excluded
 * (these are pre-allocated trailing rows that should carry no marker).
 *
 * This hook does NOT register xterm decorations; rendering the markers is the
 * caller's responsibility.
 *
 * Prompt highlighting is ON by default, so everything below `useEffect` runs
 * for every terminal of every user — per-row work here is on the bulk-output
 * hot path and should stay allocation-light.
 */
export function usePromptDetection(
  term: Terminal | null,
  enabled: boolean,
  patterns: PromptPattern[]
): DetectedMarker[] {
  const [markers, setMarkers] = useState<DetectedMarker[]>([]);

  useEffect(() => {
    if (!term || !enabled || !patterns) {
      // Defer reset to next tick to satisfy react-hooks/set-state-in-effect.
      const id = setTimeout(() => setMarkers([]), 0);
      return () => clearTimeout(id);
    }

    // Compile every pattern ONCE per `patterns` identity. This used to sit
    // inside the per-line evaluation, so with the eight shipped defaults it
    // cost eight `new RegExp` compiles for every row that scrolled past.
    // None of these carry the `g` flag, so `exec` keeps no `lastIndex` state
    // and one instance can safely be shared across lines.
    const compiled: RegExp[] = [];
    for (const patternObj of patterns) {
      if (!patternObj.pattern) continue;
      try {
        compiled.push(new RegExp(patternObj.pattern));
      } catch {
        // Same outcome as before (the pattern simply never matches), but now
        // the user gets a hint instead of a silent no-op.
        console.warn(`[promptDetection] ignoring invalid pattern: ${patternObj.pattern}`);
      }
    }

    // Map keyed by logical start line Y so we can incrementally update.
    const map = new Map<number, DetectedMarker>();
    /**
     * Upper bound on the largest key in `map`. Never smaller than the true
     * maximum; it can go stale-HIGH after a delete, which only costs the
     * occasional full scan (i.e. the old behaviour) and is corrected by the
     * prune pass in `onRender`.
     */
    let maxKey = -1;
    /**
     * `buffer.length` at the last prune. Keys can only fall out of range when
     * the buffer SHRINKS, so a same-or-growing length lets the prune walk be
     * skipped — it would otherwise run on every rendered frame.
     */
    let lastBufferLength = -1;
    let pendingFlush = false;

    const flush = () => {
      if (pendingFlush) return;
      pendingFlush = true;
      queueMicrotask(() => {
        pendingFlush = false;
        const arr = Array.from(map.values()).sort((a, b) => a.line - b.line);
        setMarkers(arr);
      });
    };

    const evaluateLine = (bufferY: number) => {
      try {
        evaluateLineInner(bufferY);
      } catch {
        /* prevent unhandled errors from crashing the component */
      }
    };

    const evaluateLineInner = (bufferY: number) => {
      const buffer = term.buffer?.active;
      if (!buffer) return;
      const line = buffer.getLine(bufferY);
      if (!line) return;

      // Trace back to the start of the logical line if this is wrapped
      let startLineY = bufferY;
      let currentLine = line;
      while (currentLine.isWrapped && startLineY > 0) {
        const prevLine = buffer.getLine(startLineY - 1);
        if (!prevLine) break;
        startLineY--;
        currentLine = prevLine;
      }

      // The trace-back loop leaves `currentLine` as the line at `startLineY`,
      // so re-fetching it would be a redundant getLine per evaluated row.
      const logicalStartLine = currentLine;

      // Normalise to NFC so prompts containing combining marks (composed vs.
      // decomposed Japanese / accented Latin) match user-supplied regex
      // patterns regardless of how the terminal sent the bytes. ASCII-only
      // lines — the overwhelming majority of bulk output — skip the call.
      const rawText = logicalStartLine.translateToString(true);
      const startText = (hasNonAscii(rawText) ? rawText.normalize('NFC') : rawText).trimEnd();
      const isEmpty = startText.length === 0;

      // "Unused trailing" = empty line with no content anywhere below it.
      let isUnusedTrailingRow = isEmpty;
      if (isUnusedTrailingRow) {
        for (let y = startLineY + 1; y < buffer.length; y++) {
          const probe = buffer.getLine(y);
          if (probe && probe.translateToString(true).trimEnd().length > 0) {
            isUnusedTrailingRow = false;
            break;
          }
        }
      }

      if (isUnusedTrailingRow) {
        if (map.has(startLineY)) {
          map.delete(startLineY);
          flush();
        }
        return;
      }

      let isPrompt = false;
      if (!isEmpty) {
        for (const regex of compiled) {
          const match = regex.exec(startText);
          if (match && match.index === 0) {
            isPrompt = true;
            break;
          }
        }
      }

      // Count wrapped rows for visual height
      let lineCount = 1;
      let checkY = startLineY + 1;
      while (checkY < buffer.length) {
        const l = buffer.getLine(checkY);
        if (l && l.isWrapped) {
          lineCount++;
          checkY++;
        } else break;
      }

      const existing = map.get(startLineY);
      if (existing && existing.isPrompt === isPrompt && existing.lineCount === lineCount) {
        return; // No change
      }
      map.set(startLineY, { line: startLineY, isPrompt, lineCount });
      if (startLineY > maxKey) maxKey = startLineY;
      flush();
    };

    const scanAllLines = () => {
      const buffer = term.buffer?.active;
      if (!buffer) return;
      const maxLine = buffer.baseY + buffer.cursorY;
      for (let i = 0; i <= maxLine && i < buffer.length; i++) {
        evaluateLine(i);
      }
    };

    const onCursorMove = term.onCursorMove(() => {
      const buffer = term.buffer.active;
      const currentCursorY = buffer.baseY + buffer.cursorY;
      evaluateLine(currentCursorY);
      // Re-evaluate any tracked markers at or below the cursor. During bulk
      // output every marker sits ABOVE the cursor, so the bound check skips
      // the whole walk instead of comparing several hundred keys per move.
      if (maxKey >= currentCursorY) {
        for (const key of map.keys()) {
          if (key >= currentCursorY) evaluateLine(key);
        }
      }
    });

    const onLineFeed = term.onLineFeed(() => {
      const buffer = term.buffer.active;
      evaluateLine(buffer.baseY + buffer.cursorY - 1);
    });

    const onRender = term.onRender((e) => {
      const buffer = term.buffer.active;
      for (let i = e.start; i <= e.end; i++) {
        const bufferY = buffer.baseY + i;
        if (bufferY >= 0 && bufferY < buffer.length) {
          evaluateLine(bufferY);
        }
      }
      // Drop entries whose line is no longer valid (buffer trimmed by
      // scrollback, cleared, or swapped to the alternate buffer). Only a
      // SHRINKING buffer can invalidate a key, so the walk is skipped while
      // the buffer grows — and one flush covers the whole pass.
      const len = buffer.length;
      if (len < lastBufferLength) {
        let removed = false;
        let newMax = -1;
        for (const key of map.keys()) {
          if (key < 0 || key >= len) {
            map.delete(key);
            removed = true;
          } else if (key > newMax) {
            newMax = key;
          }
        }
        maxKey = newMax;
        if (removed) flush();
      }
      lastBufferLength = len;
    });

    scanAllLines();

    return () => {
      onCursorMove.dispose();
      onLineFeed.dispose();
      onRender.dispose();
      map.clear();
    };
  }, [term, enabled, patterns]);

  return markers;
}
