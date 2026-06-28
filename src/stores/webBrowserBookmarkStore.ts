import { create } from 'zustand';

/**
 * One-shot bookmark-request bus for Web Browser panes.
 *
 * The tab-bar "Add Bookmark…" context-menu item asks a specific Web Browser pane
 * to open its AddBookmarkModal (the same action as the ☆ toolbar button). That
 * pane may be UNMOUNTED at request time (a hidden web-browser tab is in no slot),
 * so the request must survive until the target pane mounts and consumes it — it is
 * never auto-expired. `nonce` increments on every request so the consumer effect
 * re-fires even for a repeat request against an already-mounted pane.
 */
interface WebBrowserBookmarkState {
  /** paneId awaiting a bookmark-modal open, or null when none is pending. */
  pendingPaneId: string | null;
  /** Monotonic counter; bumped on each request to re-fire the consumer effect. */
  nonce: number;
  requestBookmark: (paneId: string) => void;
  consumeBookmark: (paneId: string) => void;
}

export const useWebBrowserBookmarkStore = create<WebBrowserBookmarkState>((set) => ({
  pendingPaneId: null,
  nonce: 0,
  requestBookmark: (paneId) => set((s) => ({ pendingPaneId: paneId, nonce: s.nonce + 1 })),
  consumeBookmark: (paneId) =>
    set((s) => (s.pendingPaneId === paneId ? { pendingPaneId: null } : s)),
}));
