import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { tauriService } from '../../services/tauriService';
import { useUiOverlayStore } from '../../stores/uiOverlayStore';
import { useWebBrowserBookmarkStore } from '../../stores/webBrowserBookmarkStore';
import { useBookmarkStore } from '../../stores/bookmarkStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useWebBrowserZoomStore } from '../../stores/webBrowserZoomStore';
import { findBookmarkByUrl, flattenBookmarks } from '../BookmarkTree/bookmarkTreeHelpers';
import { logError } from '../../utils/logger';
import i18n from '../../i18n';
import type { WebBrowserRect, WebBrowserClearDataOptions, BookmarkNode } from '../../types/appTypes';
import { normalizeUrl, resolveAddress } from './webBrowserUrl';
import { canZoomIn, canZoomOut, clampZoom, nextZoom, prevZoom } from './webBrowserZoom';
import { AddBookmarkModal } from './AddBookmarkModal';
import { ClearBrowsingDataSection } from './ClearBrowsingDataSection';
import { BookmarkMenu } from './BookmarkMenu';
import './WebBrowserPane.css';

interface WebBrowserPaneProps {
  paneId: string;
  /** Whether this pane's slot is the active one. Unused for visibility — the
   *  embedded webview stays shown while mounted regardless of active state. */
  active: boolean;
  /** Initial URL to load (e.g. opened from a Web bookmark). Defaults to blank. */
  initialUrl?: string;
  /** Called with the current page URL whenever it changes, so the host (App)
   *  can keep the tab name in sync with what is being browsed. */
  onUrlChange?: (url: string) => void;
  /** Open a URL in a brand-new Web Browser pane (each pane hosts one webview, so
   *  "Open All" on a bookmark folder fans out into multiple panes). */
  onOpenInNewPane?: (url: string) => void;
  /** Called when the user clicks/tabs into the page (the native webview gains
   *  focus). Page clicks never reach the DOM, so the host uses this to move
   *  pane focus to this pane. */
  onPageFocus?: () => void;
}

const INITIAL_URL = 'about:blank';
/** Debounce for bounds updates (~1.5 frames) to smooth resize/drag churn. */
const BOUNDS_DEBOUNCE_MS = 24;
/** Poll cadence for position-only layout shifts the ResizeObserver misses. */
const POSITION_POLL_MS = 150;

/** Measure the body div in physical pixels, relative to the window client area. */
function measureRect(el: HTMLElement): WebBrowserRect {
  const r = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  return {
    x: r.left * dpr,
    y: r.top * dpr,
    width: r.width * dpr,
    height: r.height * dpr,
  };
}

function rectsEqual(a: WebBrowserRect | null, b: WebBrowserRect): boolean {
  if (!a) return false;
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

export function WebBrowserPane({
  paneId,
  initialUrl,
  onUrlChange,
  onOpenInNewPane,
  onPageFocus,
}: WebBrowserPaneProps) {
  const { t } = useTranslation();
  const overlayOpen = useUiOverlayStore((s) => s.overlayOpen);
  const sessionDragging = useUiOverlayStore((s) => s.sessionDragging);
  // Tab-bar "Add Bookmark…" request bus — open this pane's bookmark modal when the
  // pending request targets our paneId (mirrors the ☆ toolbar button).
  const consumeBookmark = useWebBrowserBookmarkStore((s) => s.consumeBookmark);
  const bookmarkTree = useBookmarkStore((s) => s.tree);
  const deleteBookmark = useBookmarkStore((s) => s.deleteNode);
  // Zoom: the global default (applied to new panes) and this pane's own level.
  // The pane's level lives in a session store keyed by paneId so it survives a
  // slot move/remount (the native webview is reused) and is updated by the
  // `web-browser-zoom-state` event (also catches WebView2's Ctrl+± / Ctrl+wheel).
  const defaultZoom = useSettingsStore((s) => s.webBrowserDefaultZoom);
  const updateSetting = useSettingsStore((s) => s.update);
  const setPaneZoom = useWebBrowserZoomStore((s) => s.setZoom);
  const storedZoom = useWebBrowserZoomStore((s) => s.zoom[paneId]);
  const zoom = storedZoom ?? defaultZoom;
  // Hide the native webview when an overlay covers it OR a tab is being dragged:
  // in both cases the OS-composited webview would otherwise block the HTML layer
  // (paint for overlays, DOM drag/drop events for the pane drop target).
  const webviewHidden = overlayOpen || sessionDragging;

  // Normalized start URL (schemeless input → http://). Stable per pane: derived
  // from the `initialUrl` prop, which never changes for a given pane.
  const startUrl = initialUrl ? normalizeUrl(initialUrl) : INITIAL_URL;
  const initialAddress = startUrl === INITIAL_URL ? '' : startUrl;

  const [addressInput, setAddressInput] = useState(initialAddress);
  const [currentUrl, setCurrentUrl] = useState(initialAddress);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);
  const [bookmarkOpen, setBookmarkOpen] = useState(false);
  const [bookmarkMenuOpen, setBookmarkMenuOpen] = useState(false);
  // Whether the "⋯ More" panel is open. Like the bookmarks panel it docks at the
  // right edge of the body row (directly below the ⋯ button) rather than floating:
  // HTML cannot paint over the OS-composited native webview, so the webview slot
  // shrinks horizontally beside it and the page stays visible — essential for the
  // zoom stepper, whose effect the user needs to watch live.
  const [moreOpen, setMoreOpen] = useState(false);
  // Back/forward availability, pushed from the backend (WebView2 HistoryChanged).
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  const bodyRef = useRef<HTMLDivElement>(null);
  const bookmarkWrapRef = useRef<HTMLDivElement>(null);
  const bookmarkPanelRef = useRef<HTMLDivElement>(null);
  const moreToggleRef = useRef<HTMLButtonElement>(null);
  const morePanelRef = useRef<HTMLDivElement>(null);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const lastRectRef = useRef<WebBrowserRect | null>(null);
  const debounceRef = useRef<number | null>(null);
  const addressFocusedRef = useRef(false);
  // Mirror `webviewHidden` so reportBounds (a stable callback) can read it without
  // re-subscribing: never reposition a parked webview, or it pops back on-screen
  // over a modal / the pane drop target while the layout reflows.
  const webviewHiddenRef = useRef(false);
  // Keep the latest onUrlChange without re-subscribing the nav-state listener.
  const onUrlChangeRef = useRef(onUrlChange);
  useEffect(() => {
    onUrlChangeRef.current = onUrlChange;
  }, [onUrlChange]);
  // Same for onPageFocus (the focus listener below subscribes once per paneId).
  const onPageFocusRef = useRef(onPageFocus);
  useEffect(() => {
    onPageFocusRef.current = onPageFocus;
  }, [onPageFocus]);

  // Whether the current page is already saved as a bookmark (controls the ★ icon
  // fill and whether clicking it adds or removes the bookmark).
  const isBookmarked = useMemo(
    () => currentUrl !== '' && currentUrl !== INITIAL_URL && !!findBookmarkByUrl(bookmarkTree, currentUrl),
    [bookmarkTree, currentUrl],
  );

  // Apply a new committed URL: sync the address bar (unless the user is typing)
  // and notify the host so the tab name tracks the browsed site.
  const applyCurrentUrl = useCallback((url: string) => {
    setCurrentUrl(url);
    if (!addressFocusedRef.current) setAddressInput(url);
    onUrlChangeRef.current?.(url);
  }, []);

  const focusAddress = useCallback(() => {
    const el = addressInputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  // Apply a zoom level to this pane's webview. Optimistically updates the store
  // (snappy `%` display); the backend's ZoomFactorChanged echo then confirms it.
  const applyZoom = useCallback(
    (pct: number) => {
      const clamped = clampZoom(pct);
      setPaneZoom(paneId, clamped);
      tauriService.webBrowserSetZoom(paneId, clamped).catch(() => {});
    },
    [paneId, setPaneZoom],
  );

  // Report the body rectangle to the backend so it repositions the webview.
  const reportBounds = useCallback(
    (immediate = false) => {
      const el = bodyRef.current;
      if (!el || !created || webviewHiddenRef.current) return;
      const rect = measureRect(el);
      if (!immediate && rectsEqual(lastRectRef.current, rect)) return;
      lastRectRef.current = rect;
      const send = () => tauriService.webBrowserSetBounds(paneId, rect).catch(() => {});
      if (immediate) {
        send();
        return;
      }
      if (debounceRef.current != null) clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(send, BOUNDS_DEBOUNCE_MS);
    },
    [paneId, created],
  );

  // Create the child webview on mount; hide (not destroy) on unmount so the page
  // survives a slot move/remount. Destroy happens on tab close (App.handleCloseTab).
  useEffect(() => {
    let cancelled = false;
    const raf = requestAnimationFrame(() => {
      const el = bodyRef.current;
      if (cancelled || !el) return;
      const rect = measureRect(el);
      lastRectRef.current = rect;
      // Resolve the initial zoom imperatively (not via reactive deps) so this
      // create effect never re-runs just because a zoom value changed: this
      // pane's remembered level if any, else the global default.
      const initialZoom =
        useWebBrowserZoomStore.getState().zoom[paneId] ??
        useSettingsStore.getState().webBrowserDefaultZoom;
      tauriService
        .webBrowserCreate(paneId, startUrl, rect, clampZoom(initialZoom))
        .then(async () => {
          if (cancelled) return;
          setCreated(true);
          // Restore the address bar after a pane move: reusing an existing
          // webview fires no page-load event, so pull its current URL.
          try {
            const cur = await tauriService.webBrowserCurrentUrl(paneId);
            if (!cancelled && cur && cur !== 'about:blank') {
              applyCurrentUrl(cur);
            }
          } catch {
            /* ignore — address bar just stays as-is */
          }
        })
        .catch((e) => {
          if (!cancelled) logError('web-browser', i18n.t('notifications.errors.browserPaneCreate'), e);
        });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (debounceRef.current != null) clearTimeout(debounceRef.current);
      tauriService.webBrowserSetVisible(paneId, false).catch(() => {});
    };
  }, [paneId, startUrl, applyCurrentUrl]);

  // Keep the webview aligned with the body across size/position changes.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => reportBounds());
    ro.observe(el);
    const onWindowResize = () => reportBounds();
    window.addEventListener('resize', onWindowResize);
    const poll = window.setInterval(() => reportBounds(), POSITION_POLL_MS);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onWindowResize);
      clearInterval(poll);
    };
  }, [reportBounds]);

  // Hide the native webview whenever a modal/dropdown covers it or a tab drag is
  // in progress (HTML cannot paint over — and the native window swallows DOM
  // drag/drop events for — the OS-composited webview), and re-show + realign
  // afterwards.
  useEffect(() => {
    webviewHiddenRef.current = webviewHidden;
    if (!created) return;
    tauriService.webBrowserSetVisible(paneId, !webviewHidden).catch(() => {});
    if (!webviewHidden) reportBounds(true);
  }, [created, webviewHidden, paneId, reportBounds]);

  // Opening/closing the bookmarks or ⋯ More side panel resizes the webview slot;
  // report the new bounds immediately (synchronously, pre-paint) so the native
  // webview tracks the smaller/larger rect without a frame where it overlaps the panel.
  useLayoutEffect(() => {
    if (!created) return;
    reportBounds(true);
  }, [bookmarkMenuOpen, moreOpen, created, reportBounds]);

  // Track navigation so the address bar (and the tab name, via onUrlChange)
  // reflects redirects / in-page links.
  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;
    tauriService
      .onWebBrowserNavState((p) => {
        if (p.paneId !== paneId) return;
        setLoading(p.loading);
        if (p.url && p.url !== 'about:blank') applyCurrentUrl(p.url);
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [paneId, applyCurrentUrl]);

  // Track back/forward availability (WebView2 HistoryChanged) to enable/disable
  // the nav buttons. A separate event from nav-state so it never touches loading.
  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;
    tauriService
      .onWebBrowserHistoryState((p) => {
        if (p.paneId !== paneId) return;
        setCanGoBack(p.canGoBack);
        setCanGoForward(p.canGoForward);
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [paneId]);

  // Zoom changes (our stepper/keys OR WebView2's built-in Ctrl+± / Ctrl+wheel)
  // are pushed back from the backend; record them so the `%` display and the
  // per-pane store track the real zoom regardless of how it changed.
  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;
    tauriService
      .onWebBrowserZoomState((p) => {
        if (p.paneId !== paneId) return;
        setPaneZoom(paneId, p.zoom);
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [paneId, setPaneZoom]);

  // Accelerator keys pressed while the native webview (the page) had focus are
  // bridged here from WebView2, so shortcuts work over the page too (DOM keydown
  // below covers the case where the HTML chrome has focus).
  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;
    tauriService
      .onWebBrowserAccel((p) => {
        if (p.paneId !== paneId) return;
        switch (p.action) {
          case 'back':
            tauriService.webBrowserBack(paneId).catch(() => {});
            break;
          case 'forward':
            tauriService.webBrowserForward(paneId).catch(() => {});
            break;
          case 'reload':
            tauriService.webBrowserReload(paneId).catch(() => {});
            break;
          case 'focus-address':
            focusAddress();
            break;
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [paneId, focusAddress]);

  // Move pane focus here when the user clicks into the page: those clicks land
  // in the native webview and never reach the DOM, so the grid's click-to-focus
  // handler cannot see them. The backend bridges WebView2's GotFocus instead.
  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;
    tauriService
      .onWebBrowserFocus((p) => {
        if (p.paneId !== paneId) return;
        onPageFocusRef.current?.();
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [paneId]);

  // Open the bookmark modal when the tab-bar "Add Bookmark…" menu requests it for
  // this pane. Drive the open from the store subscription (an external system) so we
  // never call setState synchronously in the effect body; also handle a request that
  // was already pending when this pane mounts (its tab was hidden at request time).
  useEffect(() => {
    const tryConsume = (pendingPaneId: string | null) => {
      if (pendingPaneId !== paneId) return;
      setBookmarkOpen(true);
      consumeBookmark(paneId);
    };
    tryConsume(useWebBrowserBookmarkStore.getState().pendingPaneId);
    return useWebBrowserBookmarkStore.subscribe((s) => tryConsume(s.pendingPaneId));
  }, [paneId, consumeBookmark]);

  const handleNavigate = useCallback(
    (raw: string) => {
      // Host-like input navigates; free text / a bare word becomes a Google
      // search instead of a failed navigation.
      const url = resolveAddress(raw);
      if (!url) return;
      if (!/^(https?:\/\/|about:)/i.test(url)) {
        setError(t('panes.webBrowser.invalidUrl'));
        return;
      }
      setError(null);
      tauriService.webBrowserNavigate(paneId, url).catch((e) => {
        setError(t('panes.webBrowser.invalidUrl'));
        logError('web-browser', i18n.t('notifications.errors.browserNavigate'), e);
      });
    },
    [paneId, t],
  );

  // Navigate to a saved bookmark, then close the dropdown.
  const handleOpenBookmark = useCallback(
    (url: string) => {
      setBookmarkMenuOpen(false);
      handleNavigate(url);
    },
    [handleNavigate],
  );

  // "Open All" on a folder: each bookmark opens in its own new browser pane
  // (a pane hosts a single webview, so we fan out rather than retarget this one).
  const handleOpenAllBookmarks = useCallback(
    (folder: BookmarkNode) => {
      setBookmarkMenuOpen(false);
      for (const b of flattenBookmarks(folder.children ?? [])) {
        if (b.url) onOpenInNewPane?.(b.url);
      }
    },
    [onOpenInNewPane],
  );

  // ★ button: toggle the current page's bookmark. Already saved → remove it;
  // otherwise open the Add Bookmark modal.
  const handleToggleBookmark = useCallback(() => {
    if (!currentUrl || currentUrl === INITIAL_URL) return;
    const existing = findBookmarkByUrl(bookmarkTree, currentUrl);
    if (existing) deleteBookmark(existing.id);
    else setBookmarkOpen(true);
  }, [currentUrl, bookmarkTree, deleteBookmark]);

  // Keyboard shortcuts handled while the HTML chrome (toolbar/address bar) has
  // focus. When the native webview itself has focus these never fire — that case
  // is covered by the WebView2 accelerator bridge (onWebBrowserAccel above).
  const handlePaneKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        focusAddress();
      } else if (e.key === 'F5' || (e.ctrlKey && (e.key === 'r' || e.key === 'R'))) {
        e.preventDefault();
        tauriService.webBrowserReload(paneId).catch(() => {});
      } else if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        tauriService.webBrowserBack(paneId).catch(() => {});
      } else if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        tauriService.webBrowserForward(paneId).catch(() => {});
      } else if (e.ctrlKey && !e.altKey && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        applyZoom(nextZoom(zoom));
      } else if (e.ctrlKey && !e.altKey && e.key === '-') {
        e.preventDefault();
        applyZoom(prevZoom(zoom));
      } else if (e.ctrlKey && !e.altKey && e.key === '0') {
        e.preventDefault();
        applyZoom(defaultZoom);
      }
    },
    [paneId, focusAddress, applyZoom, zoom, defaultZoom],
  );

  // Close the bookmarks dropdown on Escape or a click outside its wrapper.
  useEffect(() => {
    if (!bookmarkMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      // Keep open when clicking the toggle button (toolbar) or the panel (body);
      // the panel is rendered outside the toolbar wrap, so check both.
      const target = e.target as Node;
      if (bookmarkWrapRef.current?.contains(target)) return;
      if (bookmarkPanelRef.current?.contains(target)) return;
      setBookmarkMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBookmarkMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [bookmarkMenuOpen]);

  // Close the ⋯ More panel on Escape or a click outside it (same pattern as the
  // bookmarks panel above).
  useEffect(() => {
    if (!moreOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      // Keep open when clicking the ⋯ toggle (its click handler performs the
      // toggle; closing here first would immediately reopen) or the panel itself
      // (zoom stepping must not dismiss the menu).
      const target = e.target as Node;
      if (moreToggleRef.current?.contains(target)) return;
      if (morePanelRef.current?.contains(target)) return;
      setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  return (
    <div className="web-browser-pane" onKeyDown={handlePaneKeyDown}>
      <div className="web-browser-toolbar">
        <button
          type="button"
          className="web-browser-toolbar-btn web-browser-nav-btn"
          disabled={!canGoBack}
          onClick={() => tauriService.webBrowserBack(paneId).catch(() => {})}
          title={t('panes.webBrowser.back')}
          aria-label={t('panes.webBrowser.back')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </button>
        <button
          type="button"
          className="web-browser-toolbar-btn web-browser-nav-btn"
          disabled={!canGoForward}
          onClick={() => tauriService.webBrowserForward(paneId).catch(() => {})}
          title={t('panes.webBrowser.forward')}
          aria-label={t('panes.webBrowser.forward')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </button>
        {loading ? (
          <button
            type="button"
            className="web-browser-toolbar-btn web-browser-nav-btn"
            onClick={() => tauriService.webBrowserStop(paneId).catch(() => {})}
            title={t('panes.webBrowser.stop')}
            aria-label={t('panes.webBrowser.stop')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            className="web-browser-toolbar-btn web-browser-nav-btn"
            onClick={() => tauriService.webBrowserReload(paneId).catch(() => {})}
            title={t('panes.webBrowser.reload')}
            aria-label={t('panes.webBrowser.reload')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        )}
        <input
          ref={addressInputRef}
          className="web-browser-address"
          type="text"
          value={addressInput}
          spellCheck={false}
          autoComplete="off"
          placeholder={t('panes.webBrowser.addressPlaceholder')}
          aria-label={t('panes.webBrowser.addressPlaceholder')}
          onChange={(e) => setAddressInput(e.target.value)}
          onFocus={() => {
            addressFocusedRef.current = true;
          }}
          onBlur={() => {
            addressFocusedRef.current = false;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleNavigate(addressInput);
          }}
        />
        <button
          type="button"
          className={`web-browser-toolbar-btn web-browser-star${isBookmarked ? ' bookmarked' : ''}`}
          disabled={!currentUrl || currentUrl === 'about:blank'}
          onClick={handleToggleBookmark}
          title={t(isBookmarked ? 'panes.webBrowser.bookmarkRemoveTooltip' : 'panes.webBrowser.bookmarkAddTooltip')}
          aria-label={t(isBookmarked ? 'panes.webBrowser.bookmarkRemoveTooltip' : 'panes.webBrowser.bookmarkAddTooltip')}
          aria-pressed={isBookmarked}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill={isBookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </button>
        <div className="web-browser-bookmark-wrap" ref={bookmarkWrapRef}>
          <button
            type="button"
            className={`web-browser-toolbar-btn${bookmarkMenuOpen ? ' active' : ''}`}
            onClick={() => setBookmarkMenuOpen((o) => !o)}
            title={t('panes.webBrowser.bookmarksTooltip')}
            aria-label={t('panes.webBrowser.bookmarksTooltip')}
            aria-haspopup="true"
            aria-expanded={bookmarkMenuOpen}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
          </button>
        </div>
        <button
          type="button"
          ref={moreToggleRef}
          className={`web-browser-toolbar-btn web-browser-more-toggle${moreOpen ? ' active' : ''}`}
          onClick={() => setMoreOpen((o) => !o)}
          title={t('panes.webBrowser.more')}
          aria-label={t('panes.webBrowser.more')}
          aria-haspopup="true"
          aria-expanded={moreOpen}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <circle cx="5" cy="12" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="19" cy="12" r="1.6" />
          </svg>
        </button>
      </div>
      {error && <div className="web-browser-error">{error}</div>}
      {/* Body row: the native webview floats over .web-browser-body. When the
          bookmarks menu or the ⋯ More menu is open, a panel docks to the right
          and the webview slot shrinks beside it — HTML cannot paint over the
          native webview, so menus sit next to the page rather than above it
          (keeping it visible). Panel order matches toolbar button order, so the
          More panel (rightmost button) is the rightmost column. */}
      <div className="web-browser-body-row">
        <div ref={bodyRef} className="web-browser-body" />
        {bookmarkMenuOpen && (
          <div className="web-browser-bookmark-panel" ref={bookmarkPanelRef}>
            <BookmarkMenu tree={bookmarkTree} onSelect={handleOpenBookmark} onOpenAll={handleOpenAllBookmarks} />
          </div>
        )}
        {/* "⋯ More" panel: extra actions that would crowd the primary bar,
            stacked vertically below the ⋯ button. */}
        {moreOpen && (
          <div
            className="web-browser-more-panel"
            ref={morePanelRef}
            role="group"
            aria-label={t('panes.webBrowser.more')}
          >
            {/* Each feature group gets its own section card (settings-card style)
                so its boundary is obvious at a glance. */}
            <div
              className="web-browser-more-section"
              role="group"
              aria-label={t('panes.webBrowser.zoomLevel')}
            >
              <span className="web-browser-more-section-title">{t('panes.webBrowser.zoom')}</span>
              <div className="web-browser-zoom-stepper">
                <button
                  type="button"
                  className="web-browser-toolbar-btn"
                  disabled={!canZoomOut(zoom)}
                  onClick={() => applyZoom(prevZoom(zoom))}
                  title={t('panes.webBrowser.zoomOut')}
                  aria-label={t('panes.webBrowser.zoomOut')}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="web-browser-zoom-value"
                  onClick={() => applyZoom(defaultZoom)}
                  title={t('panes.webBrowser.zoomReset')}
                  aria-label={t('panes.webBrowser.zoomReset')}
                >
                  {zoom}%
                </button>
                <button
                  type="button"
                  className="web-browser-toolbar-btn"
                  disabled={!canZoomIn(zoom)}
                  onClick={() => applyZoom(nextZoom(zoom))}
                  title={t('panes.webBrowser.zoomIn')}
                  aria-label={t('panes.webBrowser.zoomIn')}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
              </div>
              {/* Make the current zoom the persisted default for new panes. Disabled
                  (and thus visually "saved") once the current zoom already is the
                  default. */}
              <button
                type="button"
                className="web-browser-zoom-preset"
                disabled={zoom === defaultZoom}
                onClick={() => updateSetting('webBrowserDefaultZoom', zoom)}
                title={t('panes.webBrowser.zoomSetDefaultTooltip')}
                aria-label={t('panes.webBrowser.zoomSetDefault')}
              >
                {t('panes.webBrowser.zoomSetDefault')}
              </button>
            </div>
            {/* Clearing closes the panel — the panel disappearing doubles as
                done-feedback (like the old modal closing on confirm). */}
            <ClearBrowsingDataSection
              onClear={(options: WebBrowserClearDataOptions) => {
                setMoreOpen(false);
                tauriService
                  .webBrowserClearBrowsingData(paneId, options)
                  .catch((e) => logError('web-browser', i18n.t('notifications.errors.browserClearData'), e));
              }}
            />
          </div>
        )}
      </div>
      {bookmarkOpen && currentUrl && (
        <AddBookmarkModal url={currentUrl} onClose={() => setBookmarkOpen(false)} />
      )}
    </div>
  );
}
