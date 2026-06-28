import { describe, it, expect, beforeEach } from 'vitest';
import { useWebBrowserBookmarkStore } from './webBrowserBookmarkStore';

beforeEach(() => {
  useWebBrowserBookmarkStore.setState({ pendingPaneId: null, nonce: 0 });
});

describe('webBrowserBookmarkStore', () => {
  it('starts with no pending request', () => {
    const s = useWebBrowserBookmarkStore.getState();
    expect(s.pendingPaneId).toBeNull();
    expect(s.nonce).toBe(0);
  });

  it('requestBookmark sets the pending pane and bumps the nonce', () => {
    useWebBrowserBookmarkStore.getState().requestBookmark('wb-1');
    const s = useWebBrowserBookmarkStore.getState();
    expect(s.pendingPaneId).toBe('wb-1');
    expect(s.nonce).toBe(1);
  });

  it('bumps the nonce on every request, even for the same pane', () => {
    const { requestBookmark } = useWebBrowserBookmarkStore.getState();
    requestBookmark('wb-1');
    requestBookmark('wb-1');
    const s = useWebBrowserBookmarkStore.getState();
    expect(s.pendingPaneId).toBe('wb-1');
    expect(s.nonce).toBe(2);
  });

  it('consumeBookmark clears the pending request for the matching pane', () => {
    useWebBrowserBookmarkStore.getState().requestBookmark('wb-1');
    useWebBrowserBookmarkStore.getState().consumeBookmark('wb-1');
    expect(useWebBrowserBookmarkStore.getState().pendingPaneId).toBeNull();
  });

  it('consumeBookmark is a no-op for a non-matching pane (request persists)', () => {
    useWebBrowserBookmarkStore.getState().requestBookmark('wb-1');
    useWebBrowserBookmarkStore.getState().consumeBookmark('wb-OTHER');
    // The request survives until the intended pane mounts and consumes it.
    expect(useWebBrowserBookmarkStore.getState().pendingPaneId).toBe('wb-1');
  });

  it('notifies subscribers when a request is made', () => {
    const seen: Array<string | null> = [];
    const unsub = useWebBrowserBookmarkStore.subscribe((s) => seen.push(s.pendingPaneId));
    useWebBrowserBookmarkStore.getState().requestBookmark('wb-2');
    unsub();
    expect(seen).toContain('wb-2');
  });
});
