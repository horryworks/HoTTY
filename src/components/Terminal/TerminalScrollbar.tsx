import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Terminal } from '@xterm/xterm';

interface TerminalScrollbarProps {
  term: Terminal;
}

/**
 * Custom vertical scrollbar that lives in its own DOM rail (outside the
 * xterm host) so it stays anchored to the pane's right edge regardless of
 * the host's horizontal scroll position. Bidirectionally synced with the
 * xterm scrollback state via `term.scrollToLine` / `term.buffer.viewportY`.
 *
 * Visual styling comes from the global `::-webkit-scrollbar` rules in
 * `src/index.css`, so the scrollbar matches the rest of the app's chrome.
 *
 * Spacer height is written imperatively (via ref) rather than via React state
 * so it lands in the DOM synchronously *before* `rail.scrollTop` is assigned.
 * Otherwise the browser clamps scrollTop to the previous (smaller) spacer
 * height, then later fires a scroll event with the clamped value, which
 * `handleScroll` would incorrectly forward to `term.scrollToLine` and rewind
 * the xterm viewport — hiding new lines (e.g. the prompt) just below the
 * visible area until further input forces another scroll.
 */
export function TerminalScrollbar({ term }: TerminalScrollbarProps) {
  const { t } = useTranslation();
  const railRef = useRef<HTMLDivElement | null>(null);
  const spacerRef = useRef<HTMLDivElement | null>(null);
  const isSyncingRef = useRef(false);
  const cellHeightRef = useRef(17);

  useEffect(() => {
    let rafId = 0;

    const update = () => {
      const buffer = term.buffer.active;
      const totalLines = buffer.length;
      const viewportY = buffer.viewportY;
      const dims = (term as unknown as {
        _core?: { _renderService?: { dimensions?: { css?: { cell?: { height?: number } } } } };
      })._core?._renderService?.dimensions?.css?.cell?.height;
      const cellHeight = typeof dims === 'number' && dims > 0 ? dims : 17;
      cellHeightRef.current = cellHeight;

      const rail = railRef.current;
      const spacer = spacerRef.current;

      // Read before writing. `update` runs on every rendered frame, and reading
      // scrollTop *after* changing the spacer's height forces the browser to
      // recompute layout synchronously each time. Growing the spacer does not
      // move scrollTop, so the value read here stays valid for the comparison
      // below.
      const currentTop = rail ? rail.scrollTop : 0;

      if (spacer) {
        const newHeight = `${totalLines * cellHeight}px`;
        if (spacer.style.height !== newHeight) {
          spacer.style.height = newHeight;
        }
      }

      if (rail) {
        const targetTop = viewportY * cellHeight;
        if (Math.abs(currentTop - targetTop) > 0.5) {
          isSyncingRef.current = true;
          rail.scrollTop = targetTop;
          // At most one pending frame: a burst of syncs before the callback
          // runs used to queue a callback each, all doing the same assignment.
          if (rafId === 0) {
            rafId = requestAnimationFrame(() => {
              rafId = 0;
              isSyncingRef.current = false;
            });
          }
        }
      }
    };
    update();
    const onScroll = term.onScroll(update);
    const onRender = term.onRender(update);
    return () => {
      onScroll.dispose();
      onRender.dispose();
      if (rafId !== 0) cancelAnimationFrame(rafId);
    };
  }, [term]);

  const handleScroll = () => {
    if (isSyncingRef.current) return;
    const rail = railRef.current;
    const cellHeight = cellHeightRef.current;
    if (!rail || cellHeight === 0) return;
    const targetLine = Math.round(rail.scrollTop / cellHeight);
    term.scrollToLine(targetLine);
  };

  return (
    <div
      className="terminal-scrollbar-rail"
      ref={railRef}
      onScroll={handleScroll}
      aria-label={t('terminal.scrollbar')}
    >
      <div className="terminal-scrollbar-spacer" ref={spacerRef} />
    </div>
  );
}
