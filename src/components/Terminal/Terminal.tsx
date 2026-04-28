import { useEffect, useRef } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { SessionRecord } from '../../hooks/useSessionManager';
import { usePromptHighlight } from '../../hooks/usePromptHighlight';
import { tauriService } from '../../services/tauriService';
import { useSettingsStore } from '../../stores/settingsStore';
import { TERMINAL_SEQUENCES } from '../../constants/terminalSequences';
import '@xterm/xterm/css/xterm.css';
import './Terminal.css';

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

interface TerminalViewProps {
  session: SessionRecord;
  active: boolean;
  onPasteRequest?: (sessionId: string) => void;
}

export function TerminalView({ session, active, onPasteRequest }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rightClickPaste = useSettingsStore((s) => s.rightClickPaste);
  const terminalForeground = useSettingsStore((s) => s.terminalForeground);
  const terminalBackground = useSettingsStore((s) => s.terminalBackground);
  const terminalBackgroundInactive = useSettingsStore((s) => s.terminalBackgroundInactive);
  const enablePromptHighlight = useSettingsStore((s) => s.enablePromptHighlight);
  const promptHighlightColor = useSettingsStore((s) => s.promptHighlightColor);
  const promptPatterns = useSettingsStore((s) => s.promptPatterns);
  const lineWrapEnabled = useSettingsStore((s) => s.lineWrapEnabled);

  usePromptHighlight(session.term, enablePromptHighlight, promptHighlightColor, promptPatterns);

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

    // When line wrap is OFF, resize the terminal to a very large column count
    // so xterm renders a canvas wider than the viewport. Combined with
    // overflow-x: auto on the outer .terminal-view container, this reproduces
    // the v1 behaviour of a horizontal scrollbar that grows as the cursor
    // advances.
    const NO_WRAP_COLS = 5000;
    const resize = () => {
      try {
        // Toggle outer container horizontal overflow. The .wrap-off class is
        // applied via JSX className so React doesn't clobber it on re-render.
        el.style.overflowX = lineWrapEnabled ? 'hidden' : 'auto';
        if (lineWrapEnabled) {
          el.scrollLeft = 0; // reset leftover scroll from a prior wrap-off run
        }

        if (lineWrapEnabled) {
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

    // When line wrap is OFF, snap the horizontal scroll back to col 0 on
    // every line feed so pressing Enter brings the cursor back into view.
    let lineFeedDispose: { dispose: () => void } | undefined;
    if (!lineWrapEnabled) {
      lineFeedDispose = session.term.onLineFeed(() => {
        el.scrollLeft = 0;
      });
    }

    return () => {
      ro.disconnect();
      lineFeedDispose?.dispose();
    };
  }, [session, lineWrapEnabled]);

  useEffect(() => {
    if (active) session.term.focus();
  }, [active, session]);

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!rightClickPaste) return;
    e.preventDefault();
    onPasteRequest?.(session.id);
  };

  const className =
    `terminal-view${active ? ' active' : ''}${lineWrapEnabled ? '' : ' wrap-off'}`;

  return (
    <div
      className={className}
      ref={containerRef}
      onContextMenu={handleContextMenu}
    />
  );
}
