import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { SaveToHostTreeDialog } from './SaveToHostTreeDialog';
import { buildHostEntryFromConfig } from './buildHostEntry';
import type {
    HostTreeNode,
    SshConnectionConfig,
    TelnetConnectionConfig,
    SerialConnectionConfig,
} from '../../types/appTypes';
import { useSettingsStore } from '../../stores/settingsStore';

// Mock tauriService so useHostManager (used inside the dialog) doesn't hit Tauri.
vi.mock('../../services/tauriService', () => ({
    tauriService: {
        dpapiEncryptBatch: vi.fn(async (values: string[]) => values.map(v => `[SAFE]${v}`)),
        dpapiDecryptBatch: vi.fn(async (values: string[]) => values.map(v => v.replace(/^\[SAFE\]/, ''))),
        migrateHostTreeCredentials: vi.fn(async (treeJson: string) => treeJson),
        logDebug: vi.fn(async () => undefined),
    },
    isEncrypted: (value: string) => value.startsWith('[DPAPI]') || value.startsWith('[SAFE]'),
}));

describe('buildHostEntryFromConfig', () => {
    it('builds an SSH entry with all credential fields', () => {
        const config: SshConnectionConfig = {
            host: '10.0.0.5',
            port: 22,
            username: 'alice',
            password: 'secret',
            privateKeyPath: '~/.ssh/id_rsa',
            privateKeyPassphrase: 'kpass',
            encoding: 'utf8',
            keepaliveIntervalSecs: 0,
            connectTimeoutSecs: 5,
        };
        expect(buildHostEntryFromConfig('ssh', config)).toEqual({
            protocol: 'ssh',
            host: '10.0.0.5',
            port: 22,
            username: 'alice',
            password: 'secret',
            privateKeyPath: '~/.ssh/id_rsa',
            privateKeyPassphrase: 'kpass',
        });
    });

    it('omits empty SSH credentials', () => {
        const config: SshConnectionConfig = {
            host: 'host',
            port: 22,
            username: 'u',
            encoding: 'utf8',
            keepaliveIntervalSecs: 0,
            connectTimeoutSecs: 5,
        };
        const entry = buildHostEntryFromConfig('ssh', config);
        expect(entry).toMatchObject({ protocol: 'ssh', host: 'host', port: 22, username: 'u' });
        expect(entry?.password).toBeUndefined();
        expect(entry?.privateKeyPath).toBeUndefined();
        expect(entry?.privateKeyPassphrase).toBeUndefined();
    });

    it('builds a Telnet entry', () => {
        const config: TelnetConnectionConfig = {
            host: 'switch.local',
            port: 23,
            username: 'admin',
            password: 'p',
            encoding: 'utf8',
            keepaliveIntervalSecs: 0,
            connectTimeoutSecs: 5,
        };
        expect(buildHostEntryFromConfig('telnet', config)).toEqual({
            protocol: 'telnet',
            host: 'switch.local',
            port: 23,
            username: 'admin',
            password: 'p',
        });
    });

    it('returns null for unsupported protocols', () => {
        const serial: SerialConnectionConfig = {
            path: 'COM1',
            baudRate: 9600,
            dataBits: '8',
            parity: 'none',
            stopBits: '1',
            flowControl: 'none',
            encoding: 'utf8',
        };
        expect(buildHostEntryFromConfig('serial', serial)).toBeNull();
        expect(buildHostEntryFromConfig('wsl', { distribution: 'Ubuntu', encoding: 'utf8' })).toBeNull();
    });

    it('returns null for null/undefined inputs', () => {
        expect(buildHostEntryFromConfig(null, undefined)).toBeNull();
        expect(buildHostEntryFromConfig('ssh', undefined)).toBeNull();
    });
});

describe('SaveToHostTreeDialog', () => {
    const sshConfig: SshConnectionConfig = {
        host: '10.0.0.5',
        port: 22,
        username: 'alice',
        encoding: 'utf8',
        keepaliveIntervalSecs: 0,
        connectTimeoutSecs: 5,
    };

    beforeEach(() => {
        localStorage.clear();
    });

    it('renders nothing when closed', () => {
        const { container } = render(
            <SaveToHostTreeDialog
                open={false}
                initialName="x"
                protocol="ssh"
                config={sshConfig}
                onClose={() => {}}
            />,
        );
        expect(container.querySelector('.save-to-tree-modal')).toBeNull();
    });

    it('prefills the name from initialName', () => {
        render(
            <SaveToHostTreeDialog
                open
                initialName="my-bastion"
                protocol="ssh"
                config={sshConfig}
                onClose={() => {}}
            />,
        );
        const nameInput = screen.getByDisplayValue('my-bastion') as HTMLInputElement;
        expect(nameInput).toBeTruthy();
    });

    it('Cancel button calls onClose', () => {
        const onClose = vi.fn();
        render(
            <SaveToHostTreeDialog
                open
                initialName="x"
                protocol="ssh"
                config={sshConfig}
                onClose={onClose}
            />,
        );
        const cancelButtons = screen.getAllByText('Cancel');
        fireEvent.click(cancelButtons[cancelButtons.length - 1]);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('shows error message for unsupported protocol and hides Save button', () => {
        render(
            <SaveToHostTreeDialog
                open
                initialName="x"
                protocol="serial"
                config={{
                    path: 'COM1',
                    baudRate: 9600,
                    dataBits: '8',
                    parity: 'none',
                    stopBits: '1',
                    flowControl: 'none',
                    encoding: 'utf8',
                }}
                onClose={() => {}}
            />,
        );
        expect(
            screen.getByText(/only SSH and Telnet sessions are supported/i),
        ).toBeTruthy();
        expect(screen.queryByText('Save')).toBeNull();
        expect(screen.queryByText('+ New Folder')).toBeNull();
        expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('disables Save when name is empty', () => {
        render(
            <SaveToHostTreeDialog
                open
                initialName=""
                protocol="ssh"
                config={sshConfig}
                onClose={() => {}}
            />,
        );
        const saveBtn = screen.getByText('Save') as HTMLButtonElement;
        expect(saveBtn.disabled).toBe(true);
    });

    it('enables Save when name is entered', () => {
        render(
            <SaveToHostTreeDialog
                open
                initialName=""
                protocol="ssh"
                config={sshConfig}
                onClose={() => {}}
            />,
        );
        const nameInput = screen.getAllByRole('textbox')[0] as HTMLInputElement;
        fireEvent.change(nameInput, { target: { value: 'my-host' } });
        const saveBtn = screen.getByText('Save') as HTMLButtonElement;
        expect(saveBtn.disabled).toBe(false);
    });

    describe('folder tree', () => {
        it('shows (Root) row and selects it by default', () => {
            render(
                <SaveToHostTreeDialog
                    open
                    initialName="x"
                    protocol="ssh"
                    config={sshConfig}
                    onClose={() => {}}
                />,
            );
            const rootRow = screen.getByText('(Root)').closest('.save-to-tree-folder-row');
            expect(rootRow?.classList.contains('selected')).toBe(true);
        });

        it('renders existing folders from the host tree', () => {
            const tree: HostTreeNode[] = [
                {
                    id: 'f1',
                    type: 'folder',
                    name: 'Production',
                    children: [
                        { id: 'f2', type: 'folder', name: 'EU', children: [] },
                    ],
                },
                {
                    id: 'h1',
                    type: 'host',
                    name: 'should-not-render',
                    entry: { protocol: 'ssh', host: 'x', port: 22 },
                },
            ];
            localStorage.setItem('hotty_host_tree', JSON.stringify(tree));

            render(
                <SaveToHostTreeDialog
                    open
                    initialName="x"
                    protocol="ssh"
                    config={sshConfig}
                    onClose={() => {}}
                />,
            );
            expect(screen.getByText('Production')).toBeTruthy();
            expect(screen.getByText('EU')).toBeTruthy();
            expect(screen.queryByText('should-not-render')).toBeNull();
        });

        it('clicking a folder row selects it', () => {
            const tree: HostTreeNode[] = [
                { id: 'f1', type: 'folder', name: 'Production', children: [] },
            ];
            localStorage.setItem('hotty_host_tree', JSON.stringify(tree));

            render(
                <SaveToHostTreeDialog
                    open
                    initialName="x"
                    protocol="ssh"
                    config={sshConfig}
                    onClose={() => {}}
                />,
            );
            const prodRow = screen.getByText('Production').closest('.save-to-tree-folder-row')!;
            fireEvent.click(prodRow);
            expect(prodRow.classList.contains('selected')).toBe(true);
            const rootRow = screen.getByText('(Root)').closest('.save-to-tree-folder-row');
            expect(rootRow?.classList.contains('selected')).toBe(false);
        });
    });

    describe('new folder creation', () => {
        it('clicking + New Folder shows inline input', () => {
            render(
                <SaveToHostTreeDialog
                    open
                    initialName="x"
                    protocol="ssh"
                    config={sshConfig}
                    onClose={() => {}}
                />,
            );
            expect(screen.queryByPlaceholderText('New folder name')).toBeNull();
            fireEvent.click(screen.getByText('+ New Folder'));
            expect(screen.getByPlaceholderText('New folder name')).toBeTruthy();
        });

        it('Create is disabled when new folder name is empty', () => {
            render(
                <SaveToHostTreeDialog
                    open
                    initialName="x"
                    protocol="ssh"
                    config={sshConfig}
                    onClose={() => {}}
                />,
            );
            fireEvent.click(screen.getByText('+ New Folder'));
            const createBtn = screen.getByText('Create') as HTMLButtonElement;
            expect(createBtn.disabled).toBe(true);
        });

        it('creating a folder adds it to the tree and selects it', async () => {
            render(
                <SaveToHostTreeDialog
                    open
                    initialName="x"
                    protocol="ssh"
                    config={sshConfig}
                    onClose={() => {}}
                />,
            );
            fireEvent.click(screen.getByText('+ New Folder'));
            const input = screen.getByPlaceholderText('New folder name') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'MyGroup' } });
            fireEvent.click(screen.getByText('Create'));

            await waitFor(() => {
                expect(screen.getByText('MyGroup')).toBeTruthy();
            });
            const myGroupRow = screen.getByText('MyGroup').closest('.save-to-tree-folder-row');
            expect(myGroupRow?.classList.contains('selected')).toBe(true);
            // Inline input should be gone.
            expect(screen.queryByPlaceholderText('New folder name')).toBeNull();
        });

        it('Enter key inside inline input creates the folder', async () => {
            render(
                <SaveToHostTreeDialog
                    open
                    initialName="x"
                    protocol="ssh"
                    config={sshConfig}
                    onClose={() => {}}
                />,
            );
            fireEvent.click(screen.getByText('+ New Folder'));
            const input = screen.getByPlaceholderText('New folder name') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'ViaEnter' } });
            fireEvent.keyDown(input, { key: 'Enter' });

            await waitFor(() => {
                expect(screen.getByText('ViaEnter')).toBeTruthy();
            });
        });

        it('Cancel button dismisses inline input without creating a folder', () => {
            render(
                <SaveToHostTreeDialog
                    open
                    initialName="x"
                    protocol="ssh"
                    config={sshConfig}
                    onClose={() => {}}
                />,
            );
            fireEvent.click(screen.getByText('+ New Folder'));
            const input = screen.getByPlaceholderText('New folder name') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'should-be-discarded' } });

            // The inline input row has its own Cancel button alongside Create.
            const inputRow = input.closest('.save-to-tree-inline-input-row')!;
            fireEvent.click(within(inputRow as HTMLElement).getByText('Cancel'));

            expect(screen.queryByPlaceholderText('New folder name')).toBeNull();
            expect(screen.queryByText('should-be-discarded')).toBeNull();
        });

        it('Escape key in inline input cancels creation', () => {
            render(
                <SaveToHostTreeDialog
                    open
                    initialName="x"
                    protocol="ssh"
                    config={sshConfig}
                    onClose={() => {}}
                />,
            );
            fireEvent.click(screen.getByText('+ New Folder'));
            const input = screen.getByPlaceholderText('New folder name') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'temp' } });
            fireEvent.keyDown(input, { key: 'Escape' });

            expect(screen.queryByPlaceholderText('New folder name')).toBeNull();
        });

        it('Escape inside inline input does not close the dialog', () => {
            const onClose = vi.fn();
            render(
                <SaveToHostTreeDialog
                    open
                    initialName="x"
                    protocol="ssh"
                    config={sshConfig}
                    onClose={onClose}
                />,
            );
            fireEvent.click(screen.getByText('+ New Folder'));
            const input = screen.getByPlaceholderText('New folder name') as HTMLInputElement;
            fireEvent.keyDown(input, { key: 'Escape' });
            expect(onClose).not.toHaveBeenCalled();
        });

        it('supports nested folder creation', async () => {
            render(
                <SaveToHostTreeDialog
                    open
                    initialName="x"
                    protocol="ssh"
                    config={sshConfig}
                    onClose={() => {}}
                />,
            );
            // Create A at root.
            fireEvent.click(screen.getByText('+ New Folder'));
            fireEvent.change(screen.getByPlaceholderText('New folder name'), { target: { value: 'A' } });
            fireEvent.click(screen.getByText('Create'));
            await waitFor(() => expect(screen.getByText('A')).toBeTruthy());

            // A is now selected. Click + New Folder again — input appears under A.
            fireEvent.click(screen.getByText('+ New Folder'));
            fireEvent.change(screen.getByPlaceholderText('New folder name'), { target: { value: 'B' } });
            fireEvent.click(screen.getByText('Create'));
            await waitFor(() => expect(screen.getByText('B')).toBeTruthy());

            const bRow = screen.getByText('B').closest('.save-to-tree-folder-row')!;
            expect(bRow.classList.contains('selected')).toBe(true);
            // B should be indented deeper than A.
            const aRow = screen.getByText('A').closest('.save-to-tree-folder-row') as HTMLElement;
            const aPad = parseInt((aRow.style.paddingLeft || '0').replace('px', ''), 10);
            const bPad = parseInt(((bRow as HTMLElement).style.paddingLeft || '0').replace('px', ''), 10);
            expect(bPad).toBeGreaterThan(aPad);
        });

        it('+ New Folder button is disabled while inline input is open', () => {
            render(
                <SaveToHostTreeDialog
                    open
                    initialName="x"
                    protocol="ssh"
                    config={sshConfig}
                    onClose={() => {}}
                />,
            );
            const btn = screen.getByText('+ New Folder') as HTMLButtonElement;
            fireEvent.click(btn);
            expect(btn.disabled).toBe(true);
        });
    });
});

describe('SaveToHostTreeDialog — NetBox prefix placement', () => {
    const sshConfig: SshConnectionConfig = {
        host: '10.1.0.9',
        port: 22,
        username: 'alice',
        encoding: 'utf8',
        keepaliveIntervalSecs: 0,
        connectTimeoutSecs: 5,
    };

    /** Container, one site with a prefix, one plain folder. */
    function seedTree(prefixes = ['10.1.0.0/16']) {
        const tree: HostTreeNode[] = [
            {
                id: 'c', type: 'folder', name: 'NetBox',
                netbox: { server: 'default', kind: 'root' },
                children: [
                    {
                        id: 's1', type: 'folder', name: 'TOK Tokyo', children: [],
                        netbox: { server: 'default', kind: 'site', objectId: 10, prefixes },
                    },
                ],
            },
            { id: 'mine', type: 'folder', name: 'Mine', children: [] },
        ];
        localStorage.setItem('hotty_host_tree', JSON.stringify(tree));
    }

    const open = (config: SshConnectionConfig = sshConfig) =>
        render(
            <SaveToHostTreeDialog
                open
                initialName="tokyo-01"
                protocol="ssh"
                config={config}
                onClose={() => {}}
            />,
        );

    beforeEach(() => {
        localStorage.clear();
        useSettingsStore.getState().reset();
    });

    const selectedRow = () =>
        document.querySelector('.save-to-tree-folder-row.selected')?.textContent ?? '';

    it('preselects the folder the address matches', async () => {
        seedTree();
        open();
        await waitFor(() => expect(selectedRow()).toContain('TOK Tokyo'));
    });

    it('explains which prefix chose the folder', async () => {
        seedTree();
        open();
        expect(await screen.findByText(/10\.1\.0\.0\/16/)).toBeTruthy();
    });

    it('falls back to the root when nothing matches', async () => {
        seedTree(['192.168.9.0/24']);
        open();
        await waitFor(() => expect(selectedRow()).toContain('(Root)'));
        expect(screen.queryByText(/Picked the folder/)).toBeNull();
    });

    it('shows nothing at all when the tree carries no prefixes', async () => {
        localStorage.setItem('hotty_host_tree', JSON.stringify([
            { id: 'mine', type: 'folder', name: 'Mine', children: [] },
        ]));
        open();
        await waitFor(() => expect(selectedRow()).toContain('(Root)'));
        expect(screen.queryByText(/NetBox/)).toBeNull();
    });

    it('does not resolve a name, so a hostname preselects nothing', async () => {
        seedTree();
        open({ ...sshConfig, host: 'router1.example.com' });
        await waitFor(() => expect(selectedRow()).toContain('(Root)'));
    });

    it('will not choose when two folders claim the address', async () => {
        localStorage.setItem('hotty_host_tree', JSON.stringify([
            { id: 'a', type: 'folder', name: 'TOK Tokyo', children: [], netbox: { server: 'default', kind: 'site', objectId: 10, prefixes: ['10.1.0.0/16'] } },
            { id: 'b', type: 'folder', name: 'OSA Osaka', children: [], netbox: { server: 'default', kind: 'site', objectId: 11, prefixes: ['10.1.0.0/16'] } },
        ]));
        open();
        expect(await screen.findByText(/so none was picked/)).toBeTruthy();
        await waitFor(() => expect(selectedRow()).toContain('(Root)'));
    });

    it('suggests nothing while the setting is off', async () => {
        seedTree();
        useSettingsStore.getState().update('netbox', {
            ...useSettingsStore.getState().netbox,
            prefixPlacement: false,
        });
        open();
        await waitFor(() => expect(selectedRow()).toContain('(Root)'));
    });

    it('keeps a folder the user picked, and drops the explanation with it', async () => {
        seedTree();
        open();
        await waitFor(() => expect(selectedRow()).toContain('TOK Tokyo'));
        fireEvent.click(screen.getByText('Mine'));
        expect(selectedRow()).toContain('Mine');
        expect(screen.queryByText(/Picked the folder/)).toBeNull();
    });

    it('saves into the preselected folder', async () => {
        seedTree();
        const onClose = vi.fn();
        render(
            <SaveToHostTreeDialog
                open
                initialName="tokyo-01"
                protocol="ssh"
                config={sshConfig}
                onClose={onClose}
            />,
        );
        await waitFor(() => expect(selectedRow()).toContain('TOK Tokyo'));
        fireEvent.click(screen.getByText('Save'));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
        const saved = JSON.parse(localStorage.getItem('hotty_host_tree') ?? '[]') as HostTreeNode[];
        const site = saved[0].children?.[0];
        expect(site?.children?.map((n) => n.name)).toEqual(['tokyo-01']);
    });
});
