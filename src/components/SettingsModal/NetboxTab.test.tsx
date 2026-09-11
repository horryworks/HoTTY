import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NetboxTab } from './NetboxTab';
import { useSettingsStore } from '../../stores/settingsStore';
import type { HostTreeNode, NetboxProbeResult } from '../../types/appTypes';
import { resetNetboxSyncState } from '../../hooks/useNetboxSync';

const netboxConnect = vi.fn();
const netboxProbe = vi.fn();
const netboxHasToken = vi.fn();
const netboxDisconnect = vi.fn();
const netboxFetchSnapshot = vi.fn();

vi.mock('../../services/tauriService', () => ({
    isEncrypted: (v: string) => typeof v === 'string' && v.startsWith('[SAFE]'),
    tauriService: {
        netboxConnect: (...a: unknown[]) => netboxConnect(...a),
        netboxProbe: (...a: unknown[]) => netboxProbe(...a),
        netboxHasToken: () => netboxHasToken(),
        netboxDisconnect: () => netboxDisconnect(),
        netboxFetchSnapshot: (...a: unknown[]) => netboxFetchSnapshot(...a),
        dpapiEncryptBatch: async (v: string[]) => v.map((x) => `[SAFE]${x}`),
        dpapiDecryptBatch: async (v: string[]) => v.map((x) => x.replace('[SAFE]', '')),
        migrateHostTreeCredentials: async (json: string) => json,
        broadcastSharedChange: vi.fn(),
        onSharedStoreChanged: () => () => {},
        logDebug: vi.fn().mockResolvedValue(undefined),
    },
}));

const probeResult = (over: Partial<NetboxProbeResult> = {}): NetboxProbeResult => ({
    reachable: true,
    authenticated: true,
    apiVersion: '4.6',
    netboxVersion: '4.6.9',
    httpStatus: 200,
    siteIdFields: {
        customFieldsReadable: true,
        customFields: [],
        builtIns: ['slug', 'facility', 'description'],
    },
    ...over,
});

async function connectWith(result: NetboxProbeResult) {
    netboxConnect.mockResolvedValue(result);
    useSettingsStore.getState().update('netbox', {
        ...useSettingsStore.getState().netbox,
        baseUrl: 'https://netbox.example.com',
    });
    render(<NetboxTab />);
    fireEvent.change(screen.getByPlaceholderText('Paste the token'), {
        target: { value: 'a-token' },
    });
    fireEvent.click(screen.getByText('Connect'));
    await waitFor(() => expect(netboxConnect).toHaveBeenCalled());
}

describe('NetboxTab', () => {
    beforeEach(() => {
        localStorage.clear();
        useSettingsStore.getState().reset();
        resetNetboxSyncState();
        vi.clearAllMocks();
        netboxHasToken.mockResolvedValue(false);
    });

    it('renders the three sections', () => {
        render(<NetboxTab />);
        expect(screen.getByText('NetBox server')).toBeTruthy();
        expect(screen.getByText('Site ID field')).toBeTruthy();
        expect(screen.getByText('Sync')).toBeTruthy();
    });

    it('keeps the token in a password field', () => {
        render(<NetboxTab />);
        const input = screen.getByPlaceholderText('Paste the token') as HTMLInputElement;
        expect(input.type).toBe('password');
        expect(input.autocomplete).toBe('off');
    });

    it('warns that an http address sends the token unencrypted', () => {
        useSettingsStore.getState().update('netbox', {
            ...useSettingsStore.getState().netbox,
            baseUrl: 'http://netbox.example.com',
        });
        render(<NetboxTab />);
        expect(screen.getByText(/sent unencrypted/)).toBeTruthy();
    });

    it('does not warn about https', () => {
        useSettingsStore.getState().update('netbox', {
            ...useSettingsStore.getState().netbox,
            baseUrl: 'https://netbox.example.com',
        });
        render(<NetboxTab />);
        expect(screen.queryByText(/sent unencrypted/)).toBeNull();
    });

    describe('connection result', () => {
        it('says the token was refused when the address IS a NetBox', async () => {
            // The message that stops a user editing a URL that was correct.
            await connectWith(
                probeResult({ reachable: true, authenticated: false, netboxVersion: null, siteIdFields: null }),
            );
            expect(await screen.findByText(/refused the token/)).toBeTruthy();
            expect(screen.queryByText(/Could not reach a NetBox API/)).toBeNull();
        });

        it('says the address is not a NetBox when nothing identified itself', async () => {
            await connectWith(
                probeResult({
                    reachable: false,
                    authenticated: false,
                    apiVersion: null,
                    netboxVersion: null,
                    httpStatus: 404,
                    siteIdFields: null,
                }),
            );
            expect(await screen.findByText(/not a NetBox API \(HTTP 404\)/)).toBeTruthy();
            expect(screen.queryByText(/refused the token/)).toBeNull();
        });

        it('reports success with the NetBox version', async () => {
            await connectWith(probeResult());
            expect(await screen.findByText('Connected to NetBox 4.6.9.')).toBeTruthy();
        });

        it('puts the token box away once the token is sealed', async () => {
            // A blank "API token" box next to a Connect button reads as "your
            // token is gone" — the token can never come back to the renderer,
            // so that box would be blank forever. Say the state instead.
            await connectWith(probeResult());
            expect(await screen.findByText('A token is saved.')).toBeTruthy();
            await waitFor(() =>
                expect(screen.queryByPlaceholderText('Paste the token')).toBeNull(),
            );
        });

        it('offers to replace a saved token, and the box comes back empty', async () => {
            await connectWith(probeResult());
            expect(await screen.findByText('A token is saved.')).toBeTruthy();
            fireEvent.click(screen.getByText('Replace token'));
            const box = screen.getByPlaceholderText('Paste the token') as HTMLInputElement;
            // Never repopulated from anywhere: the renderer does not have it.
            expect(box.value).toBe('');
        });

        it('goes back to the saved state when a replacement is abandoned', async () => {
            await connectWith(probeResult());
            expect(await screen.findByText('A token is saved.')).toBeTruthy();
            fireEvent.click(screen.getByText('Replace token'));
            fireEvent.click(screen.getByText('Cancel'));
            expect(screen.queryByPlaceholderText('Paste the token')).toBeNull();
            expect(screen.getByText('A token is saved.')).toBeTruthy();
        });
    });

    describe('Site ID field picker', () => {
        it('offers the built-ins and the type-it-in row before any connect', () => {
            render(<NetboxTab />);
            const select = screen.getByText('Which NetBox field holds the site code')
                .closest('.settings-group')!
                .querySelector('select') as HTMLSelectElement;
            const values = Array.from(select.options).map((o) => o.value);
            expect(values).toContain('slug');
            expect(values).toContain('facility');
            expect(values).toContain('description');
            expect(values).toContain('__other__');
        });

        it('distinguishes "cannot read the definitions" from "there are none"', async () => {
            // 🚨 The first has a way forward; the second does not. Collapsing
            // them would send a user looking for a box that is right there.
            await connectWith(
                probeResult({
                    siteIdFields: {
                        customFieldsReadable: false,
                        customFields: [],
                        builtIns: ['slug'],
                    },
                }),
            );
            expect(await screen.findByText(/extras\.view_customfield/)).toBeTruthy();
            expect(screen.queryByText(/defines no custom fields/)).toBeNull();
        });

        it('says so plainly when the NetBox genuinely has no usable custom field', async () => {
            await connectWith(
                probeResult({
                    siteIdFields: {
                        customFieldsReadable: true,
                        customFields: [],
                        builtIns: ['slug'],
                    },
                }),
            );
            expect(await screen.findByText(/defines no custom fields/)).toBeTruthy();
            expect(screen.queryByText(/extras\.view_customfield/)).toBeNull();
        });

        it('lists a discovered custom field under its NetBox label', async () => {
            await connectWith(
                probeResult({
                    siteIdFields: {
                        customFieldsReadable: true,
                        customFields: [{ value: 'cf:site_code', label: 'Site Code' }],
                        builtIns: ['slug'],
                    },
                }),
            );
            const option = (await screen.findByText('Site Code')) as HTMLOptionElement;
            expect(option.value).toBe('cf:site_code');
        });

        it('stores the chosen field', () => {
            render(<NetboxTab />);
            const select = screen.getByText('Which NetBox field holds the site code')
                .closest('.settings-group')!
                .querySelector('select') as HTMLSelectElement;
            fireEvent.change(select, { target: { value: 'facility' } });
            expect(useSettingsStore.getState().netbox.siteIdField).toBe('facility');
        });

        it('shows a free-text box for Other, and refuses to store an illegal key', () => {
            render(<NetboxTab />);
            const select = screen.getByText('Which NetBox field holds the site code')
                .closest('.settings-group')!
                .querySelector('select') as HTMLSelectElement;
            fireEvent.change(select, { target: { value: '__other__' } });

            const box = screen.getByPlaceholderText('custom field name');
            fireEvent.change(box, { target: { value: 'bad-key' } });
            expect(screen.getByText(/only letters, numbers and underscores/)).toBeTruthy();
            expect(useSettingsStore.getState().netbox.siteIdField).not.toBe('cf:bad-key');

            fireEvent.change(box, { target: { value: 'site_code' } });
            expect(useSettingsStore.getState().netbox.siteIdField).toBe('cf:site_code');
        });

        it('previews the folder name the chosen field will produce', () => {
            render(<NetboxTab />);
            // No field chosen yet: the plain site name.
            expect(screen.getByText(/"Example Site"/)).toBeTruthy();

            const select = screen.getByText('Which NetBox field holds the site code')
                .closest('.settings-group')!
                .querySelector('select') as HTMLSelectElement;
            fireEvent.change(select, { target: { value: 'facility' } });
            expect(screen.getByText(/"SITE-01 Example Site"/)).toBeTruthy();
        });
    });

    describe('sync section', () => {
        it('says nothing has been synced yet', () => {
            render(<NetboxTab />);
            expect(screen.getByText('Not synced yet.')).toBeTruthy();
        });

        it('prompts for configuration while no address is set', () => {
            render(<NetboxTab />);
            expect(screen.getByText(/Enter your NetBox address and token/)).toBeTruthy();
        });

        it('shows the last failure, which survives a restart', () => {
            useSettingsStore.getState().update('netbox', {
                ...useSettingsStore.getState().netbox,
                baseUrl: 'https://netbox.example.com',
                lastSyncError: 'NetBox refused the API token',
            });
            render(<NetboxTab />);
            expect(screen.getByText(/NetBox refused the API token/)).toBeTruthy();
        });

        it('reports how many sites had no Site ID value', async () => {
            // Without this number, "the feature is broken" and "that field is
            // empty on every site" are indistinguishable.
            netboxHasToken.mockResolvedValue(true);
            netboxFetchSnapshot.mockResolvedValue({
                serverKey: 'default',
                siteIdField: 'facility',
                regions: [],
                sites: [
                    { id: 1, name: 'A', regionId: null, siteId: null },
                    { id: 2, name: 'B', regionId: null, siteId: null },
                ],
            });
            useSettingsStore.getState().update('netbox', {
                ...useSettingsStore.getState().netbox,
                baseUrl: 'https://netbox.example.com',
                siteIdField: 'facility',
            });
            render(<NetboxTab />);
            await waitFor(() => expect(netboxHasToken).toHaveBeenCalled());

            fireEvent.click(screen.getByText('Sync now'));
            expect(await screen.findByText(/No Site ID value on any of the 2 sites/)).toBeTruthy();
        });
    });

    describe('placement section', () => {
        function syncWith(over: Record<string, unknown>) {
            netboxHasToken.mockResolvedValue(true);
            netboxFetchSnapshot.mockResolvedValue({
                serverKey: 'default',
                siteIdField: null,
                regions: [],
                sites: [{ id: 1, name: 'Tokyo', regionId: null, siteId: null }],
                prefixes: [],
                prefixesUnavailable: null,
                prefixesSkipped: 0,
                ...over,
            });
            useSettingsStore.getState().update('netbox', {
                ...useSettingsStore.getState().netbox,
                baseUrl: 'https://netbox.example.com',
            });
        }

        it('offers the toggle, on by default', () => {
            render(<NetboxTab />);
            const box = screen.getByLabelText(/Use NetBox IP ranges to choose a folder/) as HTMLInputElement;
            expect(box.checked).toBe(true);
        });

        it('remembers the toggle being turned off', () => {
            render(<NetboxTab />);
            fireEvent.click(screen.getByLabelText(/Use NetBox IP ranges to choose a folder/));
            expect(useSettingsStore.getState().netbox.prefixPlacement).toBe(false);
        });

        it('says how many folders can now match a host', async () => {
            // The one number that separates "does nothing" from "is broken".
            syncWith({
                prefixes: [{ prefix: '10.1.0.0/16', scopeKind: 'site', scopeId: 1 }],
            });
            render(<NetboxTab />);
            await waitFor(() => expect(netboxHasToken).toHaveBeenCalled());
            fireEvent.click(screen.getByText('Sync now'));
            expect(await screen.findByText(/1 prefixes read; 1 folders can now match/)).toBeTruthy();
        });

        it('warns when prefixes were read but none landed on a folder', async () => {
            syncWith({
                prefixes: [{ prefix: '10.1.0.0/16', scopeKind: 'site', scopeId: 999 }],
            });
            render(<NetboxTab />);
            await waitFor(() => expect(netboxHasToken).toHaveBeenCalled());
            fireEvent.click(screen.getByText('Sync now'));
            expect(await screen.findByText(/none landed on a folder/)).toBeTruthy();
        });

        it('distinguishes a refused prefix list from an oversized one', async () => {
            // Both mean "nothing read, nothing cleared", but the fixes differ.
            syncWith({ prefixes: null, prefixesUnavailable: 'denied' });
            const { unmount } = render(<NetboxTab />);
            await waitFor(() => expect(netboxHasToken).toHaveBeenCalled());
            fireEvent.click(screen.getByText('Sync now'));
            expect(await screen.findByText(/ipam.view_prefix/)).toBeTruthy();
            unmount();

            resetNetboxSyncState();
            syncWith({ prefixes: null, prefixesUnavailable: 'tooMany' });
            render(<NetboxTab />);
            await waitFor(() => expect(netboxHasToken).toHaveBeenCalled());
            fireEvent.click(screen.getByText('Sync now'));
            expect(await screen.findByText(/more prefixes than HoTTY will read/)).toBeTruthy();
        });

        it('reports prefixes attached to something it has no folder for', async () => {
            syncWith({ prefixesSkipped: 3 });
            render(<NetboxTab />);
            await waitFor(() => expect(netboxHasToken).toHaveBeenCalled());
            fireEvent.click(screen.getByText('Sync now'));
            expect(await screen.findByText(/Ignored 3 prefixes/)).toBeTruthy();
        });

        it('hides the counters while the toggle is off', async () => {
            syncWith({ prefixes: [{ prefix: '10.1.0.0/16', scopeKind: 'site', scopeId: 1 }] });
            useSettingsStore.getState().update('netbox', {
                ...useSettingsStore.getState().netbox,
                prefixPlacement: false,
            });
            render(<NetboxTab />);
            await waitFor(() => expect(netboxHasToken).toHaveBeenCalled());
            fireEvent.click(screen.getByText('Sync now'));
            await waitFor(() => expect(netboxFetchSnapshot).toHaveBeenCalled());
            expect(screen.queryByText(/folders can now match/)).toBeNull();
        });
    });
});

describe('NetboxTab — scan the whole tree', () => {
    /** One site with a range, and a host outside it that belongs inside. */
    const seeded: HostTreeNode[] = [
        {
            id: 's1', type: 'folder', name: 'TOK Tokyo', children: [],
            netbox: { server: 'default', kind: 'site', objectId: 10, prefixes: ['10.1.0.0/16'] },
        },
        {
            id: 'mine', type: 'folder', name: 'Production', children: [
                { id: 'h1', type: 'host', name: 'tokyo-01', entry: { protocol: 'ssh', host: '10.1.0.9', port: 22 } },
            ],
        },
    ];

    beforeEach(() => {
        localStorage.clear();
        useSettingsStore.getState().reset();
        resetNetboxSyncState();
        vi.clearAllMocks();
        netboxHasToken.mockResolvedValue(false);
        localStorage.setItem('hotty_host_tree', JSON.stringify(seeded));
    });

    /** Render and wait for the tree's load-time decrypt to settle. */
    async function ready() {
        render(<NetboxTab />);
        const button = await screen.findByText('Sort all hosts by IP range…');
        await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
        return button;
    }

    it('offers the scan while placement is on', async () => {
        expect(await ready()).toBeTruthy();
    });

    it('hides the scan while placement is off', () => {
        useSettingsStore.getState().update('netbox', {
            ...useSettingsStore.getState().netbox,
            prefixPlacement: false,
        });
        render(<NetboxTab />);
        expect(screen.queryByText('Sort all hosts by IP range…')).toBeNull();
    });

    it('opens the preview over the whole tree, and moves nothing yet', async () => {
        fireEvent.click(await ready());
        // "All hosts" is the modal's name for the whole-tree scope, which is
        // the only scope the settings entry point ever uses.
        expect(screen.getByText('All hosts')).toBeTruthy();
        expect(screen.getByText('Will move (1)')).toBeTruthy();
        expect(JSON.parse(localStorage.getItem('hotty_host_tree')!)).toEqual(seeded);
    });

    it('moves the host and reports the count once applied', async () => {
        fireEvent.click(await ready());
        fireEvent.click(screen.getByText('Move 1'));
        // Singular: the key carries _one/_other, so one host is not "1 hosts".
        await waitFor(() => expect(screen.getByText('Moved 1 host.')).toBeTruthy());
        expect(screen.queryByText('Will move (1)')).toBeNull();
    });

    it('closes only the preview, leaving the tab in place', async () => {
        fireEvent.click(await ready());
        fireEvent.click(screen.getByText('Cancel'));
        expect(screen.queryByText('Will move (1)')).toBeNull();
        expect(screen.getByText('Sort all hosts by IP range…')).toBeTruthy();
    });
});
