import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the cross-window sync helper so we can assert how it's wired without
// pulling in the real Tauri event plumbing.
const { syncStoreAcrossWindows } = vi.hoisted(() => ({
  syncStoreAcrossWindows: vi.fn(),
}));
vi.mock('../utils/crossWindowSync', () => ({ syncStoreAcrossWindows }));

// Mock the stores as opaque sentinels — sharedStoreSync only forwards them to
// syncStoreAcrossWindows, so we just need stable references to assert against
// (and this avoids importing the real stores / their tauri deps).
vi.mock('./settingsStore', () => ({ useSettingsStore: { __store: 'settings' } }));
vi.mock('./bookmarkStore', () => ({ useBookmarkStore: { __store: 'bookmarks' } }));

import { initSharedStoreSync } from './sharedStoreSync';
import { useSettingsStore } from './settingsStore';
import { useBookmarkStore } from './bookmarkStore';

describe('initSharedStoreSync', () => {
  beforeEach(() => {
    syncStoreAcrossWindows.mockReset();
    syncStoreAcrossWindows.mockReturnValue(() => {});
  });

  it('wires up cross-window sync for the settings and bookmark stores with their storage keys', () => {
    initSharedStoreSync();

    expect(syncStoreAcrossWindows).toHaveBeenCalledTimes(2);
    expect(syncStoreAcrossWindows).toHaveBeenNthCalledWith(1, useSettingsStore, 'hotty-settings');
    expect(syncStoreAcrossWindows).toHaveBeenNthCalledWith(2, useBookmarkStore, 'hotty-bookmarks');
  });

  it('returns a disposer that tears down both store subscriptions exactly once', () => {
    const disposeSettings = vi.fn();
    const disposeBookmarks = vi.fn();
    syncStoreAcrossWindows
      .mockReturnValueOnce(disposeSettings)
      .mockReturnValueOnce(disposeBookmarks);

    const dispose = initSharedStoreSync();

    // Disposers must not fire until the caller cleans up.
    expect(disposeSettings).not.toHaveBeenCalled();
    expect(disposeBookmarks).not.toHaveBeenCalled();

    dispose();

    expect(disposeSettings).toHaveBeenCalledTimes(1);
    expect(disposeBookmarks).toHaveBeenCalledTimes(1);
  });
});
