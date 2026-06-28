import { syncStoreAcrossWindows } from '../utils/crossWindowSync';
import { useSettingsStore } from './settingsStore';
import { useBookmarkStore } from './bookmarkStore';

/**
 * Wire up cross-window sync for the shared (non-per-window) Zustand stores.
 *
 * Kept out of the store modules themselves so that importing a store does NOT
 * pull `tauriService` into the module graph (which would defeat module mocks in
 * unit tests and bloat load order). Call once at app startup, gated on
 * `IS_TAURI` — see {@link ../App}.
 *
 * Returns a disposer that tears down both subscriptions; the caller MUST invoke
 * it on cleanup, otherwise React StrictMode's mount→unmount→remount would leak
 * a duplicate subscriber + event listener per store (causing double broadcasts).
 */
export function initSharedStoreSync(): () => void {
  const disposeSettings = syncStoreAcrossWindows(useSettingsStore, 'hotty-settings');
  const disposeBookmarks = syncStoreAcrossWindows(useBookmarkStore, 'hotty-bookmarks');
  return () => {
    disposeSettings();
    disposeBookmarks();
  };
}
