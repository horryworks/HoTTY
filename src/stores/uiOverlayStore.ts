import { create } from 'zustand';

/**
 * Tracks whether any full-screen modal/dropdown overlay is currently open.
 *
 * The Web Browser pane embeds a NATIVE webview that the OS composites *above*
 * the HTML layer — HTML modals cannot paint over it. So whenever an overlay is
 * up, the browser pane must hide its webview. Rather than wire every modal
 * (~12 components) to push/pop, a single MutationObserver detects the presence
 * of any known overlay element by its (stable, convention-based) class name.
 * This keeps a single source of truth and cannot "forget" a modal as long as it
 * follows the `*-overlay` class convention listed below.
 */
interface UiOverlayState {
  /** True while at least one modal/dropdown overlay is mounted. */
  overlayOpen: boolean;
  setOverlayOpen: (open: boolean) => void;
}

export const useUiOverlayStore = create<UiOverlayState>((set) => ({
  overlayOpen: false,
  setOverlayOpen: (open) =>
    set((s) => (s.overlayOpen === open ? s : { overlayOpen: open })),
}));

/**
 * Full-screen modal overlays + dropdowns that can cover a pane. These are the
 * components in the "Modals" UI-consistency group plus the TabBar dropdown /
 * tab context menu. In-pane, non-covering overlays (`connecting-overlay`,
 * `text-editor-*-overlay`) are deliberately excluded.
 *
 * When adding a new modal, add its overlay class here.
 */
const OVERLAY_SELECTOR = [
  '.settings-modal-overlay', // SettingsModal + HelpModal
  '.confirm-modal-overlay',
  '.save-confirm-modal-overlay',
  '.paste-modal-overlay',
  '.ask-ai-modal-overlay',
  '.system-prompt-modal-overlay',
  '.ssh-host-key-overlay',
  '.connection-dialog-overlay', // SessionDialog
  '.iap-vm-start-overlay',
  '.save-to-tree-overlay',
  '.ctc-overlay', // CustomThemeCreator
  '.host-edit-modal-overlay', // HostTree + BookmarkTree add/edit modal
  '.add-bookmark-modal-overlay', // Web Browser ★ add-bookmark modal
  '.features-dropdown', // TabBar features menu
  '.tab-context-menu',
  '.context-menu', // HostTree / BookmarkTree right-click menu
].join(',');

let observer: MutationObserver | null = null;

function recompute(): void {
  // Guard against `document` being gone (SSR / a queued mutation firing during
  // a test environment teardown). No-op in the real app, where it always exists.
  if (typeof document === 'undefined') return;
  const open = document.querySelector(OVERLAY_SELECTOR) !== null;
  useUiOverlayStore.getState().setOverlayOpen(open);
}

/**
 * Start observing the DOM for overlay mount/unmount. Idempotent; safe to call
 * once at app startup. The callback only inspects added/removed *element* nodes
 * that match the overlay selector, so heavy terminal/xterm DOM churn (which
 * adds non-matching nodes) is cheap to skip.
 */
export function initOverlayWatcher(): void {
  if (observer || typeof document === 'undefined') return;

  observer = new MutationObserver((mutations) => {
    if (typeof document === 'undefined') return;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node instanceof Element && node.matches(OVERLAY_SELECTOR)) {
          useUiOverlayStore.getState().setOverlayOpen(true);
          return;
        }
      }
      // A removal might have closed the last overlay — re-evaluate.
      if (m.removedNodes.length > 0) {
        recompute();
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  recompute();
}
