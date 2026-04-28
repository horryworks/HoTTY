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
 * Pure prompt detection hook. Watches the terminal buffer and emits an
 * up-to-date array of detected lines (prompt or non-prompt content). Empty
 * lines that have no content anywhere below them in the buffer are excluded
 * (these are pre-allocated trailing rows that should carry no marker).
 *
 * This hook does NOT register xterm decorations; rendering the markers is the
 * caller's responsibility.
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

    // Map keyed by logical start line Y so we can incrementally update.
    const map = new Map<number, DetectedMarker>();
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

      const logicalStartLine = buffer.getLine(startLineY);
      if (!logicalStartLine) return;

      const startText = logicalStartLine.translateToString(true).trimEnd();
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
        for (const patternObj of patterns) {
          if (!patternObj.pattern) continue;
          try {
            const regex = new RegExp(patternObj.pattern);
            const match = regex.exec(startText);
            if (match && match.index === 0) {
              isPrompt = true;
              break;
            }
          } catch {
            /* ignore invalid regex */
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
      // Re-evaluate any tracked markers at or below the cursor
      for (const key of map.keys()) {
        if (key >= currentCursorY) evaluateLine(key);
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
      // Drop entries whose line is no longer valid (buffer trimmed by scrollback)
      for (const key of map.keys()) {
        if (key < 0 || key >= buffer.length) {
          map.delete(key);
          flush();
        }
      }
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
