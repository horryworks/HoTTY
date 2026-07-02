import { create } from 'zustand';

/**
 * Per-pane zoom levels for Web Browser panes (session-scoped, NOT persisted).
 *
 * Each Web Browser pane keeps its own zoom percentage, keyed by paneId. This
 * store is deliberately in-memory only: a browser pane's URL is not persisted
 * across app restart (a reopened pane is blank), so per-pane zoom has no meaning
 * across restarts — the persisted global default (`settingsStore.webBrowserDefaultZoom`)
 * covers newly opened panes. Keeping it here (rather than in component state)
 * lets a pane's zoom survive a slot move / remount, matching the native webview
 * which is reused across the same paneId. It is also written from the
 * `web-browser-zoom-state` event so WebView2's own Ctrl+± / Ctrl+wheel stays in sync.
 *
 * Entries are removed on tab close (see App.handleCloseTab, beside webBrowserDestroy).
 */
interface WebBrowserZoomState {
  /** paneId → current zoom percentage. Absent means "use the global default". */
  zoom: Record<string, number>;
  setZoom: (paneId: string, zoom: number) => void;
  removeZoom: (paneId: string) => void;
}

export const useWebBrowserZoomStore = create<WebBrowserZoomState>((set) => ({
  zoom: {},
  setZoom: (paneId, zoom) =>
    set((s) => (s.zoom[paneId] === zoom ? s : { zoom: { ...s.zoom, [paneId]: zoom } })),
  removeZoom: (paneId) =>
    set((s) => {
      if (!(paneId in s.zoom)) return s;
      const next = { ...s.zoom };
      delete next[paneId];
      return { zoom: next };
    }),
}));
