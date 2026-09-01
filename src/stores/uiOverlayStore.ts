import { create } from 'zustand';

/**
 * Tracks UI conditions under which the Web Browser pane must hide its embedded
 * NATIVE webview.
 *
 * The Web Browser pane embeds a NATIVE webview that the OS composites *above*
 * the HTML layer. Two consequences follow:
 *   1. HTML modals/dropdowns cannot paint over it — so whenever an overlay is
 *      up, the browser pane must hide its webview (`overlayOpen`). Rather than
 *      wire every modal (~12 components) to push/pop, a single MutationObserver
 *      detects the presence of any known overlay element by its (stable,
 *      convention-based) class name. This keeps a single source of truth and
 *      cannot "forget" a modal as long as it follows the `*-overlay` class
 *      convention listed below.
 *   2. The native window also swallows DOM drag/drop events, so a terminal tab
 *      dragged onto the browser pane never reaches the grid cell's drop handler.
 *      `sessionDragging` is set while a tab is being dragged so the webview hides
 *      and the underlying drop target is exposed (re-shown on drag end).
 */
interface UiOverlayState {
  /** True while at least one modal/dropdown overlay is mounted. */
  overlayOpen: boolean;
  setOverlayOpen: (open: boolean) => void;
  /** True while a session tab is being dragged (pane drop target must be live). */
  sessionDragging: boolean;
  setSessionDragging: (dragging: boolean) => void;
}

export const useUiOverlayStore = create<UiOverlayState>((set) => ({
  overlayOpen: false,
  setOverlayOpen: (open) =>
    set((s) => (s.overlayOpen === open ? s : { overlayOpen: open })),
  sessionDragging: false,
  setSessionDragging: (dragging) =>
    set((s) => (s.sessionDragging === dragging ? s : { sessionDragging: dragging })),
}));

/**
 * Full-screen modal overlays + dropdowns that can cover a pane. These are the
 * components in the "Modals" UI-consistency group plus the TabBar dropdown /
 * tab context menu. In-pane, non-covering overlays (`connecting-overlay`) are
 * deliberately excluded.
 *
 * When adding a new modal, add its overlay class here.
 */
const OVERLAY_SELECTOR = [
  '.settings-modal-overlay', // SettingsModal + HelpModal
  '.confirm-modal-overlay',
  '.paste-modal-overlay',
  '.system-prompt-modal-overlay',
  '.ssh-host-key-overlay',
  '.connection-dialog-overlay', // SessionDialog
  '.iap-vm-start-overlay',
  '.ai-consent-overlay', // AiConsentModal — mounted at app level, not nested

  '.save-to-tree-overlay',
  '.ctc-overlay', // CustomThemeCreator
  '.host-edit-modal-overlay', // HostTree + BookmarkTree add/edit modal
  '.add-bookmark-modal-overlay', // Web Browser ★ add-bookmark modal
  // NOTE: the Web Browser bookmarks menu (.web-browser-bookmark-menu) and the
  // ⋯ More panel (.web-browser-more-panel, incl. its inline clear-browsing-data
  // section) are deliberately NOT here — they dock beside the page (shrinking
  // the webview slot) rather than hiding it, so the page stays visible while
  // they are open.
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
 * once at app startup. Both the added and the removed branch test the mutated
 * nodes themselves, so heavy terminal/xterm DOM churn — which neither adds nor
 * removes anything matching the selector — costs a class-name check per node
 * and never a walk of the whole document.
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
      // A removal only matters when what left the DOM *was* an overlay, or
      // contained one (a modal unmounting together with its wrapper). This used
      // to call `recompute()` for any removal at all, which re-ran the
      // document-wide `querySelector` below — during bulk output xterm removes
      // rows continuously, and that made `querySelector` the second most
      // expensive function in a profile (13.2% self time). Both checks here are
      // scoped to the removed subtree, so a discarded row of terminal spans no
      // longer costs a scan of the entire document.
      for (const node of m.removedNodes) {
        if (
          node instanceof Element &&
          (node.matches(OVERLAY_SELECTOR) || node.querySelector(OVERLAY_SELECTOR) !== null)
        ) {
          // Still a full re-scan rather than a plain `false`: another overlay
          // (a nested modal, a dropdown) may well remain open.
          recompute();
          return;
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  recompute();
}
