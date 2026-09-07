import { useEffect, useRef } from 'react';

/**
 * Startup NetBox sync delay. The architecture doc keeps a startup-time budget,
 * and a network round trip does not belong inside it.
 */
export const NETBOX_STARTUP_SYNC_DELAY_MS = 1500;

export interface NetboxStartupSyncOptions {
    /**
     * Only the main window syncs. `useHostManager` is instantiated in every
     * window, so three windows would hit NetBox three times and race each
     * other's `saveTree`.
     */
    isMainWindow: boolean;
    /** The host tree's own load-time migrations have settled. */
    ready: boolean;
    /** The user asked for a sync at startup. */
    enabled: boolean;
    /** A base URL is configured, so there is something to sync against. */
    configured: boolean;
    /** Run the sync. May be a fresh closure on every render — see below. */
    sync: () => void;
    /** Overridable so a test does not have to wait out the real delay. */
    delayMs?: number;
}

/**
 * Schedule exactly one NetBox sync per launch, a moment after the app settles.
 *
 * The scheduling is fiddlier than it looks, and the obvious spelling does not
 * work. Writing this inline in `App` with `sync` in the effect's dependency
 * array meant the effect was torn down and rebuilt on **every** render, because
 * `useNetboxSync` returns a fresh object each time. Each teardown ran the
 * cleanup, which cleared the pending timer; each rebuild hit the once-only
 * guard and returned without rescheduling. Any re-render inside the delay
 * window — and there is always one — cancelled the launch's sync permanently.
 *
 * Two things prevent that here:
 *   * `sync` is held in a ref, so an unstable caller closure is not a dependency.
 *   * the timer is cleared **only on unmount**, never by a dependency change, so
 *     a condition flipping mid-delay cannot silently cancel a scheduled sync.
 */
export function useNetboxStartupSync({
    isMainWindow,
    ready,
    enabled,
    configured,
    sync,
    delayMs = NETBOX_STARTUP_SYNC_DELAY_MS,
}: NetboxStartupSyncOptions): void {
    const started = useRef(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const syncRef = useRef(sync);

    // Assigned in an effect rather than during render: a render-phase write is
    // the pattern React Compiler flags, and the timer cannot fire before the
    // commit that sets this anyway.
    useEffect(() => {
        syncRef.current = sync;
    });

    useEffect(() => {
        if (started.current) return;
        if (!isMainWindow || !ready || !enabled || !configured) return;
        started.current = true;
        timer.current = setTimeout(() => {
            timer.current = null;
            syncRef.current();
        }, delayMs);
    }, [isMainWindow, ready, enabled, configured, delayMs]);

    // Unmount only. Deliberately separate from the effect above so that a
    // dependency change cannot cancel a sync that is already scheduled.
    useEffect(
        () => () => {
            if (timer.current !== null) clearTimeout(timer.current);
        },
        [],
    );
}
