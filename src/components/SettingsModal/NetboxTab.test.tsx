import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NetboxTab } from './NetboxTab';
import { useSettingsStore } from '../../stores/settingsStore';
import type { NetboxProbeResult } from '../../types/appTypes';
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

        it('clears the token box once the token is sealed', async () => {
            await connectWith(probeResult());
            await waitFor(() =>
                expect(
                    (screen.getByPlaceholderText('Paste the token') as HTMLInputElement).value,
                ).toBe(''),
            );
            // And it is never repopulated from anywhere.
            expect(await screen.findByText('A token is saved.')).toBeTruthy();
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
});
