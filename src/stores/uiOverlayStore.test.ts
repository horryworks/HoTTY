import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useUiOverlayStore, initOverlayWatcher } from './uiOverlayStore';

// MutationObserver callbacks run on a microtask; a macrotask tick guarantees
// they have flushed before we assert.
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  document.body.innerHTML = '';
  useUiOverlayStore.setState({ overlayOpen: false });
});

describe('uiOverlayStore', () => {
  it('setOverlayOpen updates the flag', () => {
    useUiOverlayStore.getState().setOverlayOpen(true);
    expect(useUiOverlayStore.getState().overlayOpen).toBe(true);
    useUiOverlayStore.getState().setOverlayOpen(false);
    expect(useUiOverlayStore.getState().overlayOpen).toBe(false);
  });

  it('detects a modal overlay being added, then removed', async () => {
    initOverlayWatcher();

    const overlay = document.createElement('div');
    overlay.className = 'settings-modal-overlay';
    document.body.appendChild(overlay);
    await tick();
    expect(useUiOverlayStore.getState().overlayOpen).toBe(true);

    overlay.remove();
    await tick();
    expect(useUiOverlayStore.getState().overlayOpen).toBe(false);
  });

  it('detects the ★ add-bookmark modal overlay', async () => {
    initOverlayWatcher();
    const overlay = document.createElement('div');
    overlay.className = 'add-bookmark-modal-overlay';
    document.body.appendChild(overlay);
    await tick();
    expect(useUiOverlayStore.getState().overlayOpen).toBe(true);
  });

  it('ignores non-overlay DOM changes', async () => {
    initOverlayWatcher();
    document.body.appendChild(document.createElement('div'));
    await tick();
    expect(useUiOverlayStore.getState().overlayOpen).toBe(false);
  });

  it('closes when an overlay leaves the DOM inside a removed ancestor', async () => {
    initOverlayWatcher();
    const host = document.createElement('div');
    document.body.appendChild(host);
    await tick();

    const overlay = document.createElement('div');
    overlay.className = 'confirm-modal-overlay';
    host.appendChild(overlay);
    await tick();
    expect(useUiOverlayStore.getState().overlayOpen).toBe(true);

    // The wrapper goes in one mutation, so the overlay itself is never a direct
    // `removedNode` — only the scoped subtree check can catch it.
    host.remove();
    await tick();
    expect(useUiOverlayStore.getState().overlayOpen).toBe(false);
  });

  // Bulk terminal output removes xterm rows continuously. Re-scanning the whole
  // document for every one of those removals made `querySelector` the second
  // most expensive function in a bulk-output profile (13.2% self time).
  it('does not re-scan the document when unrelated nodes are removed', async () => {
    initOverlayWatcher();
    const row = document.createElement('div');
    row.appendChild(document.createElement('span'));
    document.body.appendChild(row);
    // Drain the mutations queued above (and by the beforeEach reset) so the spy
    // below only ever sees work caused by the removal under test.
    await tick();

    const spy = vi.spyOn(document, 'querySelector');
    row.remove();
    await tick();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
