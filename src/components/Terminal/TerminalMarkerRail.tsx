import { useEffect, useRef, useState } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { DetectedMarker } from '../../hooks/usePromptDetection';

interface TerminalMarkerRailProps {
  term: Terminal;
  markers: DetectedMarker[];
  highlightColor: string;
}

interface ViewportInfo {
  viewportY: number;
  cellHeight: number;
}

/**
 * Renders prompt / output markers in a dedicated DOM rail that lives
 * OUTSIDE the xterm host. This guarantees markers stay visible regardless
 * of the host's horizontal scroll position.
 *
 * Each marker is positioned vertically based on (line - viewportY) * cellHeight.
 * Markers are clickable and select the contiguous block of the same type
 * (port of the v1 / current usePromptHighlight click behaviour).
 */
export function TerminalMarkerRail({ term, markers, highlightColor }: TerminalMarkerRailProps) {
  const [viewport, setViewport] = useState<ViewportInfo>({ viewportY: 0, cellHeight: 17 });
  const lastClickedRef = useRef<number | null>(null);

  useEffect(() => {
    const update = () => {
      const buffer = term.buffer.active;
      // baseY changes when scrollback grows; viewportY tracks scroll position.
      const viewportY = buffer.viewportY;
      // Prefer the live cell height from xterm's renderer (proposeDimensions
      // is the public path that exposes it).
      const dims = (term as unknown as {
        _core?: { _renderService?: { dimensions?: { css?: { cell?: { height?: number } } } } };
      })._core?._renderService?.dimensions?.css?.cell?.height;
      const cellHeight = typeof dims === 'number' && dims > 0 ? dims : 17;
      setViewport((prev) =>
        prev.viewportY === viewportY && prev.cellHeight === cellHeight
          ? prev
          : { viewportY, cellHeight }
      );
    };
    update();
    const onScroll = term.onScroll(update);
    const onRender = term.onRender(update);
    return () => {
      onScroll.dispose();
      onRender.dispose();
    };
  }, [term]);

  const handleClick = (e: React.MouseEvent, marker: DetectedMarker) => {
    e.preventDefault();
    e.stopPropagation();
    const currentLine = marker.line;
    let startLine = currentLine;
    let endLine = currentLine;

    if (e.shiftKey && lastClickedRef.current !== null) {
      const rangeTop = Math.min(lastClickedRef.current, currentLine);
      const rangeBottom = Math.max(lastClickedRef.current, currentLine);
      let topIsPrompt: boolean | null = null;
      let bottomIsPrompt: boolean | null = null;
      for (const m of markers) {
        if (m.line === rangeTop) topIsPrompt = m.isPrompt;
        if (m.line === rangeBottom) bottomIsPrompt = m.isPrompt;
      }
      let topBoundary = -1;
      let bottomBoundary = Infinity;
      for (const m of markers) {
        if (topIsPrompt !== null && m.isPrompt !== topIsPrompt) {
          if (m.line < rangeTop && m.line > topBoundary) topBoundary = m.line;
        }
        if (bottomIsPrompt !== null && m.isPrompt !== bottomIsPrompt) {
          if (m.line > rangeBottom && m.line < bottomBoundary) bottomBoundary = m.line;
        }
      }
      startLine = rangeTop;
      for (const m of markers) {
        if (m.isPrompt === topIsPrompt && m.line <= rangeTop && m.line > topBoundary && m.line < startLine) {
          startLine = m.line;
        }
      }
      endLine = rangeBottom;
      for (const m of markers) {
        if (m.isPrompt === bottomIsPrompt && m.line >= rangeBottom && m.line < bottomBoundary && m.line > endLine) {
          endLine = m.line;
        }
      }
    } else {
      // Normal click - select the contiguous block of the same type
      let upperBoundary = -1;
      let lowerBoundary = Infinity;
      for (const m of markers) {
        if (m.isPrompt !== marker.isPrompt) {
          if (m.line < currentLine && m.line > upperBoundary) upperBoundary = m.line;
          if (m.line > currentLine && m.line < lowerBoundary) lowerBoundary = m.line;
        }
      }
      for (const m of markers) {
        if (m.isPrompt === marker.isPrompt && m.line > upperBoundary && m.line < lowerBoundary) {
          if (m.line < startLine) startLine = m.line;
          if (m.line > endLine) endLine = m.line;
        }
      }
    }

    lastClickedRef.current = currentLine;
    startLine = Math.max(0, startLine);

    // Expand endLine to include trailing wrapped rows
    let expandedEndLine = endLine;
    const buffer = term.buffer.active;
    while (expandedEndLine + 1 < buffer.length) {
      const l = buffer.getLine(expandedEndLine + 1);
      if (l && l.isWrapped) expandedEndLine++;
      else break;
    }
    endLine = Math.max(startLine, Math.min(expandedEndLine, buffer.length - 1));
    term.selectLines(startLine, endLine);
  };

  const promptColor = highlightColor || 'var(--terminal-prompt-default, #f44336)';
  const nonPromptColor = 'var(--terminal-prompt-active, #2196f3)';

  return (
    <div className="terminal-marker-rail">
      {markers.map((m) => {
        // (m.line - viewport.viewportY) is the visual row offset within the
        // viewport. Negative or beyond rows means off-screen; we still render
        // (clipped by parent overflow) so we don't have to recompute on every
        // micro-scroll.
        const top = (m.line - viewport.viewportY) * viewport.cellHeight;
        const height = m.lineCount * viewport.cellHeight;
        const color = m.isPrompt ? promptColor : nonPromptColor;
        return (
          <div
            key={m.line}
            className={`terminal-marker${m.isPrompt ? ' prompt' : ' output'}`}
            style={{ top, height, backgroundColor: color }}
            onClick={(e) => handleClick(e, m)}
          />
        );
      })}
    </div>
  );
}
