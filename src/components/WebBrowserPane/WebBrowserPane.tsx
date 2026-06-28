import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { tauriService } from '../../services/tauriService';
import { useUiOverlayStore } from '../../stores/uiOverlayStore';
import { useWebBrowserBookmarkStore } from '../../stores/webBrowserBookmarkStore';
import { useBookmarkStore } from '../../stores/bookmarkStore';
import { logError } from '../../utils/logger';
import type { WebBrowserRect } from '../../types/appTypes';
import { normalizeUrl, resolveAddress } from './webBrowserUrl';
import { AddBookmarkModal } from './AddBookmarkModal';
import { BookmarkMenu } from './BookmarkMenu';
import './WebBrowserPane.css';

interface WebBrowserPaneProps {
  paneId: string;
  /** Whether this pane's slot is the active one. Unused for visibility — the
   *  embedded webview stays shown while mounted regardless of active state. */
  active: boolean;
  /** Initial URL to load (e.g. opened from a Web bookmark). Defaults to blank. */
  initialUrl?: string;
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

export function WebBrowserPane({ paneId, initialUrl }: WebBrowserPaneProps) {
  const { t } = useTranslation();
  const overlayOpen = useUiOverlayStore((s) => s.overlayOpen);
  const sessionDragging = useUiOverlayStore((s) => s.sessionDragging);
  // Tab-bar "Add Bookmark…" request bus — open this pane's bookmark modal when the
  // pending request targets our paneId (mirrors the ☆ toolbar button).
  const consumeBookmark = useWebBrowserBookmarkStore((s) => s.consumeBookmark);
  const bookmarkTree = useBookmarkStore((s) => s.tree);
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

  const bodyRef = useRef<HTMLDivElement>(null);
  const bookmarkWrapRef = useRef<HTMLDivElement>(null);
  const lastRectRef = useRef<WebBrowserRect | null>(null);
  const debounceRef = useRef<number | null>(null);
  const addressFocusedRef = useRef(false);

  // Report the body rectangle to the backend so it repositions the webview.
  const reportBounds = useCallback(
    (immediate = false) => {
      const el = bodyRef.current;
      if (!el || !created) return;
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
      tauriService
        .webBrowserCreate(paneId, startUrl, rect)
        .then(async () => {
          if (cancelled) return;
          setCreated(true);
          // Restore the address bar after a pane move: reusing an existing
          // webview fires no page-load event, so pull its current URL.
          try {
            const cur = await tauriService.webBrowserCurrentUrl(paneId);
            if (!cancelled && cur && cur !== 'about:blank') {
              setCurrentUrl(cur);
              if (!addressFocusedRef.current) setAddressInput(cur);
            }
          } catch {
            /* ignore — address bar just stays as-is */
          }
        })
        .catch((e) => {
          if (!cancelled) logError('web-browser', 'failed to create browser pane', e);
        });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (debounceRef.current != null) clearTimeout(debounceRef.current);
      tauriService.webBrowserSetVisible(paneId, false).catch(() => {});
    };
  }, [paneId, startUrl]);

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
    if (!created) return;
    tauriService.webBrowserSetVisible(paneId, !webviewHidden).catch(() => {});
    if (!webviewHidden) reportBounds(true);
  }, [created, webviewHidden, paneId, reportBounds]);

  // Track navigation so the address bar reflects redirects / in-page links.
  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;
    tauriService
      .onWebBrowserNavState((p) => {
        if (p.paneId !== paneId) return;
        setLoading(p.loading);
        if (p.url && p.url !== 'about:blank') {
          setCurrentUrl(p.url);
          if (!addressFocusedRef.current) setAddressInput(p.url);
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
        logError('web-browser', 'navigate failed', e);
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

  // Close the bookmarks dropdown on Escape or a click outside its wrapper.
  useEffect(() => {
    if (!bookmarkMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!bookmarkWrapRef.current?.contains(e.target as Node)) setBookmarkMenuOpen(false);
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

  return (
    <div className="web-browser-pane">
      <div className="web-browser-toolbar">
        <button
          type="button"
          className="web-browser-toolbar-btn"
          onClick={() => tauriService.webBrowserBack(paneId).catch(() => {})}
          title={t('panes.webBrowser.back')}
          aria-label={t('panes.webBrowser.back')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <button
          type="button"
          className="web-browser-toolbar-btn"
          onClick={() => tauriService.webBrowserForward(paneId).catch(() => {})}
          title={t('panes.webBrowser.forward')}
          aria-label={t('panes.webBrowser.forward')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
        {loading ? (
          <button
            type="button"
            className="web-browser-toolbar-btn"
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
            className="web-browser-toolbar-btn"
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
          className="web-browser-toolbar-btn web-browser-go"
          onClick={() => handleNavigate(addressInput)}
          title={t('panes.webBrowser.go')}
        >
          {t('panes.webBrowser.go')}
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
          {bookmarkMenuOpen && <BookmarkMenu tree={bookmarkTree} onSelect={handleOpenBookmark} />}
        </div>
        <button
          type="button"
          className="web-browser-toolbar-btn"
          disabled={!currentUrl || currentUrl === 'about:blank'}
          onClick={() => setBookmarkOpen(true)}
          title={t('panes.webBrowser.bookmarkAddTooltip')}
          aria-label={t('panes.webBrowser.bookmarkAddTooltip')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </button>
      </div>
      {error && <div className="web-browser-error">{error}</div>}
      {/* The native webview floats over this rect; keep it as a measured slot. */}
      <div ref={bodyRef} className="web-browser-body" />
      {bookmarkOpen && currentUrl && (
        <AddBookmarkModal url={currentUrl} onClose={() => setBookmarkOpen(false)} />
      )}
    </div>
  );
}
