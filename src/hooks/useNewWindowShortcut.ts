import { useEffect } from 'react';
import { tauriService } from '../services/tauriService';

/**
 * Global "New Window" shortcut: Ctrl+Shift+N opens another HoTTY window in the
 * same process (see {@link tauriService.createWindow}).
 *
 * Registered in the capture phase on `document` (same approach as
 * {@link usePaneKeyboardNav}) so it runs before xterm's keydown handler and the
 * combo is never written to the terminal. Ctrl+Shift+N has no classic terminal
 * byte sequence, so intercepting it steals no shell/vim/tmux keybinding.
 */
export function useNewWindowShortcut(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore auto-repeat so holding the chord doesn't spawn a window per tick.
      if (e.repeat) return;
      // Ctrl+Shift+N only. Reject Alt/Meta so we don't shadow OS combos.
      if (!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return;
      // `e.key` is 'N' when Shift is held; accept either case defensively.
      if (e.key !== 'N' && e.key !== 'n') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      void tauriService.createWindow();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);
}
