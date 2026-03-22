import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
    useHostManager,
    getCachedCredential,
    setCachedCredential,
    clearDecryptedCache,
    decryptBatch,
    flattenHosts,
    getJumpboxReferences,
} from './useHostManager';
import type { HostTreeNode } from './useHostManager';
import { STORAGE_KEYS } from '../constants/storage';

vi.mock('../services/electronService', () => ({
    encryptSecrets: vi.fn(async (values: (string | undefined)[]) => values),
    decryptSecrets: vi.fn(async (values: (string | undefined)[]) => values),
}));

beforeEach(() => {
    localStorage.clear();
    clearDecryptedCache();
    vi.clearAllMocks();
});

// ── Cache helper tests ──

describe('credential cache helpers', () => {
    it('getCachedCredential returns undefined for unknown id', () => {
        expect(getCachedCredential('unknown')).toBeUndefined();
    });

    it('setCachedCredential stores and retrieves values', () => {
        setCachedCredential('host-1', { username: 'alice', password: 'secret' });
        expect(getCachedCredential('host-1')).toEqual({ username: 'alice', password: 'secret' });
    });

    it('setCachedCredential merges partial updates', () => {
        setCachedCredential('host-2', { username: 'bob' });
        setCachedCredential('host-2', { password: 'pass' });
        expect(getCachedCredential('host-2')).toMatchObject({ username: 'bob', password: 'pass' });
    });

    it('setCachedCredential sets decrypted flag', () => {
        setCachedCredential('host-3', { decrypted: true });
        expect(getCachedCredential('host-3')?.decrypted).toBe(true);
    });

    it('clearDecryptedCache removes all entries', () => {
        setCachedCredential('host-a', { username: 'user' });
        setCachedCredential('host-b', { username: 'other' });
        clearDecryptedCache();
        expect(getCachedCredential('host-a')).toBeUndefined();
        expect(getCachedCredential('host-b')).toBeUndefined();
    });
});

// ── decryptBatch tests ──

describe('decryptBatch', () => {
    it('returns empty array for empty input', async () => {
        const result = await decryptBatch([]);
        expect(result).toEqual([]);
    });

    it('returns values as-is when electronService is available (mock passes through)', async () => {
        const result = await decryptBatch(['value1', 'value2']);
        expect(result).toEqual(['value1', 'value2']);
    });
});

// ── useHostManager hook tests ──

describe('useHostManager — initial state', () => {
    it('tree is empty initially', () => {
        const { result } = renderHook(() => useHostManager());
        expect(result.current.tree).toEqual([]);
    });

    it('loads tree from localStorage on mount', async () => {
        const stored = [{ id: 'f1', type: 'folder', name: 'Servers', children: [] }];
        localStorage.setItem(STORAGE_KEYS.HOST_TREE, JSON.stringify(stored));
        const { result } = renderHook(() => useHostManager());
        await waitFor(() => {
            expect(result.current.tree.length).toBe(1);
        });
        expect(result.current.tree[0].name).toBe('Servers');
    });
});

describe('useHostManager — addFolder', () => {
    it('adds a folder to the root', () => {
        const { result } = renderHook(() => useHostManager());
        act(() => { result.current.addFolder(null, 'My Servers'); });
        expect(result.current.tree.length).toBe(1);
        expect(result.current.tree[0].name).toBe('My Servers');
        expect(result.current.tree[0].type).toBe('folder');
    });

    it('returns the new folder id', () => {
        const { result } = renderHook(() => useHostManager());
        let folderId!: string;
        act(() => { folderId = result.current.addFolder(null, 'Test'); });
        expect(typeof folderId).toBe('string');
        expect(folderId.length).toBeGreaterThan(0);
    });

    it('adds a nested folder inside an existing folder', () => {
        const { result } = renderHook(() => useHostManager());
        let parentId!: string;
        act(() => { parentId = result.current.addFolder(null, 'Parent'); });
        act(() => { result.current.addFolder(parentId, 'Child'); });

        const parent = result.current.tree.find(n => n.id === parentId);
        expect(parent?.children?.length).toBe(1);
        expect(parent?.children?.[0].name).toBe('Child');
    });

    it('persists the folder to localStorage', async () => {
        const { result } = renderHook(() => useHostManager());
        act(() => { result.current.addFolder(null, 'Persisted'); });
        // encryptTree().then(saveRawTree) is async, wait for it to settle
        await waitFor(() => {
            const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.HOST_TREE) ?? '[]');
            expect(stored[0]?.name).toBe('Persisted');
        });
    });
});

describe('useHostManager — addHost', () => {
    it('adds a host to the root', () => {
        const { result } = renderHook(() => useHostManager());
        act(() => {
            result.current.addHost(null, 'My Host', {
                protocol: 'ssh', host: '192.168.1.1', port: 22
            });
        });
        expect(result.current.tree.length).toBe(1);
        expect(result.current.tree[0].type).toBe('host');
        expect(result.current.tree[0].name).toBe('My Host');
        expect(result.current.tree[0].entry?.host).toBe('192.168.1.1');
    });

    it('returns the new host id', () => {
        const { result } = renderHook(() => useHostManager());
        let hostId!: string;
        act(() => {
            hostId = result.current.addHost(null, 'H', { protocol: 'ssh', host: 'h', port: 22 });
        });
        expect(typeof hostId).toBe('string');
    });

    it('adds a host inside a folder', () => {
        const { result } = renderHook(() => useHostManager());
        let folderId!: string;
        act(() => { folderId = result.current.addFolder(null, 'Folder'); });
        act(() => {
            result.current.addHost(folderId, 'SSH Host', { protocol: 'ssh', host: '10.0.0.1', port: 22 });
        });
        const folder = result.current.tree.find(n => n.id === folderId);
        expect(folder?.children?.length).toBe(1);
        expect(folder?.children?.[0].entry?.host).toBe('10.0.0.1');
    });
});

describe('useHostManager — deleteNode', () => {
    it('removes a root-level node', () => {
        const { result } = renderHook(() => useHostManager());
        let folderId!: string;
        act(() => { folderId = result.current.addFolder(null, 'ToDelete'); });
        expect(result.current.tree.length).toBe(1);

        act(() => { result.current.deleteNode(folderId); });
        expect(result.current.tree.length).toBe(0);
    });

    it('removes a nested host', () => {
        const { result } = renderHook(() => useHostManager());
        let folderId!: string;
        let hostId!: string;
        act(() => { folderId = result.current.addFolder(null, 'Folder'); });
        act(() => {
            hostId = result.current.addHost(folderId, 'Host', { protocol: 'ssh', host: 'h', port: 22 });
        });
        act(() => { result.current.deleteNode(hostId); });

        const folder = result.current.tree.find(n => n.id === folderId);
        expect(folder?.children?.length).toBe(0);
    });
});

describe('useHostManager — editNode', () => {
    it('renames a folder', () => {
        const { result } = renderHook(() => useHostManager());
        let folderId!: string;
        act(() => { folderId = result.current.addFolder(null, 'OldName'); });
        act(() => { result.current.editNode(folderId, { name: 'NewName' }); });

        const folder = result.current.tree.find(n => n.id === folderId);
        expect(folder?.name).toBe('NewName');
    });

    it('updates a host entry', () => {
        const { result } = renderHook(() => useHostManager());
        let hostId!: string;
        act(() => {
            hostId = result.current.addHost(null, 'Host', { protocol: 'ssh', host: 'old', port: 22 });
        });
        act(() => {
            result.current.editNode(hostId, { entry: { protocol: 'ssh', host: 'new', port: 22 } });
        });

        const host = result.current.tree.find(n => n.id === hostId);
        expect(host?.entry?.host).toBe('new');
    });
});

describe('useHostManager — moveNode', () => {
    it('moves a node before another', () => {
        const { result } = renderHook(() => useHostManager());
        let idA!: string;
        let idB!: string;
        act(() => { idA = result.current.addFolder(null, 'A'); });
        act(() => { idB = result.current.addFolder(null, 'B'); });

        act(() => { result.current.moveNode(idB, idA, 'before'); });

        expect(result.current.tree[0].id).toBe(idB);
        expect(result.current.tree[1].id).toBe(idA);
    });

    it('moves a node after another', () => {
        const { result } = renderHook(() => useHostManager());
        let idA!: string;
        let idB!: string;
        act(() => { idA = result.current.addFolder(null, 'A'); });
        act(() => { idB = result.current.addFolder(null, 'B'); });

        act(() => { result.current.moveNode(idA, idB, 'after'); });

        expect(result.current.tree[0].id).toBe(idB);
        expect(result.current.tree[1].id).toBe(idA);
    });

    it('moves a node inside a folder', () => {
        const { result } = renderHook(() => useHostManager());
        let hostId!: string;
        let folderId!: string;
        act(() => {
            hostId = result.current.addHost(null, 'Host', { protocol: 'ssh', host: 'h', port: 22 });
        });
        act(() => { folderId = result.current.addFolder(null, 'Folder'); });

        act(() => { result.current.moveNode(hostId, folderId, 'inside'); });

        const folder = result.current.tree.find(n => n.id === folderId);
        expect(folder?.children?.some(c => c.id === hostId)).toBe(true);
        expect(result.current.tree.some(n => n.id === hostId)).toBe(false);
    });

    it('does not move a node into itself', () => {
        const { result } = renderHook(() => useHostManager());
        let folderId!: string;
        act(() => { folderId = result.current.addFolder(null, 'Folder'); });
        const treeBefore = [...result.current.tree];

        act(() => { result.current.moveNode(folderId, folderId, 'inside'); });

        expect(result.current.tree).toEqual(treeBefore);
    });
});

describe('useHostManager — sortFolder', () => {
    it('sorts root-level nodes (folders before hosts, then alphabetically)', () => {
        const { result } = renderHook(() => useHostManager());
        act(() => {
            result.current.addHost(null, 'Z Host', { protocol: 'ssh', host: 'z', port: 22 });
            result.current.addFolder(null, 'B Folder');
            result.current.addHost(null, 'A Host', { protocol: 'ssh', host: 'a', port: 22 });
            result.current.addFolder(null, 'A Folder');
        });

        act(() => { result.current.sortFolder(null); });

        const types = result.current.tree.map(n => n.type);
        const names = result.current.tree.map(n => n.name);
        // Folders first
        expect(types[0]).toBe('folder');
        expect(types[1]).toBe('folder');
        // Alphabetical within type
        expect(names[0]).toBe('A Folder');
        expect(names[1]).toBe('B Folder');
        expect(names[2]).toBe('A Host');
        expect(names[3]).toBe('Z Host');
    });
});

// ── flattenHosts tests ──

describe('flattenHosts', () => {
    it('returns empty array for empty tree', () => {
        expect(flattenHosts([])).toEqual([]);
    });

    it('returns only host nodes from a flat tree', () => {
        const tree: HostTreeNode[] = [
            { id: 'f1', type: 'folder', name: 'Folder', children: [] },
            { id: 'h1', type: 'host', name: 'Host1', entry: { protocol: 'ssh', host: '10.0.0.1', port: 22 } },
        ];
        const hosts = flattenHosts(tree);
        expect(hosts.length).toBe(1);
        expect(hosts[0].id).toBe('h1');
    });

    it('flattens nested hosts', () => {
        const tree: HostTreeNode[] = [
            {
                id: 'f1', type: 'folder', name: 'Folder', children: [
                    { id: 'h1', type: 'host', name: 'Host1', entry: { protocol: 'ssh', host: '10.0.0.1', port: 22 } },
                    {
                        id: 'f2', type: 'folder', name: 'SubFolder', children: [
                            { id: 'h2', type: 'host', name: 'Host2', entry: { protocol: 'telnet', host: '10.0.0.2', port: 23 } },
                        ]
                    },
                ]
            },
            { id: 'h3', type: 'host', name: 'Host3', entry: { protocol: 'ssh', host: '10.0.0.3', port: 22 } },
        ];
        const hosts = flattenHosts(tree);
        expect(hosts.length).toBe(3);
        expect(hosts.map(h => h.id).sort()).toEqual(['h1', 'h2', 'h3']);
    });
});

// ── getJumpboxReferences tests ──

describe('getJumpboxReferences', () => {
    it('returns empty array when no hosts reference the jumpbox', () => {
        const tree: HostTreeNode[] = [
            { id: 'jb1', type: 'host', name: 'Jumpbox', entry: { protocol: 'ssh', host: '10.0.0.1', port: 22, isJumpbox: true } },
            { id: 'h1', type: 'host', name: 'Host1', entry: { protocol: 'ssh', host: '10.0.0.2', port: 22 } },
        ];
        expect(getJumpboxReferences(tree, 'jb1')).toEqual([]);
    });

    it('returns hosts that reference the jumpbox', () => {
        const tree: HostTreeNode[] = [
            { id: 'jb1', type: 'host', name: 'Jumpbox', entry: { protocol: 'ssh', host: '10.0.0.1', port: 22, isJumpbox: true } },
            { id: 'h1', type: 'host', name: 'Host1', entry: { protocol: 'ssh', host: '10.0.0.2', port: 22, jumpboxId: 'jb1' } },
            { id: 'h2', type: 'host', name: 'Host2', entry: { protocol: 'telnet', host: '10.0.0.3', port: 23, jumpboxId: 'jb1' } },
            { id: 'h3', type: 'host', name: 'Host3', entry: { protocol: 'ssh', host: '10.0.0.4', port: 22 } },
        ];
        const refs = getJumpboxReferences(tree, 'jb1');
        expect(refs.length).toBe(2);
        expect(refs.map(r => r.id).sort()).toEqual(['h1', 'h2']);
    });

    it('finds references in nested tree', () => {
        const tree: HostTreeNode[] = [
            {
                id: 'f1', type: 'folder', name: 'Folder', children: [
                    { id: 'h1', type: 'host', name: 'Host1', entry: { protocol: 'ssh', host: '10.0.0.2', port: 22, jumpboxId: 'jb1' } },
                ]
            },
        ];
        const refs = getJumpboxReferences(tree, 'jb1');
        expect(refs.length).toBe(1);
        expect(refs[0].id).toBe('h1');
    });
});

// ── isJumpbox in addHost/editNode tests ──

describe('useHostManager — jumpbox fields', () => {
    it('addHost preserves isJumpbox field', () => {
        const { result } = renderHook(() => useHostManager());
        act(() => {
            result.current.addHost(null, 'Jumpbox', {
                protocol: 'ssh', host: '10.0.0.1', port: 22, isJumpbox: true,
            });
        });
        expect(result.current.tree[0].entry?.isJumpbox).toBe(true);
    });

    it('editNode can set jumpboxId', () => {
        const { result } = renderHook(() => useHostManager());
        let hostId!: string;
        act(() => {
            hostId = result.current.addHost(null, 'Host', {
                protocol: 'ssh', host: '10.0.0.2', port: 22,
            });
        });
        act(() => {
            result.current.editNode(hostId, {
                entry: { protocol: 'ssh', host: '10.0.0.2', port: 22, jumpboxId: 'jb-id' }
            });
        });
        expect(result.current.tree[0].entry?.jumpboxId).toBe('jb-id');
    });
});

// ── importData jumpbox remapping tests ──

describe('useHostManager — importData jumpbox remapping', () => {
    it('remaps jumpboxId references to new IDs after import', async () => {
        const { result } = renderHook(() => useHostManager());
        const importNodes: HostTreeNode[] = [
            { id: 'old-jb', type: 'host', name: 'Jumpbox', entry: { protocol: 'ssh', host: '10.0.0.1', port: 22, isJumpbox: true } },
            { id: 'old-h1', type: 'host', name: 'Host1', entry: { protocol: 'ssh', host: '10.0.0.2', port: 22, jumpboxId: 'old-jb' } },
        ];

        await act(async () => {
            await result.current.importData(importNodes, 'TestImport');
        });

        const folder = result.current.tree[0];
        expect(folder.type).toBe('folder');
        const children = folder.children!;
        expect(children.length).toBe(2);

        const jumpbox = children.find(n => n.name === 'Jumpbox')!;
        const host = children.find(n => n.name === 'Host1')!;

        // IDs should be reassigned (not the old ones)
        expect(jumpbox.id).not.toBe('old-jb');
        expect(host.id).not.toBe('old-h1');

        // jumpboxId should point to the new jumpbox ID
        expect(host.entry?.jumpboxId).toBe(jumpbox.id);
        expect(jumpbox.entry?.isJumpbox).toBe(true);
    });

    it('clears jumpboxId when referenced jumpbox is not in the import', async () => {
        const { result } = renderHook(() => useHostManager());
        const importNodes: HostTreeNode[] = [
            { id: 'old-h1', type: 'host', name: 'Host1', entry: { protocol: 'ssh', host: '10.0.0.2', port: 22, jumpboxId: 'non-existent-jb' } },
        ];

        await act(async () => {
            await result.current.importData(importNodes, 'TestImport');
        });

        const folder = result.current.tree[0];
        const host = folder.children![0];

        // jumpboxId should be cleared since the referenced jumpbox doesn't exist
        expect(host.entry?.jumpboxId).toBeUndefined();
    });

    it('remaps jumpboxId in nested folder structures', async () => {
        const { result } = renderHook(() => useHostManager());
        const importNodes: HostTreeNode[] = [
            { id: 'old-jb', type: 'host', name: 'Jumpbox', entry: { protocol: 'ssh', host: '10.0.0.1', port: 22, isJumpbox: true } },
            {
                id: 'old-folder', type: 'folder', name: 'SubFolder', children: [
                    { id: 'old-h1', type: 'host', name: 'NestedHost', entry: { protocol: 'ssh', host: '10.0.0.2', port: 22, jumpboxId: 'old-jb' } },
                ]
            },
        ];

        await act(async () => {
            await result.current.importData(importNodes, 'TestImport');
        });

        const folder = result.current.tree[0];
        const jumpbox = folder.children!.find(n => n.name === 'Jumpbox')!;
        const subFolder = folder.children!.find(n => n.name === 'SubFolder')!;
        const nestedHost = subFolder.children![0];

        expect(nestedHost.entry?.jumpboxId).toBe(jumpbox.id);
    });
});
