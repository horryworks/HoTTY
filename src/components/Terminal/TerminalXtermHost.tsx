import { useEffect, useRef } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { SessionRecord } from '../../hooks/useSessionManager';
import { tauriService } from '../../services/tauriService';
import { useSettingsStore } from '../../stores/settingsStore';
import { TERMINAL_SEQUENCES } from '../../constants/terminalSequences';
import '@xterm/xterm/css/xterm.css';

function applyXtermTheme(
  term: Terminal,
  foreground: string,
  background: string
): void {
  term.options.theme = {
    ...(term.options.theme ?? {}),
    foreground,
    background,
    cursor: foreground,
    cursorAccent: background,
  };
}

interface TerminalXtermHostProps {
  session: SessionRecord;
  active: boolean;
}

const NO_WRAP_COLS = 5000;

/**
 * Hosts the xterm.js Terminal instance. Owns:
 *  - DOM mounting / re-attaching of the xterm element
 *  - DECAWM (line wrap) sequence application
 *  - Resize logic (Wrap ON: fitAddon.fit(), Wrap OFF: cols=5000 trick)
 *  - Horizontal scroll on this host element when wrap is OFF
 *  - Horizontal scroll reset on Enter (line feed) in wrap-off mode
 *  - Theme application
 */
export function TerminalXtermHost({ session, active }: TerminalXtermHostProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalForeground = useSettingsStore((s) => s.terminalForeground);
  const terminalBackground = useSettingsStore((s) => s.terminalBackground);
  const terminalBackgroundInactive = useSettingsStore((s) => s.terminalBackgroundInactive);
  const lineWrapEnabled = useSettingsStore((s) => s.lineWrapEnabled);

  useEffect(() => {
    const effectiveBg = active ? terminalBackground : terminalBackgroundInactive;
    applyXtermTheme(session.term, terminalForeground, effectiveBg);
  }, [session, active, terminalForeground, terminalBackground, terminalBackgroundInactive]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const termEl = (session.term as unknown as { element?: HTMLElement }).element;
    if (termEl) {
      if (termEl.parentElement !== el) el.appendChild(termEl);
    } else {
      session.term.open(el);
    }
    // Apply DECAWM after open to ensure it takes effect before server data renders
    const wrap = useSettingsStore.getState().lineWrapEnabled;
    session.term.write(
      wrap ? TERMINAL_SEQUENCES.LINE_WRAP_ENABLED : TERMINAL_SEQUENCES.LINE_WRAP_DISABLED
    );

    // Forcibly hide the xterm-viewport's native scrollbar via inline style.
    // Our CSS `overflow: hidden !important` on `.xterm-viewport` was being
    // overridden in WebView2 (root cause unclear, possibly a stylesheet load
    // order issue), so we set it on the live DOM after term.open() to be
    // 100% certain it takes effect.
    const viewportEl = el.querySelector('.xterm-viewport') as HTMLElement | null;
    if (viewportEl) {
      viewportEl.style.overflow = 'hidden';
    }

    const resize = () => {
      try {
        if (lineWrapEnabled) {
          el.scrollLeft = 0; // reset leftover horizontal scroll
          session.fitAddon.fit();
        } else {
          const proposed = session.fitAddon.proposeDimensions();
          if (proposed) {
            const newCols = Math.max(proposed.cols, NO_WRAP_COLS);
            session.term.resize(newCols, proposed.rows);
          }
        }
        const { cols, rows } = session.term;
        tauriService.resize(session.id, cols, rows).catch(() => {});
      } catch {
        /* fit can throw if element not in DOM yet */
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    // Wrap OFF: snap horizontal scroll back to col 0 on every line feed AND
    // auto-scroll to keep the cursor visible when typing past the right edge.
    let lineFeedDispose: { dispose: () => void } | undefined;
    let cursorMoveDispose: { dispose: () => void } | undefined;
    if (!lineWrapEnabled) {
      lineFeedDispose = session.term.onLineFeed(() => {
        el.scrollLeft = 0;
      });
      cursorMoveDispose = session.term.onCursorMove(() => {
        const dims = (session.term as unknown as {
          _core?: {
            _renderService?: { dimensions?: { css?: { cell?: { width?: number } } } };
          };
        })._core?._renderService?.dimensions?.css?.cell?.width;
        const cellWidth = typeof dims === 'number' && dims > 0 ? dims : 9;
        const cursorX = session.term.buffer.active.cursorX;
        const cursorPx = cursorX * cellWidth;
        const visibleLeft = el.scrollLeft;
        const visibleRight = visibleLeft + el.clientWidth;
        // Add one cell of margin so the cursor isn't flush against the edge.
        const margin = cellWidth;
        if (cursorPx + margin > visibleRight) {
          el.scrollLeft = cursorPx + margin - el.clientWidth;
        } else if (cursorPx < visibleLeft) {
          el.scrollLeft = Math.max(0, cursorPx - margin);
        }
      });
    }

    return () => {
      ro.disconnect();
      lineFeedDispose?.dispose();
      cursorMoveDispose?.dispose();
    };
  }, [session, lineWrapEnabled]);

  useEffect(() => {
    if (active) session.term.focus();
  }, [active, session]);

  return (
    <div
      className={`terminal-xterm-host${lineWrapEnabled ? '' : ' wrap-off'}`}
      ref={containerRef}
    />
  );
}
