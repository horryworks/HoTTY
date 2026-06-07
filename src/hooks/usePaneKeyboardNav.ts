import { useEffect } from 'react';
import { usePaneStore } from '../stores/paneStore';

/**
 * Keyboard-only pane focus navigation:
 *   - Ctrl+Tab        → next visible pane
 *   - Ctrl+Shift+Tab  → previous visible pane
 *
 * Registered in the capture phase on `document` so it runs before xterm's own
 * keydown handler on the terminal textarea. `stopImmediatePropagation()` then
 * keeps the event from ever reaching xterm, so Ctrl+Tab is never written to the
 * terminal — no change to the xterm custom key handler is required.
 *
 * Ctrl+Tab cannot be represented as a distinct byte sequence in the classic
 * terminal protocol, so intercepting it does not steal any keybinding from the
 * shell, vim, tmux, etc. running inside the pane.
 */
export function usePaneKeyboardNav(): void {
  const cycleActivePane = usePaneStore((s) => s.cycleActivePane);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only Ctrl(+Shift)+Tab. Reject Alt/Meta so we don't shadow OS combos.
      if (e.key !== 'Tab' || !e.ctrlKey || e.altKey || e.metaKey) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      cycleActivePane(e.shiftKey ? -1 : 1);
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [cycleActivePane]);
}
