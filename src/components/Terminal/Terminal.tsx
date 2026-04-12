import { useEffect, useRef } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { SessionRecord } from '../../hooks/useSessionManager';
import { tauriService } from '../../services/tauriService';
import { useSettingsStore } from '../../stores/settingsStore';
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

    const resize = () => {
      try {
        session.fitAddon.fit();
        const { cols, rows } = session.term;
        tauriService.resize(session.id, cols, rows).catch(() => {});
      } catch {
        /* fit can throw if element not in DOM yet */
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    return () => {
      ro.disconnect();
    };
  }, [session]);

  useEffect(() => {
    if (active) session.term.focus();
  }, [active, session]);

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!rightClickPaste) return;
    e.preventDefault();
    onPasteRequest?.(session.id);
  };

  return (
    <div
      className={`terminal-view${active ? ' active' : ''}`}
      ref={containerRef}
      onContextMenu={handleContextMenu}
    />
  );
}
