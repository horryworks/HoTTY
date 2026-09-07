import { useCallback, useEffect, useRef, useState } from 'react';
import i18n from '../i18n';
import { tauriService } from '../services/tauriService';
import { useSettingsStore } from '../stores/settingsStore';
import { logError } from '../utils/logger';
import { reconcileNetboxTree, type NetboxSyncReport } from '../utils/netboxSync';
import { useHostManager } from './useHostManager';

/**
 * Fetch a NetBox snapshot, reconcile it into the Host Tree, and persist.
 *
 * The reconcile itself is a pure function (`utils/netboxSync.ts`); this hook is
 * only the plumbing around it — the token check, the single-flight guard, and
 * where the outcome is reported.
 */

/**
 * Module-level, so the Settings tab and the Host Tree toolbar cannot run two
 * syncs at once — they each mount their own `useNetboxSync`. Sharing one
 * promise (and one spinner) is simpler than threading state through `App`, and
 * mirrors the `treeListeners` / `treeWriteSeq` device in `useHostManager`.
 */
let inFlight: Promise<NetboxSyncReport | null> | null = null;

/**
 * The last report, for the Settings summary line. Not persisted: `lastSyncAt`
 * and `lastSyncError` are what survive a restart, and a stale count would claim
 * more than it knows.
 */
let lastReport: NetboxSyncReport | null = null;

type Listener = (syncing: boolean) => void;
const syncingListeners = new Set<Listener>();

function broadcastSyncing(value: boolean): void {
    for (const listener of syncingListeners) listener(value);
}

/** Test seam: the module-level state outlives a component. */
export function resetNetboxSyncState(): void {
    inFlight = null;
    lastReport = null;
}

export interface UseNetboxSync {
    /** Whether a sync is running anywhere in this window. */
    syncing: boolean;
    /** A base URL is configured, so the feature is set up enough to show. */
    configured: boolean;
    /** The last failure, from settings, so it survives a restart. */
    lastError: string | null;
    report: NetboxSyncReport | null;
    /**
     * Run a sync. Resolves to the report, or `null` when nothing ran (no URL,
     * no saved token) or the sync failed.
     */
    sync: (reason: 'manual' | 'startup') => Promise<NetboxSyncReport | null>;
}

export function useNetboxSync(): UseNetboxSync {
    const hostManager = useHostManager();
    const netbox = useSettingsStore((s) => s.netbox);
    const update = useSettingsStore((s) => s.update);

    const [syncing, setSyncing] = useState(inFlight !== null);
    const [report, setReport] = useState<NetboxSyncReport | null>(lastReport);

    useEffect(() => {
        const listener: Listener = (value) => setSyncing(value);
        syncingListeners.add(listener);
        return () => {
            syncingListeners.delete(listener);
        };
    }, []);

    // Read the tree and the config at reconcile time, not when `sync` was
    // created: the fetch is async, and the user may edit either meanwhile.
    const treeRef = useRef(hostManager.tree);
    useEffect(() => {
        treeRef.current = hostManager.tree;
    }, [hostManager.tree]);

    const netboxRef = useRef(netbox);
    useEffect(() => {
        netboxRef.current = netbox;
    }, [netbox]);

    const saveTree = hostManager.saveTree;

    const sync = useCallback(
        async (reason: 'manual' | 'startup'): Promise<NetboxSyncReport | null> => {
            if (!netboxRef.current.baseUrl) return null;
            if (inFlight) return inFlight;

            const run = (async (): Promise<NetboxSyncReport | null> => {
                const config = netboxRef.current;
                try {
                    // Nothing to do on an install that never connected. Checked
                    // before the request, so a startup sync on a fresh machine
                    // is silent and free.
                    if (!(await tauriService.netboxHasToken())) return null;

                    const snapshot = await tauriService.netboxFetchSnapshot(
                        config.baseUrl,
                        config.siteIdField || null,
                    );
                    const result = reconcileNetboxTree(treeRef.current, snapshot, {
                        now: new Date().toISOString(),
                    });
                    // Skipped entirely when nothing moved: no encrypt, no
                    // localStorage write, no cross-window broadcast.
                    if (result.report.changed) {
                        await saveTree(result.tree);
                    }
                    lastReport = result.report;
                    setReport(result.report);
                    update('netbox', {
                        ...netboxRef.current,
                        lastSyncAt: new Date().toISOString(),
                        lastSyncError: null,
                    });
                    return result.report;
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    const label = i18n.t('hostTree.netbox.syncFailed');
                    update('netbox', { ...netboxRef.current, lastSyncError: message });
                    if (reason === 'manual') {
                        // `logError` also raises a toast, which is right here:
                        // the user just pressed the button.
                        logError('NetBox', label, err);
                    } else {
                        // A startup failure stays quiet. A toast on every launch
                        // while the VPN is down is noise the user learns to
                        // ignore — so it is logged and recorded, and shown in
                        // Settings and on the sync button, but never popped up.
                        console.error(`[NetBox] ${label}`, err);
                        tauriService
                            .logDebug('error', 'NetBox', `${label}: ${message}`)
                            .catch(() => {
                                /* logging must never break a sync */
                            });
                    }
                    return null;
                } finally {
                    inFlight = null;
                    broadcastSyncing(false);
                }
            })();

            inFlight = run;
            broadcastSyncing(true);
            return run;
        },
        [saveTree, update],
    );

    return {
        syncing,
        configured: Boolean(netbox.baseUrl),
        lastError: netbox.lastSyncError,
        report,
        sync,
    };
}
