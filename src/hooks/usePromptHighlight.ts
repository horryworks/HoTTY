import { useEffect } from 'react';
import type { Terminal, IMarker, IDecoration } from '@xterm/xterm';
import type { PromptPattern } from '../types/appTypes';

const SCROLLBAR_WIDTH = 10;
const MARKER_GAP = 2;
const MARKER_BORDER = 6;
const MARKER_WIDTH = 8;

interface ActiveLine {
  marker: IMarker;
  decoration: IDecoration;
  isPrompt: boolean;
  element?: HTMLElement;
}

export function usePromptHighlight(
  term: Terminal | null,
  enabled: boolean,
  highlightColor: string,
  patterns: PromptPattern[]
): void {
  useEffect(() => {
    if (!term || !enabled || !patterns) return;

    let activeLines: ActiveLine[] = [];
    let lastClickedMarkerLine: number | null = null;

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

      // Find existing decoration for this LOGICAL start line
      let existingIdx = -1;
      for (let i = activeLines.length - 1; i >= 0; i--) {
        const item = activeLines[i];
        if (!item.marker || item.marker.isDisposed) {
          activeLines.splice(i, 1);
          continue;
        }
        if (item.marker.line === startLineY) {
          existingIdx = i;
          break;
        }
      }

      const existing = existingIdx !== -1 ? activeLines[existingIdx] : null;

      let isPrompt = false;
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

      if (existing && existing.isPrompt === isPrompt) {
        return; // Nothing to change
      }

      if (existing) {
        if (existing.decoration) existing.decoration.dispose();
        if (existing.marker && !existing.marker.isDisposed) existing.marker.dispose();
        activeLines.splice(existingIdx, 1);
      }

      // Register new marker and decoration precisely at the LOGICAL start line
      const cursorYOffset = startLineY - (buffer.baseY + buffer.cursorY);
      const marker = term.registerMarker(cursorYOffset);
      if (!marker) return;

      const decoration = term.registerDecoration({
        marker,
        anchor: 'right',
        x: 0,
        width: 1,
      });

      if (decoration) {
        const trackObj: ActiveLine = { marker, decoration, isPrompt, element: undefined };
        activeLines.push(trackObj);

        decoration.onRender((element: HTMLElement) => {
          trackObj.element = element;
          const defaultPromptColor = highlightColor
            ? highlightColor
            : 'var(--prompt-highlight-default, rgba(255, 255, 255, 0.15))';
          const targetColor = isPrompt
            ? defaultPromptColor
            : 'var(--terminal-prompt-active, #2196f3)';

          let count = 1;
          let checkY = marker.line + 1;
          while (checkY < term.buffer.active.length) {
            const l = term.buffer.active.getLine(checkY);
            if (l && l.isWrapped) {
              count++;
              checkY++;
            } else break;
          }

          // Position marker 2px to the left of the vertical scrollbar
          const xtermEl = element.closest('.xterm') as HTMLElement | null;
          const offsetParent = element.offsetParent as HTMLElement | null;
          if (xtermEl && offsetParent) {
            const xtermRect = xtermEl.getBoundingClientRect();
            const parentRect = offsetParent.getBoundingClientRect();
            const markerLeft =
              xtermRect.right - SCROLLBAR_WIDTH - MARKER_GAP - MARKER_WIDTH - parentRect.left;
            element.style.left = `${markerLeft}px`;
          }
          element.style.position = 'absolute';
          element.style.right = 'auto';
          element.style.boxSizing = 'border-box';
          element.style.width = `${MARKER_WIDTH}px`;
          element.style.backgroundColor = 'transparent';
          element.style.borderRight = `${MARKER_BORDER}px solid ${targetColor}`;
          element.style.pointerEvents = 'all';
          element.style.cursor = 'pointer';
          element.style.zIndex = '10';
          element.style.transformOrigin = 'top';
          element.style.transform = `scaleY(${count})`;

          if (!element.dataset.clickEventBound) {
            element.dataset.clickEventBound = 'true';

            element.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (marker.isDisposed) return;
              handleMarkerSelection(e, marker, isPrompt);
            });
          }
        });

        decoration.onDispose(() => {
          const idx = activeLines.indexOf(trackObj);
          if (idx !== -1) activeLines.splice(idx, 1);
        });
      }
    };

    const handleMarkerSelection = (
      e: MouseEvent,
      marker: IMarker,
      isPrompt: boolean
    ) => {
      const currentLine = marker.line;
      let startLine = currentLine;
      let endLine = currentLine;

      if (e.shiftKey && lastClickedMarkerLine !== null) {
        // Select range between last clicked marker block and this one
        const rangeTop = Math.min(lastClickedMarkerLine, currentLine);
        const rangeBottom = Math.max(lastClickedMarkerLine, currentLine);

        let topIsPrompt: boolean | null = null;
        let bottomIsPrompt: boolean | null = null;

        for (const item of activeLines) {
          if (item.marker && !item.marker.isDisposed) {
            if (item.marker.line === rangeTop) topIsPrompt = item.isPrompt;
            if (item.marker.line === rangeBottom) bottomIsPrompt = item.isPrompt;
          }
        }

        let topBoundary = -1;
        let bottomBoundary = Infinity;

        for (const item of activeLines) {
          if (item.marker && !item.marker.isDisposed) {
            const mLine = item.marker.line;
            if (topIsPrompt !== null && item.isPrompt !== topIsPrompt) {
              if (mLine < rangeTop && mLine > topBoundary) topBoundary = mLine;
            }
            if (bottomIsPrompt !== null && item.isPrompt !== bottomIsPrompt) {
              if (mLine > rangeBottom && mLine < bottomBoundary) bottomBoundary = mLine;
            }
          }
        }

        startLine = rangeTop;
        for (const item of activeLines) {
          if (item.marker && !item.marker.isDisposed && item.isPrompt === topIsPrompt) {
            const mLine = item.marker.line;
            if (mLine <= rangeTop && mLine > topBoundary && mLine < startLine) {
              startLine = mLine;
            }
          }
        }

        endLine = rangeBottom;
        for (const item of activeLines) {
          if (item.marker && !item.marker.isDisposed && item.isPrompt === bottomIsPrompt) {
            const mLine = item.marker.line;
            if (mLine >= rangeBottom && mLine < bottomBoundary && mLine > endLine) {
              endLine = mLine;
            }
          }
        }
      } else {
        // Normal click - select the contiguous block of the same type
        let upperBoundary = -1;
        let lowerBoundary = Infinity;

        for (const item of activeLines) {
          if (item.marker && !item.marker.isDisposed) {
            const mLine = item.marker.line;
            if (item.isPrompt !== isPrompt) {
              if (mLine < currentLine && mLine > upperBoundary) {
                upperBoundary = mLine;
              }
              if (mLine > currentLine && mLine < lowerBoundary) {
                lowerBoundary = mLine;
              }
            }
          }
        }

        for (const item of activeLines) {
          if (item.marker && !item.marker.isDisposed && item.isPrompt === isPrompt) {
            const mLine = item.marker.line;
            if (mLine > upperBoundary && mLine < lowerBoundary) {
              if (mLine < startLine) startLine = mLine;
              if (mLine > endLine) endLine = mLine;
            }
          }
        }
      }

      lastClickedMarkerLine = currentLine;

      startLine = Math.max(0, startLine);

      // Expand endLine for wrapped lines
      let expandedEndLine = endLine;
      while (expandedEndLine + 1 < term.buffer.active.length) {
        const l = term.buffer.active.getLine(expandedEndLine + 1);
        if (l && l.isWrapped) {
          expandedEndLine++;
        } else break;
      }

      endLine = Math.max(startLine, Math.min(expandedEndLine, term.buffer.active.length - 1));

      term.selectLines(startLine, endLine);
    };

    const onCursorMove = term.onCursorMove(() => {
      const buffer = term.buffer.active;
      const currentCursorY = buffer.baseY + buffer.cursorY;

      evaluateLine(currentCursorY);

      // Re-evaluate any active markers at or below the cursor
      for (let i = activeLines.length - 1; i >= 0; i--) {
        const item = activeLines[i];
        if (item.marker && !item.marker.isDisposed && item.marker.line >= currentCursorY) {
          evaluateLine(item.marker.line);
        }
      }
    });

    const onLineFeed = term.onLineFeed(() => {
      const buffer = term.buffer.active;
      evaluateLine(buffer.baseY + buffer.cursorY - 1);
    });

    const onRender = term.onRender((e) => {
      const buffer = term.buffer.active;

      // Re-evaluate height and horizontal position of all active decorations
      for (const item of activeLines) {
        if (item.marker && !item.marker.isDisposed && item.element) {
          let count = 1;
          let checkY = item.marker.line + 1;
          while (checkY < buffer.length) {
            const l = buffer.getLine(checkY);
            if (l && l.isWrapped) {
              count++;
              checkY++;
            } else break;
          }
          item.element.style.transform = `scaleY(${count})`;

          // Recalculate horizontal position on resize
          const xtermEl = item.element.closest('.xterm') as HTMLElement | null;
          const offsetParent = item.element.offsetParent as HTMLElement | null;
          if (xtermEl && offsetParent) {
            const xtermRect = xtermEl.getBoundingClientRect();
            const parentRect = offsetParent.getBoundingClientRect();
            const markerLeft =
              xtermRect.right - SCROLLBAR_WIDTH - MARKER_GAP - MARKER_WIDTH - parentRect.left;
            item.element.style.left = `${markerLeft}px`;
          }
        }
      }

      for (let i = e.start; i <= e.end; i++) {
        const bufferY = ((buffer as { ydisp?: number }).ydisp ?? 0) + i;
        if (bufferY >= 0 && bufferY < buffer.length) {
          evaluateLine(bufferY);
        }
      }
    });

    // Scan all lines on mount
    let attachCheckInterval: ReturnType<typeof setInterval> | null = null;
    const scanAllLines = () => {
      if (!term.buffer.active) return;
      const maxLine = term.buffer.active.baseY + term.buffer.active.cursorY;
      for (let i = 0; i <= maxLine && i < term.buffer.active.length; i++) {
        evaluateLine(i);
      }
    };

    if (term.element) {
      scanAllLines();
    } else {
      attachCheckInterval = setInterval(() => {
        if (term.element) {
          scanAllLines();
          if (attachCheckInterval !== null) clearInterval(attachCheckInterval);
        }
      }, 100);
    }

    return () => {
      onCursorMove.dispose();
      onLineFeed.dispose();
      onRender.dispose();
      if (attachCheckInterval) clearInterval(attachCheckInterval);
      activeLines.forEach((item) => {
        if (item.decoration) item.decoration.dispose();
      });
      activeLines = [];
    };
  }, [term, enabled, highlightColor, patterns]);
}
