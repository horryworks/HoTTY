import { describe, it, expect, beforeEach } from 'vitest';
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
});
