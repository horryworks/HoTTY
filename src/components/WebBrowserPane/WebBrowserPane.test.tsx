import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { WebBrowserPane } from './WebBrowserPane';
import { normalizeUrl, resolveAddress } from './webBrowserUrl';
import { tauriService } from '../../services/tauriService';
import { useUiOverlayStore } from '../../stores/uiOverlayStore';
import { useBookmarkStore } from '../../stores/bookmarkStore';
import { useWebBrowserBookmarkStore } from '../../stores/webBrowserBookmarkStore';
import type {
  WebBrowserNavState,
  WebBrowserHistoryState,
  WebBrowserAccel,
} from '../../types/appTypes';

vi.mock('../../services/tauriService', () => ({
  tauriService: {
    webBrowserCreate: vi.fn().mockResolvedValue(undefined),
    webBrowserNavigate: vi.fn().mockResolvedValue(undefined),
    webBrowserCurrentUrl: vi.fn().mockResolvedValue(null),
    webBrowserBack: vi.fn().mockResolvedValue(undefined),
    webBrowserForward: vi.fn().mockResolvedValue(undefined),
    webBrowserReload: vi.fn().mockResolvedValue(undefined),
    webBrowserStop: vi.fn().mockResolvedValue(undefined),
    webBrowserSetBounds: vi.fn().mockResolvedValue(undefined),
    webBrowserSetVisible: vi.fn().mockResolvedValue(undefined),
    webBrowserDestroy: vi.fn().mockResolvedValue(undefined),
    onWebBrowserNavState: vi.fn().mockResolvedValue(() => {}),
    onWebBrowserHistoryState: vi.fn().mockResolvedValue(() => {}),
    onWebBrowserAccel: vi.fn().mockResolvedValue(() => {}),
  },
}));

vi.mock('../../utils/logger', () => ({ logError: vi.fn() }));

// jsdom lacks ResizeObserver — provide a no-op so the component mounts.
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(tauriService.onWebBrowserNavState).mockResolvedValue(() => {});
  vi.mocked(tauriService.onWebBrowserHistoryState).mockResolvedValue(() => {});
  vi.mocked(tauriService.onWebBrowserAccel).mockResolvedValue(() => {});
  vi.mocked(tauriService.webBrowserCurrentUrl).mockResolvedValue(null);
  useUiOverlayStore.setState({ overlayOpen: false, sessionDragging: false });
  useBookmarkStore.setState({ tree: [] });
  useWebBrowserBookmarkStore.setState({ pendingPaneId: null, nonce: 0 });
  // @ts-expect-error test shim
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

/** Grab the latest registered callback of a mocked tauriService listener. */
function latestCb<T>(fn: { mock: { calls: unknown[][] } }): (p: T) => void {
  const calls = fn.mock.calls;
  return calls[calls.length - 1][0] as (p: T) => void;
}

describe('normalizeUrl', () => {
  it('defaults schemeless input to http:// (LAN device friendly)', () => {
    expect(normalizeUrl('192.168.1.1')).toBe('http://192.168.1.1');
    expect(normalizeUrl('example.com/path')).toBe('http://example.com/path');
  });

  it('keeps an explicit scheme', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com');
    expect(normalizeUrl('http://10.0.0.1')).toBe('http://10.0.0.1');
    expect(normalizeUrl('about:blank')).toBe('about:blank');
  });

  it('trims and returns empty for blank input', () => {
    expect(normalizeUrl('   ')).toBe('');
    expect(normalizeUrl('  https://a.test  ')).toBe('https://a.test');
  });

  it('does not wrap a schemeful (non host:port) input in http://', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBe('javascript:alert(1)');
    expect(normalizeUrl('file:///C:/x')).toBe('file:///C:/x');
  });

  it('treats host:port as schemeless (port digits are not a scheme)', () => {
    expect(normalizeUrl('192.168.1.1:8080')).toBe('http://192.168.1.1:8080');
    expect(normalizeUrl('router.local:443')).toBe('http://router.local:443');
  });
});

describe('resolveAddress', () => {
  it('navigates host-like input (domain, IP, host:port, localhost)', () => {
    expect(resolveAddress('192.168.1.1')).toBe('http://192.168.1.1');
    expect(resolveAddress('example.com/path')).toBe('http://example.com/path');
    expect(resolveAddress('192.168.1.1:8080')).toBe('http://192.168.1.1:8080');
    expect(resolveAddress('localhost')).toBe('http://localhost');
    expect(resolveAddress('localhost:3000')).toBe('http://localhost:3000');
  });

  it('keeps an explicit scheme verbatim', () => {
    expect(resolveAddress('https://example.com')).toBe('https://example.com');
    expect(resolveAddress('about:blank')).toBe('about:blank');
    expect(resolveAddress('javascript:alert(1)')).toBe('javascript:alert(1)');
  });

  it('sends free text / a bare word to Google search', () => {
    expect(resolveAddress('weather tokyo')).toBe(
      'https://www.google.com/search?q=weather%20tokyo',
    );
    expect(resolveAddress('router')).toBe('https://www.google.com/search?q=router');
    expect(resolveAddress('how to configure vlan')).toBe(
      'https://www.google.com/search?q=how%20to%20configure%20vlan',
    );
  });

  it('encodes search query special characters', () => {
    expect(resolveAddress('c# & rust')).toBe('https://www.google.com/search?q=c%23%20%26%20rust');
  });

  it('returns empty for blank input', () => {
    expect(resolveAddress('   ')).toBe('');
  });
});

describe('WebBrowserPane', () => {
  it('renders the address bar and toolbar controls', () => {
    render(<WebBrowserPane paneId="wb-1" active={true} />);
    expect(screen.getByPlaceholderText(/192\.168\.1\.1/)).toBeTruthy();
    expect(screen.getByText('Go')).toBeTruthy();
    expect(screen.getByLabelText('Back')).toBeTruthy();
    expect(screen.getByLabelText('Forward')).toBeTruthy();
  });

  it('creates the embedded webview on mount', async () => {
    render(<WebBrowserPane paneId="wb-1" active={true} />);
    await waitFor(() =>
      expect(tauriService.webBrowserCreate).toHaveBeenCalledWith(
        'wb-1',
        'about:blank',
        expect.any(Object),
      ),
    );
  });

  it('navigates on Enter, normalizing a schemeless address', async () => {
    render(<WebBrowserPane paneId="wb-1" active={true} />);
    const input = screen.getByPlaceholderText(/192\.168\.1\.1/);
    fireEvent.change(input, { target: { value: '192.168.1.1' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(tauriService.webBrowserNavigate).toHaveBeenCalledWith('wb-1', 'http://192.168.1.1');
  });

  it('routes a non-URL search query to Google on Enter', () => {
    render(<WebBrowserPane paneId="wb-1" active={true} />);
    const input = screen.getByPlaceholderText(/192\.168\.1\.1/);
    fireEvent.change(input, { target: { value: 'weather tokyo' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(tauriService.webBrowserNavigate).toHaveBeenCalledWith(
      'wb-1',
      'https://www.google.com/search?q=weather%20tokyo',
    );
  });

  it('rejects a disallowed scheme without navigating', () => {
    render(<WebBrowserPane paneId="wb-1" active={true} />);
    const input = screen.getByPlaceholderText(/192\.168\.1\.1/);
    fireEvent.change(input, { target: { value: 'javascript:alert(1)' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(tauriService.webBrowserNavigate).not.toHaveBeenCalled();
    expect(screen.getByText(/Only http/)).toBeTruthy();
  });

  it('updates the address bar from a nav-state event', async () => {
    render(<WebBrowserPane paneId="wb-1" active={true} />);
    await waitFor(() => expect(tauriService.onWebBrowserNavState).toHaveBeenCalled());
    const cb = vi.mocked(tauriService.onWebBrowserNavState).mock.calls[0][0] as (
      p: WebBrowserNavState,
    ) => void;
    act(() => cb({ paneId: 'wb-1', url: 'http://10.0.0.1/login', loading: false }));
    const input = screen.getByPlaceholderText(/192\.168\.1\.1/) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('http://10.0.0.1/login'));
  });

  it('ignores nav-state events for other panes', async () => {
    render(<WebBrowserPane paneId="wb-1" active={true} />);
    await waitFor(() => expect(tauriService.onWebBrowserNavState).toHaveBeenCalled());
    const cb = vi.mocked(tauriService.onWebBrowserNavState).mock.calls[0][0] as (
      p: WebBrowserNavState,
    ) => void;
    act(() => cb({ paneId: 'wb-OTHER', url: 'http://evil.test', loading: false }));
    const input = screen.getByPlaceholderText(/192\.168\.1\.1/) as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('restores the address bar from the backend after a (re)mount', async () => {
    // Simulate a pane move: the webview already exists with a loaded page, so
    // the backend reports its current URL on mount.
    vi.mocked(tauriService.webBrowserCurrentUrl).mockResolvedValue('http://10.0.0.1/status');
    render(<WebBrowserPane paneId="wb-1" active={true} />);
    await waitFor(() => expect(tauriService.webBrowserCurrentUrl).toHaveBeenCalledWith('wb-1'));
    const input = screen.getByPlaceholderText(/192\.168\.1\.1/) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('http://10.0.0.1/status'));
  });

  it('leaves the address bar empty for a blank (fresh) webview', async () => {
    vi.mocked(tauriService.webBrowserCurrentUrl).mockResolvedValue('about:blank');
    render(<WebBrowserPane paneId="wb-1" active={true} />);
    await waitFor(() => expect(tauriService.webBrowserCurrentUrl).toHaveBeenCalled());
    const input = screen.getByPlaceholderText(/192\.168\.1\.1/) as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('hides the webview while a modal overlay is open', async () => {
    render(<WebBrowserPane paneId="wb-1" active={true} />);
    await waitFor(() => expect(tauriService.webBrowserSetVisible).toHaveBeenCalledWith('wb-1', true));
    act(() => useUiOverlayStore.setState({ overlayOpen: true }));
    await waitFor(() =>
      expect(tauriService.webBrowserSetVisible).toHaveBeenCalledWith('wb-1', false),
    );
  });

  it('hides the webview while a tab is being dragged, re-shows on drag end', async () => {
    render(<WebBrowserPane paneId="wb-1" active={true} />);
    await waitFor(() => expect(tauriService.webBrowserSetVisible).toHaveBeenCalledWith('wb-1', true));
    // A drag begins → the native webview must hide so the grid drop target is live.
    act(() => useUiOverlayStore.setState({ sessionDragging: true }));
    await waitFor(() =>
      expect(tauriService.webBrowserSetVisible).toHaveBeenCalledWith('wb-1', false),
    );
    // Drag ends → webview comes back.
    vi.mocked(tauriService.webBrowserSetVisible).mockClear();
    act(() => useUiOverlayStore.setState({ sessionDragging: false }));
    await waitFor(() =>
      expect(tauriService.webBrowserSetVisible).toHaveBeenCalledWith('wb-1', true),
    );
  });

  it('hides the webview on unmount (kept alive for remount)', async () => {
    const { unmount } = render(<WebBrowserPane paneId="wb-1" active={true} />);
    await waitFor(() => expect(tauriService.webBrowserCreate).toHaveBeenCalled());
    unmount();
    expect(tauriService.webBrowserSetVisible).toHaveBeenCalledWith('wb-1', false);
  });

  it('creates the webview with a normalized initialUrl and seeds the address bar', async () => {
    render(<WebBrowserPane paneId="wb-1" active={true} initialUrl="example.com" />);
    await waitFor(() =>
      expect(tauriService.webBrowserCreate).toHaveBeenCalledWith(
        'wb-1',
        'http://example.com',
        expect.any(Object),
      ),
    );
    const input = screen.getByPlaceholderText(/192\.168\.1\.1/) as HTMLInputElement;
    expect(input.value).toBe('http://example.com');
  });

  it('disables ★ for a blank page', () => {
    render(<WebBrowserPane paneId="wb-1" active={true} />);
    expect(screen.getByLabelText('Bookmark this page')).toHaveProperty('disabled', true);
  });

  it('★ opens the add-bookmark modal and saves to the bookmark store', () => {
    render(<WebBrowserPane paneId="wb-1" active={true} initialUrl="http://router.test/admin" />);
    const star = screen.getByLabelText('Bookmark this page');
    expect(star).toHaveProperty('disabled', false);
    fireEvent.click(star);
    expect(screen.getByText('Add Bookmark')).toBeTruthy();
    fireEvent.click(screen.getByText('Add'));
    expect(
      useBookmarkStore.getState().tree.some((n) => n.url === 'http://router.test/admin'),
    ).toBe(true);
  });

  it('★ saves into a folder picked from the folder tree', () => {
    // Seed a folder so the picker has a non-root destination to choose.
    useBookmarkStore.setState({
      tree: [{ id: 'f-net', type: 'folder', name: 'Network', children: [] }],
    });
    render(<WebBrowserPane paneId="wb-1" active={true} initialUrl="http://router.test/admin" />);
    fireEvent.click(screen.getByLabelText('Bookmark this page'));
    // Choose the "Network" folder from the tree, then save.
    fireEvent.click(screen.getByText('Network'));
    fireEvent.click(screen.getByText('Add'));
    const folder = useBookmarkStore.getState().tree.find((n) => n.id === 'f-net');
    expect(folder?.children?.some((c) => c.url === 'http://router.test/admin')).toBe(true);
    // And it must NOT have been dropped at the root.
    expect(
      useBookmarkStore.getState().tree.some((n) => n.url === 'http://router.test/admin'),
    ).toBe(false);
  });

  it('opens the bookmark modal when a tab-bar bookmark request targets this pane', () => {
    render(<WebBrowserPane paneId="wb-1" active={true} initialUrl="http://router.test/admin" />);
    expect(screen.queryByText('Add Bookmark')).toBeNull();
    act(() => useWebBrowserBookmarkStore.getState().requestBookmark('wb-1'));
    expect(screen.getByText('Add Bookmark')).toBeTruthy();
    // The request is consumed so it cannot re-fire on the next render.
    expect(useWebBrowserBookmarkStore.getState().pendingPaneId).toBeNull();
  });

  it('ignores a bookmark request targeting a different pane', () => {
    render(<WebBrowserPane paneId="wb-1" active={true} initialUrl="http://router.test/admin" />);
    act(() => useWebBrowserBookmarkStore.getState().requestBookmark('wb-OTHER'));
    expect(screen.queryByText('Add Bookmark')).toBeNull();
    // The pending request remains for the other pane to consume when it mounts.
    expect(useWebBrowserBookmarkStore.getState().pendingPaneId).toBe('wb-OTHER');
  });

  it('toggles the bookmarks dropdown, listing saved bookmarks', () => {
    useBookmarkStore.setState({
      tree: [{ id: 'b1', type: 'bookmark', name: 'Router GUI', url: 'http://192.168.1.1/' }],
    });
    render(<WebBrowserPane paneId="wb-1" active={true} />);
    expect(screen.queryByText('Router GUI')).toBeNull();
    fireEvent.click(screen.getByLabelText('Show bookmarks'));
    expect(screen.getByText('Router GUI')).toBeTruthy();
    // Clicking the button again closes it.
    fireEvent.click(screen.getByLabelText('Show bookmarks'));
    expect(screen.queryByText('Router GUI')).toBeNull();
  });

  it('navigates to a bookmark picked from the dropdown and closes it', () => {
    useBookmarkStore.setState({
      tree: [{ id: 'b1', type: 'bookmark', name: 'Router GUI', url: 'http://192.168.1.1/' }],
    });
    render(<WebBrowserPane paneId="wb-1" active={true} />);
    fireEvent.click(screen.getByLabelText('Show bookmarks'));
    fireEvent.click(screen.getByText('Router GUI'));
    expect(tauriService.webBrowserNavigate).toHaveBeenCalledWith('wb-1', 'http://192.168.1.1/');
    // The dropdown closes after selection.
    expect(screen.queryByText('Router GUI')).toBeNull();
  });

  it('shows the empty state in the dropdown when no bookmarks are saved', () => {
    render(<WebBrowserPane paneId="wb-1" active={true} />);
    fireEvent.click(screen.getByLabelText('Show bookmarks'));
    expect(screen.getByText('No bookmarks yet')).toBeTruthy();
  });

  it('keeps the webview visible (does not hide it) while the bookmarks panel is open', async () => {
    useBookmarkStore.setState({
      tree: [{ id: 'b1', type: 'bookmark', name: 'Router GUI', url: 'http://192.168.1.1/' }],
    });
    render(<WebBrowserPane paneId="wb-1" active={true} />);
    await waitFor(() =>
      expect(tauriService.webBrowserSetVisible).toHaveBeenCalledWith('wb-1', true),
    );
    vi.mocked(tauriService.webBrowserSetVisible).mockClear();
    vi.mocked(tauriService.webBrowserSetBounds).mockClear();

    fireEvent.click(screen.getByLabelText('Show bookmarks'));
    expect(screen.getByText('Router GUI')).toBeTruthy();
    // The panel docks beside the page — the webview must NOT be hidden …
    expect(tauriService.webBrowserSetVisible).not.toHaveBeenCalledWith('wb-1', false);
    // … and its slot shrinks, so new bounds are reported.
    expect(tauriService.webBrowserSetBounds).toHaveBeenCalledWith('wb-1', expect.any(Object));
  });

  it('closes the bookmarks dropdown on an outside click', () => {
    useBookmarkStore.setState({
      tree: [{ id: 'b1', type: 'bookmark', name: 'Router GUI', url: 'http://192.168.1.1/' }],
    });
    render(<WebBrowserPane paneId="wb-1" active={true} />);
    fireEvent.click(screen.getByLabelText('Show bookmarks'));
    expect(screen.getByText('Router GUI')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('Router GUI')).toBeNull();
  });

  it('reports the current URL to onUrlChange so the tab name can follow', async () => {
    const onUrlChange = vi.fn();
    render(<WebBrowserPane paneId="wb-1" active={true} onUrlChange={onUrlChange} />);
    await waitFor(() => expect(tauriService.onWebBrowserNavState).toHaveBeenCalled());
    const cb = latestCb<WebBrowserNavState>(vi.mocked(tauriService.onWebBrowserNavState));
    act(() => cb({ paneId: 'wb-1', url: 'http://10.0.0.1/dashboard', loading: false }));
    expect(onUrlChange).toHaveBeenCalledWith('http://10.0.0.1/dashboard');
  });

  it('enables/disables back & forward from a history-state event', async () => {
    render(<WebBrowserPane paneId="wb-1" active={true} />);
    await waitFor(() => expect(tauriService.onWebBrowserHistoryState).toHaveBeenCalled());
    // Both disabled until the backend reports availability.
    expect(screen.getByLabelText('Back')).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('Forward')).toHaveProperty('disabled', true);
    const cb = latestCb<WebBrowserHistoryState>(
      vi.mocked(tauriService.onWebBrowserHistoryState),
    );
    act(() => cb({ paneId: 'wb-1', canGoBack: true, canGoForward: false }));
    expect(screen.getByLabelText('Back')).toHaveProperty('disabled', false);
    expect(screen.getByLabelText('Forward')).toHaveProperty('disabled', true);
  });

  it('runs the matching action when an accelerator event arrives (page-focus shortcuts)', async () => {
    render(<WebBrowserPane paneId="wb-1" active={true} />);
    await waitFor(() => expect(tauriService.onWebBrowserAccel).toHaveBeenCalled());
    const cb = latestCb<WebBrowserAccel>(vi.mocked(tauriService.onWebBrowserAccel));
    act(() => cb({ paneId: 'wb-1', action: 'reload' }));
    expect(tauriService.webBrowserReload).toHaveBeenCalledWith('wb-1');
    act(() => cb({ paneId: 'wb-1', action: 'back' }));
    expect(tauriService.webBrowserBack).toHaveBeenCalledWith('wb-1');
    // A different pane's accelerator is ignored.
    act(() => cb({ paneId: 'wb-OTHER', action: 'forward' }));
    expect(tauriService.webBrowserForward).not.toHaveBeenCalled();
  });

  it('handles keyboard shortcuts pressed while the HTML chrome has focus', () => {
    render(<WebBrowserPane paneId="wb-1" active={true} />);
    const pane = document.querySelector('.web-browser-pane') as HTMLElement;
    fireEvent.keyDown(pane, { key: 'F5' });
    expect(tauriService.webBrowserReload).toHaveBeenCalledWith('wb-1');
    fireEvent.keyDown(pane, { key: 'ArrowLeft', altKey: true });
    expect(tauriService.webBrowserBack).toHaveBeenCalledWith('wb-1');
    fireEvent.keyDown(pane, { key: 'ArrowRight', altKey: true });
    expect(tauriService.webBrowserForward).toHaveBeenCalledWith('wb-1');
  });

  it('★ reflects an already-bookmarked page and removes it on click (toggle off)', () => {
    useBookmarkStore.setState({
      tree: [{ id: 'b1', type: 'bookmark', name: 'Router', url: 'http://router.test/admin' }],
    });
    render(<WebBrowserPane paneId="wb-1" active={true} initialUrl="http://router.test/admin" />);
    const star = screen.getByLabelText('Remove bookmark');
    expect(star.className).toContain('bookmarked');
    fireEvent.click(star);
    // Toggling off must NOT open the add modal …
    expect(screen.queryByText('Add Bookmark')).toBeNull();
    // … and the bookmark is removed from the store.
    expect(
      useBookmarkStore.getState().tree.some((n) => n.url === 'http://router.test/admin'),
    ).toBe(false);
  });

  it('does not reposition the webview while it is hidden by an overlay', async () => {
    let rect = makeRect(0, 0, 800, 600);
    const spy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(() => rect);
    try {
      render(<WebBrowserPane paneId="wb-1" active={true} />);
      await waitFor(() =>
        expect(tauriService.webBrowserSetVisible).toHaveBeenCalledWith('wb-1', true),
      );
      // Hide the webview behind a modal overlay.
      act(() => useUiOverlayStore.setState({ overlayOpen: true }));
      await waitFor(() =>
        expect(tauriService.webBrowserSetVisible).toHaveBeenCalledWith('wb-1', false),
      );
      vi.mocked(tauriService.webBrowserSetBounds).mockClear();
      // The pane's layout shifts while hidden …
      rect = makeRect(0, 120, 800, 600);
      fireEvent(window, new Event('resize'));
      // … but no bounds are pushed (else the parked webview would pop back over
      // the modal). Wait past the bounds debounce to be sure nothing fires.
      await new Promise((r) => setTimeout(r, 60));
      expect(tauriService.webBrowserSetBounds).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

/** Build a DOMRect-like object for getBoundingClientRect mocks. */
function makeRect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x,
    y,
    width,
    height,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
    toJSON() {},
  } as DOMRect;
}
