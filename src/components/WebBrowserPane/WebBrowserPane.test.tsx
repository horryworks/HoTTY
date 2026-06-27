import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { WebBrowserPane } from './WebBrowserPane';
import { normalizeUrl } from './webBrowserUrl';
import { tauriService } from '../../services/tauriService';
import { useUiOverlayStore } from '../../stores/uiOverlayStore';
import { useBookmarkStore } from '../../stores/bookmarkStore';
import type { WebBrowserNavState } from '../../types/appTypes';

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
  },
}));

vi.mock('../../utils/logger', () => ({ logError: vi.fn() }));

// jsdom lacks ResizeObserver — provide a no-op so the component mounts.
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(tauriService.onWebBrowserNavState).mockResolvedValue(() => {});
  vi.mocked(tauriService.webBrowserCurrentUrl).mockResolvedValue(null);
  useUiOverlayStore.setState({ overlayOpen: false });
  useBookmarkStore.setState({ tree: [] });
  // @ts-expect-error test shim
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

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
});
