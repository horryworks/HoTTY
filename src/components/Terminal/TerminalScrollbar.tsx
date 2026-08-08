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
  // Mirror of `rail.scrollTop`. Reading the real property inside `update` cost a
  // forced synchronous layout on *every* rendered frame: xterm has just rewritten
  // its rows, so the box tree is dirty and the getter must flush it before it can
  // answer. Reading before writing the spacer (the previous fix) only avoided the
  // invalidation this component caused itself — it could do nothing about the one
  // xterm causes. Nothing moves the rail except our own writes and the user, and
  // both paths refresh this mirror; the user path does it from inside a `scroll`
  // handler, where layout has already settled and the read is free.
  const lastTopRef = useRef(0);

  useEffect(() => {
    let rafId = 0;
    // Seed once per term binding. From here on the mirror is maintained by the
    // two paths that can move the rail, so `update` never touches the DOM getter.
    lastTopRef.current = railRef.current ? railRef.current.scrollTop : 0;

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

      if (spacer) {
        const newHeight = `${totalLines * cellHeight}px`;
        if (spacer.style.height !== newHeight) {
          spacer.style.height = newHeight;
        }
      }

      if (rail) {
        const targetTop = viewportY * cellHeight;
        if (Math.abs(lastTopRef.current - targetTop) > 0.5) {
          isSyncingRef.current = true;
          // Spacer height is already in the DOM at this point, so the assignment
          // below is not clamped and the rail really does land on `targetTop`.
          rail.scrollTop = targetTop;
          lastTopRef.current = targetTop;
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
    const rail = railRef.current;
    if (!rail) return;
    // The one place the mirror is refreshed from the DOM. A scroll event is
    // dispatched after layout has settled, so this read is cheap. It runs even
    // for the events our own sync provokes, because that is what corrects the
    // mirror if the browser ever clamps a value we wrote.
    lastTopRef.current = rail.scrollTop;
    if (isSyncingRef.current) return;
    const cellHeight = cellHeightRef.current;
    if (cellHeight === 0) return;
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
