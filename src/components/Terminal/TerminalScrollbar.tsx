import { useEffect, useRef, useState } from 'react';
import type { Terminal } from '@xterm/xterm';

interface TerminalScrollbarProps {
  term: Terminal;
}

interface ScrollState {
  totalLines: number;
  cellHeight: number;
  viewportY: number;
}

/**
 * Custom vertical scrollbar that lives in its own DOM rail (outside the
 * xterm host) so it stays anchored to the pane's right edge regardless of
 * the host's horizontal scroll position. Bidirectionally synced with the
 * xterm scrollback state via `term.scrollToLine` / `term.buffer.viewportY`.
 *
 * Visual styling comes from the global `::-webkit-scrollbar` rules in
 * `src/index.css`, so the scrollbar matches the rest of the app's chrome.
 */
export function TerminalScrollbar({ term }: TerminalScrollbarProps) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const isSyncingRef = useRef(false);
  const [state, setState] = useState<ScrollState>({
    totalLines: 24,
    cellHeight: 17,
    viewportY: 0,
  });

  // Sync rail.scrollTop ← xterm.viewportY whenever xterm scrolls or renders.
  useEffect(() => {
    const update = () => {
      const buffer = term.buffer.active;
      const totalLines = buffer.length;
      const viewportY = buffer.viewportY;
      const dims = (term as unknown as {
        _core?: { _renderService?: { dimensions?: { css?: { cell?: { height?: number } } } } };
      })._core?._renderService?.dimensions?.css?.cell?.height;
      const cellHeight = typeof dims === 'number' && dims > 0 ? dims : 17;
      setState((prev) =>
        prev.totalLines === totalLines &&
        prev.cellHeight === cellHeight &&
        prev.viewportY === viewportY
          ? prev
          : { totalLines, cellHeight, viewportY }
      );
      const rail = railRef.current;
      if (rail) {
        const targetTop = viewportY * cellHeight;
        if (Math.abs(rail.scrollTop - targetTop) > 0.5) {
          isSyncingRef.current = true;
          rail.scrollTop = targetTop;
          // Clear the flag on next frame so user-initiated scrolls register.
          requestAnimationFrame(() => {
            isSyncingRef.current = false;
          });
        }
      }
    };
    update();
    const onScroll = term.onScroll(update);
    const onRender = term.onRender(update);
    return () => {
      onScroll.dispose();
      onRender.dispose();
    };
  }, [term]);

  // rail.scroll → term.scrollToLine
  const handleScroll = () => {
    if (isSyncingRef.current) return;
    const rail = railRef.current;
    if (!rail || state.cellHeight === 0) return;
    const targetLine = Math.round(rail.scrollTop / state.cellHeight);
    term.scrollToLine(targetLine);
  };

  return (
    <div className="terminal-scrollbar-rail" ref={railRef} onScroll={handleScroll}>
      <div
        className="terminal-scrollbar-spacer"
        style={{ height: state.totalLines * state.cellHeight }}
      />
    </div>
  );
}
