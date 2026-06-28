import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

/**
 * Resolve this webview's window label once, synchronously, at module load.
 *
 * For HoTTY's one-webview-per-window model the webview label equals the window
 * label, so this also identifies "which window am I" for per-window state
 * namespacing (see {@link windowScopedKey}).
 *
 * Outside Tauri (Vitest/jsdom, where `__TAURI_INTERNALS__` is absent) the call
 * throws; we fall back to `'main'` so stores compute the legacy unsuffixed keys
 * and existing tests keep their behavior.
 */
function resolveWindowLabel(): string {
  try {
    return getCurrentWebviewWindow().label || 'main';
  } catch {
    return 'main';
  }
}

/**
 * Whether we're running inside a Tauri webview (vs. Vitest/jsdom). Cross-window
 * features (event broadcast/listen) are no-ops outside Tauri.
 */
export const IS_TAURI: boolean =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** This window's label, resolved once at module load. */
export const WINDOW_LABEL: string = resolveWindowLabel();
