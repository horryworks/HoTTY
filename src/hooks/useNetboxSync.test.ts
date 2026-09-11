import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useNetboxSync, resetNetboxSyncState } from './useNetboxSync';
import { useSettingsStore } from '../stores/settingsStore';
import { useErrorNotificationStore } from '../stores/errorNotificationStore';
import type { NetboxSnapshot } from '../types/appTypes';

const netboxHasToken = vi.fn();
const netboxFetchSnapshot = vi.fn();

vi.mock('../services/tauriService', () => ({
    isEncrypted: (v: string) => typeof v === 'string' && v.startsWith('[SAFE]'),
    tauriService: {
        netboxHasToken: () => netboxHasToken(),
        netboxFetchSnapshot: (...a: unknown[]) => netboxFetchSnapshot(...a),
        dpapiEncryptBatch: async (v: string[]) => v.map((x) => `[SAFE]${x}`),
        dpapiDecryptBatch: async (v: string[]) => v.map((x) => x.replace('[SAFE]', '')),
        migrateHostTreeCredentials: async (json: string) => json,
        broadcastSharedChange: vi.fn(),
        onSharedStoreChanged: () => () => {},
        logDebug: vi.fn().mockResolvedValue(undefined),
    },
}));

const snapshot = (over: Partial<NetboxSnapshot> = {}): NetboxSnapshot => ({
    serverKey: 'default',
    siteIdField: null,
    regions: [{ id: 1, name: 'Asia', parentId: null, depth: 0 }],
    sites: [{ id: 10, name: 'Example Site', regionId: 1, siteId: null }],
    prefixes: null,
    prefixesUnavailable: 'disabled',
    prefixesSkipped: 0,
    ...over,
});

function configure(over: Record<string, unknown> = {}) {
    useSettingsStore.getState().update('netbox', {
        ...useSettingsStore.getState().netbox,
        baseUrl: 'https://netbox.example.com',
        ...over,
    });
}

describe('useNetboxSync', () => {
    beforeEach(() => {
        localStorage.clear();
        useSettingsStore.getState().reset();
        useErrorNotificationStore.getState().clear();
        resetNetboxSyncState();
        vi.clearAllMocks();
        netboxHasToken.mockResolvedValue(true);
        netboxFetchSnapshot.mockResolvedValue(snapshot());
    });

    it('does nothing when no base URL is configured', async () => {
        const { result } = renderHook(() => useNetboxSync());
        let report;
        await act(async () => {
            report = await result.current.sync('startup');
        });
        expect(report).toBeNull();
        expect(netboxHasToken).not.toHaveBeenCalled();
        expect(netboxFetchSnapshot).not.toHaveBeenCalled();
    });

    it('does nothing when no token is saved', async () => {
        // A startup sync on a fresh machine must be silent and free.
        netboxHasToken.mockResolvedValue(false);
        configure();
        const { result } = renderHook(() => useNetboxSync());
        await act(async () => {
            await result.current.sync('startup');
        });
        expect(netboxFetchSnapshot).not.toHaveBeenCalled();
    });

    it('syncs and records the time', async () => {
        configure();
        const { result } = renderHook(() => useNetboxSync());
        await act(async () => {
            await result.current.sync('manual');
        });
        expect(netboxFetchSnapshot).toHaveBeenCalledWith('https://netbox.example.com', null, true);
        const state = useSettingsStore.getState().netbox;
        expect(state.lastSyncAt).toBeTruthy();
        expect(state.lastSyncError).toBeNull();
        expect(result.current.report?.created).toBe(2);
    });

    it('passes the configured Site ID field through', async () => {
        configure({ siteIdField: 'cf:site_code' });
        const { result } = renderHook(() => useNetboxSync());
        await act(async () => {
            await result.current.sync('manual');
        });
        expect(netboxFetchSnapshot).toHaveBeenCalledWith(
            'https://netbox.example.com',
            'cf:site_code',
            true,
        );
    });

    it('always sends a real boolean, even when the stored config predates the flag', async () => {
        // `invoke` drops an `undefined` field, and the Rust command then fails
        // on a missing `with_prefixes` — which took the whole sync down,
        // regions and sites with it.
        configure({ prefixPlacement: undefined });
        const { result } = renderHook(() => useNetboxSync());
        await act(async () => {
            await result.current.sync('manual');
        });
        const args = netboxFetchSnapshot.mock.calls[0];
        expect(args[2]).toBe(true);
        expect(typeof args[2]).toBe('boolean');
    });

    it('does not ask for prefixes when placement is off', async () => {
        // The prefix listing is much the largest of the three requests; a user
        // who turned placement off should not pay for it on every startup sync.
        configure({ prefixPlacement: false });
        const { result } = renderHook(() => useNetboxSync());
        await act(async () => {
            await result.current.sync('manual');
        });
        expect(netboxFetchSnapshot).toHaveBeenCalledWith('https://netbox.example.com', null, false);
    });

    it('sends null rather than an empty string when no field is configured', async () => {
        configure({ siteIdField: '' });
        const { result } = renderHook(() => useNetboxSync());
        await act(async () => {
            await result.current.sync('manual');
        });
        expect(netboxFetchSnapshot).toHaveBeenCalledWith('https://netbox.example.com', null, true);
    });

    it('does not persist when the reconcile changed nothing', async () => {
        configure();
        const { result } = renderHook(() => useNetboxSync());
        await act(async () => {
            await result.current.sync('manual');
        });
        const firstWrite = localStorage.getItem('hotty_host_tree');
        expect(firstWrite).toBeTruthy();

        // A second identical sync must not re-encrypt and re-write the tree.
        localStorage.setItem('hotty_host_tree_probe', 'untouched');
        const before = localStorage.getItem('hotty_host_tree');
        await act(async () => {
            await result.current.sync('manual');
        });
        expect(result.current.report?.changed).toBe(false);
        expect(localStorage.getItem('hotty_host_tree')).toBe(before);
    });

    it('records a failure and toasts it when the user asked for the sync', async () => {
        netboxFetchSnapshot.mockRejectedValue(new Error('NetBox refused the API token'));
        configure();
        const { result } = renderHook(() => useNetboxSync());
        await act(async () => {
            await result.current.sync('manual');
        });
        expect(useSettingsStore.getState().netbox.lastSyncError).toBe(
            'NetBox refused the API token',
        );
        expect(useErrorNotificationStore.getState().notifications).toHaveLength(1);
    });

    it('records a startup failure without a toast', async () => {
        // A toast on every launch while the VPN is down is noise the user
        // learns to ignore; Settings and the sync button still show it.
        netboxFetchSnapshot.mockRejectedValue(new Error('Could not reach NetBox.'));
        configure();
        const { result } = renderHook(() => useNetboxSync());
        await act(async () => {
            await result.current.sync('startup');
        });
        expect(useSettingsStore.getState().netbox.lastSyncError).toBe('Could not reach NetBox.');
        expect(useErrorNotificationStore.getState().notifications).toHaveLength(0);
    });

    it('clears a previous error on the next success', async () => {
        configure({ lastSyncError: 'stale failure' });
        const { result } = renderHook(() => useNetboxSync());
        await act(async () => {
            await result.current.sync('manual');
        });
        expect(useSettingsStore.getState().netbox.lastSyncError).toBeNull();
    });

    it('runs only one sync at a time', async () => {
        // The Settings tab and the Host Tree toolbar each mount their own hook.
        configure();
        const { result } = renderHook(() => useNetboxSync());
        await act(async () => {
            await Promise.all([result.current.sync('manual'), result.current.sync('manual')]);
        });
        expect(netboxFetchSnapshot).toHaveBeenCalledTimes(1);
    });

    it('reports whether the feature is configured', async () => {
        const { result, rerender } = renderHook(() => useNetboxSync());
        expect(result.current.configured).toBe(false);
        act(() => configure());
        rerender();
        await waitFor(() => expect(result.current.configured).toBe(true));
    });
});
