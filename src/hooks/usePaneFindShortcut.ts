import { useEffect, useRef } from 'react';

export interface PaneFindHandlers {
  /** Ctrl+F — focus the pane's find box. */
  onFind: () => void;
  /** F3 — go to the next match. */
  onNext?: () => void;
  /** Shift+F3 — go to the previous match. */
  onPrev?: () => void;
}

/**
 * Find-bar shortcuts for a pane that owns searchable content:
 *   - Ctrl+F          → focus the find box
 *   - F3 / Shift+F3   → next / previous match
 *
 * Registered in the capture phase on `document` (same shape as
 * `usePaneKeyboardNav`) so the chord is consumed before xterm's own keydown
 * handler ever sees it.
 *
 * Unlike Ctrl+Tab and Ctrl+Shift+N, **Ctrl+F is a real terminal keybinding**
 * (readline forward-char, vim page-forward, the tmux prefix). Binding it
 * globally would steal it from every shell running in the app. So the listener
 * is scoped to the calling pane via `active` — which is `paneId ===
 * activePaneId` — and is completely inert whenever a terminal, browser, or AI
 * chat pane holds focus.
 */
export function usePaneFindShortcut(active: boolean, handlers: PaneFindHandlers): void {
  // Keep the latest callbacks without resubscribing the listener every render.
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!active) return;

    const handler = (e: KeyboardEvent) => {
      // Reject Alt/Meta so OS and browser combos are never shadowed.
      if (e.altKey || e.metaKey) return;

      if (e.ctrlKey && !e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        handlersRef.current.onFind();
        return;
      }

      if (e.key === 'F3' && !e.ctrlKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.shiftKey) handlersRef.current.onPrev?.();
        else handlersRef.current.onNext?.();
      }
    };

    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [active]);
}
