import { useCallback, useEffect, useRef, type CSSProperties } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { SessionRecord } from '../../hooks/useSessionManager';
import { tauriService } from '../../services/tauriService';
import { useSettingsStore } from '../../stores/settingsStore';
import { TERMINAL_SEQUENCES } from '../../constants/terminalSequences';
import { enableWebglRenderer } from '../../utils/xtermRenderer';
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

function applyXtermFontOptions(
  term: Terminal,
  fontSize: number,
  fontFamily: string,
  scrollback: number
): void {
  term.options.fontSize = fontSize;
  term.options.fontFamily = fontFamily;
  term.options.scrollback = scrollback;
}

interface TerminalXtermHostProps {
  session: SessionRecord;
  active: boolean;
}

const NO_WRAP_COLS = 5000;

// Initial-measurement retry. The first performResize runs before xterm has
// painted, so the renderer usually has no cell metrics yet and nothing can be
// measured; the ResizeObserver only fires on an actual size change, so without
// a retry nothing would try again while the session sits in 'connecting'. The
// backend waits up to 2s for that first report to size the INITIAL pty-req
// (resolve_initial_pty_size), and missing the window leaves a width-latching
// device (Huawei USG/VRP) pinned to the 80x24 fallback for the whole session.
// ~16ms x 60 ~= 1s, comfortably inside that window.
const MEASURE_RETRY_MS = 16;
const MEASURE_RETRY_LIMIT = 60;

/**
 * Hosts the xterm.js Terminal instance. Owns:
 *  - DOM mounting / re-attaching of the xterm element
 *  - DECAWM (line wrap) sequence application
 *  - Resize logic (Wrap ON: fitAddon.fit(), Wrap OFF: cols=5000 trick)
 *  - Horizontal scroll on this host element when wrap is OFF
 *  - Horizontal scroll reset on Enter (line feed) in wrap-off mode
 *  - Theme application
 *  - Reactive font and scrollback updates so Settings changes apply to
 *    already-open terminals (not just new sessions)
 */
export function TerminalXtermHost({ session, active }: TerminalXtermHostProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Whether the xterm renderer has produced at least one real cell measurement.
  // Before that, `session.term.cols` is xterm's placeholder 80 — we must not
  // report it to the backend, because the SSH connect path seeds the INITIAL
  // pty-req from the first reported size, and a premature 80 is exactly what
  // desyncs wrapped-line editing on devices that latch the pty width (e.g.
  // Huawei VRP) and ignore later window-change.
  const hasMeasuredRef = useRef(false);
  const terminalForeground = useSettingsStore((s) => s.terminalForeground);
  const terminalBackground = useSettingsStore((s) => s.terminalBackground);
  const terminalBackgroundInactive = useSettingsStore((s) => s.terminalBackgroundInactive);
  const lineWrapEnabled = useSettingsStore((s) => s.lineWrapEnabled);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const fontFamily = useSettingsStore((s) => s.fontFamily);
  const scrollback = useSettingsStore((s) => s.scrollback);

  // Fixed-size ("pinned") mode: the grid is locked to the width the device
  // latched at connect (session.ptyCols), reported via `session-pty-size`. Only
  // active once that width is known AND the session opted in. Undefined otherwise
  // (dynamic behaviour, which also feeds the initial pty-req before the event).
  const pinnedCols = session.fixedSize && session.ptyCols ? session.ptyCols : undefined;
  const effectiveBg = active ? terminalBackground : terminalBackgroundInactive;

  useEffect(() => {
    applyXtermTheme(session.term, terminalForeground, effectiveBg);
  }, [session, terminalForeground, effectiveBg]);

  // Compute terminal dimensions ourselves instead of using FitAddon.
  // FitAddon's `proposeDimensions` subtracts a hardcoded 14px from the
  // available width to reserve room for xterm's scrollbar — but we use
  // a separate scrollbar rail outside the host, so that 14px would just
  // become wasted gap between the rightmost cell and our marker.
  const computeDimensions = useCallback((): { cols: number; rows: number } | null => {
    const el = containerRef.current;
    if (!el) return null;
    const xtermEl = el.querySelector('.xterm') as HTMLElement | null;
    if (!xtermEl) return null;
    const dims = (session.term as unknown as {
      _core?: {
        _renderService?: {
          dimensions?: { css?: { cell?: { width?: number; height?: number } } };
        };
      };
    })._core?._renderService?.dimensions?.css?.cell;
    const cellWidth = dims?.width ?? 0;
    const cellHeight = dims?.height ?? 0;
    if (cellWidth <= 0 || cellHeight <= 0) return null;
    const style = window.getComputedStyle(xtermEl);
    const padW =
      parseInt(style.paddingLeft || '0', 10) + parseInt(style.paddingRight || '0', 10);
    const padH =
      parseInt(style.paddingTop || '0', 10) + parseInt(style.paddingBottom || '0', 10);
    const cols = Math.max(2, Math.floor((el.clientWidth - padW) / cellWidth));
    const rows = Math.max(1, Math.floor((el.clientHeight - padH) / cellHeight));
    return { cols, rows };
  }, [session]);

  const performResize = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    try {
      const measured = computeDimensions();
      if (pinnedCols) {
        // Pinned (width-latching device): keep the grid locked to the device's
        // connect-time width. Never reflow to the pane width — that would desync
        // the device's wrapping. Only the row count tracks the pane. Wider pane →
        // letterbox (CSS tint beside the grid); narrower pane → horizontal scroll
        // handled by the cursor-follow handlers below.
        const rows =
          measured?.rows ?? session.fitAddon.proposeDimensions()?.rows ?? session.term.rows;
        if (pinnedCols !== session.term.cols || rows !== session.term.rows) {
          session.term.resize(pinnedCols, rows);
        }
        // Widened so the whole grid fits again → drop any leftover scroll offset.
        if (el.scrollWidth <= el.clientWidth) el.scrollLeft = 0;
      } else if (lineWrapEnabled) {
        el.scrollLeft = 0; // reset leftover horizontal scroll
        if (measured) {
          if (measured.cols !== session.term.cols || measured.rows !== session.term.rows) {
            session.term.resize(measured.cols, measured.rows);
          }
        } else {
          // Fallback to FitAddon if our compute failed (e.g. before first paint)
          session.fitAddon.fit();
        }
      } else {
        const dim = measured ?? session.fitAddon.proposeDimensions();
        if (dim) {
          const newCols = Math.max(dim.cols, NO_WRAP_COLS);
          session.term.resize(newCols, dim.rows);
        }
      }

      // Only notify the backend once the renderer has produced a real cell
      // measurement. Both our own compute and FitAddon's proposeDimensions read
      // the same cell metrics, so either succeeding means "measured"; until then
      // term.cols is xterm's placeholder 80. Reporting that placeholder would let
      // the connect path bake it into the INITIAL pty-req, which is exactly what
      // desyncs wrapped-line editing on devices that latch the pty width and
      // ignore later window-change (e.g. Huawei VRP). See hasMeasuredRef.
      if (!hasMeasuredRef.current && (measured || session.fitAddon.proposeDimensions())) {
        hasMeasuredRef.current = true;
      }
      if (hasMeasuredRef.current) {
        const { cols, rows } = session.term;
        tauriService.resize(session.id, cols, rows).catch(() => {});
      }
    } catch {
      /* compute/resize can throw if element not in DOM yet */
    }
  }, [session, lineWrapEnabled, pinnedCols, computeDimensions]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const termEl = (session.term as unknown as { element?: HTMLElement }).element;
    if (termEl) {
      if (termEl.parentElement !== el) el.appendChild(termEl);
    } else {
      session.term.open(el);
    }
    // Hardware-accelerated rendering, once per Terminal (this effect re-runs on
    // every re-attach). Falls back to the DOM renderer on any failure.
    enableWebglRenderer(session.term);
    // Apply DECAWM after open to ensure it takes effect before server data
    // renders. Fixed-size sessions are always wrap-ON (grid pinned to the
    // device's width), regardless of the global setting.
    const wrap = useSettingsStore.getState().lineWrapEnabled || session.fixedSize;
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

    // Suppress xterm.js's internal paste handler. xterm attaches a `paste`
    // listener on its helper textarea that calls term.paste() → onData →
    // sendInput(), which would bypass the paste-confirmation modal. The
    // capture-phase listener on the host runs before xterm's bubble-phase
    // textarea listener, so preventing default here blocks the auto-paste.
    // The Ctrl+V keydown path in useSessionManager remains the sole driver
    // of the modal.
    const suppressPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    el.addEventListener('paste', suppressPaste, true);

    performResize();
    // Retry until the renderer produces a real measurement (see the constants
    // above for why a single pass at mount is not enough).
    let retries = 0;
    let measureTimer: number | undefined;
    const retryMeasure = () => {
      measureTimer = undefined;
      if (hasMeasuredRef.current) return;
      performResize();
      if (!hasMeasuredRef.current && ++retries < MEASURE_RETRY_LIMIT) {
        measureTimer = window.setTimeout(retryMeasure, MEASURE_RETRY_MS);
      }
    };
    if (!hasMeasuredRef.current) {
      measureTimer = window.setTimeout(retryMeasure, MEASURE_RETRY_MS);
    }

    const ro = new ResizeObserver(performResize);
    ro.observe(el);

    // Horizontal-scroll modes (wrap OFF, or pinned/fixed-size where the grid can
    // exceed the pane): snap scroll back to col 0 on every line feed AND
    // auto-scroll to keep the cursor visible when editing past the right edge.
    let lineFeedDispose: { dispose: () => void } | undefined;
    let cursorMoveDispose: { dispose: () => void } | undefined;
    if (!lineWrapEnabled || pinnedCols) {
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
      if (measureTimer !== undefined) clearTimeout(measureTimer);
      ro.disconnect();
      lineFeedDispose?.dispose();
      cursorMoveDispose?.dispose();
      el.removeEventListener('paste', suppressPaste, true);
    };
  }, [session, lineWrapEnabled, pinnedCols, performResize]);

  // Reactive xterm options. Settings changes must reach already-open terminals,
  // not just new sessions. Cell size changes with the font, so re-trigger
  // resize on the next frame to recompute cols/rows and notify the backend.
  useEffect(() => {
    applyXtermFontOptions(session.term, fontSize, fontFamily, scrollback);
    const raf = requestAnimationFrame(() => {
      performResize();
    });
    return () => cancelAnimationFrame(raf);
  }, [session, fontSize, fontFamily, scrollback, performResize]);

  // Focus the active terminal — but never while it is still connecting. The
  // pane is mounted during 'connecting' (so xterm can measure before the
  // pty-req) and the modal connect dialog is on top of it at that point;
  // grabbing focus here would fight the dialog's focus trap. App focuses the
  // terminal when the dialog hands off on 'connected'.
  useEffect(() => {
    if (active && session.status !== 'connecting') session.term.focus();
  }, [active, session]);

  return (
    <div
      className={`terminal-xterm-host${
        pinnedCols ? ' fixed-cols' : lineWrapEnabled ? '' : ' wrap-off'
      }`}
      // `--pinned-term-bg` paints the grid-sized `.xterm-screen` in fixed-cols
      // mode so the host's letterbox tint shows only in the unused strip beside
      // the grid (see Terminal.css). Harmless when not pinned.
      style={{ '--pinned-term-bg': effectiveBg } as CSSProperties}
      ref={containerRef}
    />
  );
}
