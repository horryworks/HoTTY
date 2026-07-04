import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { flattenHosts, getJumpboxReferences, getCachedCredential, useHostManager } from './useHostManager';
import { tauriService } from '../services/tauriService';
import type { HostTreeNode } from '../types/appTypes';

// Mock tauriService to prevent actual Tauri calls
vi.mock('../services/tauriService', () => ({
  tauriService: {
    dpapiEncryptBatch: vi.fn(async (values: string[]) => values.map(v => `[SAFE]${v}`)),
    dpapiDecryptBatch: vi.fn(async (values: string[]) => values.map(v => v.replace(/^\[SAFE\]/, ''))),
    migrateHostTreeCredentials: vi.fn(async (treeJson: string) => treeJson),
    logDebug: vi.fn(async () => undefined),
  },
  isEncrypted: (value: string) => value.startsWith('[DPAPI]') || value.startsWith('[SAFE]'),
}));

const sampleTree: HostTreeNode[] = [
  {
    id: 'folder-1',
    type: 'folder',
    name: 'Servers',
    children: [
      {
        id: 'host-1',
        type: 'host',
        name: 'Web Server',
        entry: { protocol: 'ssh', host: '10.0.0.1', port: 22 },
      },
      {
        id: 'host-2',
        type: 'host',
        name: 'DB Server',
        entry: { protocol: 'ssh', host: '10.0.0.2', port: 22, isJumpbox: true },
      },
    ],
  },
  {
    id: 'host-3',
    type: 'host',
    name: 'Router',
    entry: { protocol: 'telnet', host: '192.168.1.1', port: 23, jumpboxId: 'host-2' },
  },
];

describe('flattenHosts', () => {
  it('returns all host nodes from a nested tree', () => {
    const hosts = flattenHosts(sampleTree);
    expect(hosts).toHaveLength(3);
    expect(hosts.map(h => h.id)).toEqual(['host-1', 'host-2', 'host-3']);
  });

  it('returns empty array for empty tree', () => {
    expect(flattenHosts([])).toEqual([]);
  });

  it('skips folder nodes', () => {
    const hosts = flattenHosts(sampleTree);
    expect(hosts.every(h => h.type === 'host')).toBe(true);
  });
});

describe('getJumpboxReferences', () => {
  it('returns hosts that reference a given jumpbox', () => {
    const refs = getJumpboxReferences(sampleTree, 'host-2');
    expect(refs).toHaveLength(1);
    expect(refs[0].id).toBe('host-3');
  });

  it('returns empty when no references found', () => {
    const refs = getJumpboxReferences(sampleTree, 'nonexistent');
    expect(refs).toHaveLength(0);
  });
});

describe('useHostManager', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(tauriService.migrateHostTreeCredentials).mockReset();
    vi.mocked(tauriService.migrateHostTreeCredentials).mockImplementation(async (j: string) => j);
  });

  it('starts with empty tree when no localStorage data', () => {
    const { result } = renderHook(() => useHostManager());
    expect(result.current.tree).toEqual([]);
  });

  it('loads tree from localStorage on mount', () => {
    localStorage.setItem('hotty_host_tree', JSON.stringify(sampleTree));
    const { result } = renderHook(() => useHostManager());
    expect(result.current.tree).toHaveLength(2);
    expect(result.current.tree[0].name).toBe('Servers');
  });

  it('addFolder adds a folder to root', () => {
    const { result } = renderHook(() => useHostManager());
    act(() => {
      result.current.addFolder(null, 'New Folder');
    });
    expect(result.current.tree).toHaveLength(1);
    expect(result.current.tree[0].type).toBe('folder');
    expect(result.current.tree[0].name).toBe('New Folder');
  });

  it('addHost adds a host to root', () => {
    const { result } = renderHook(() => useHostManager());
    act(() => {
      result.current.addHost(null, 'My Server', { protocol: 'ssh', host: '1.2.3.4', port: 22 });
    });
    expect(result.current.tree).toHaveLength(1);
    expect(result.current.tree[0].type).toBe('host');
    expect(result.current.tree[0].name).toBe('My Server');
    expect(result.current.tree[0].entry?.host).toBe('1.2.3.4');
  });

  it('addHost in one instance is reflected in a separate concurrent instance', () => {
    // Regression: SessionDialog and SaveToHostTreeDialog each call useHostManager
    // separately. Mutations in one must be visible in the other immediately,
    // not just after a full app restart.
    const a = renderHook(() => useHostManager());
    const b = renderHook(() => useHostManager());

    expect(a.result.current.tree).toHaveLength(0);
    expect(b.result.current.tree).toHaveLength(0);

    act(() => {
      b.result.current.addHost(null, 'From B', { protocol: 'ssh', host: '10.0.0.9', port: 22 });
    });

    expect(b.result.current.tree).toHaveLength(1);
    expect(a.result.current.tree).toHaveLength(1);
    expect(a.result.current.tree[0].name).toBe('From B');
    expect(a.result.current.tree[0].entry?.host).toBe('10.0.0.9');
  });

  it('addFolder adds to a parent folder', () => {
    const { result } = renderHook(() => useHostManager());
    let parentId: string;
    act(() => {
      parentId = result.current.addFolder(null, 'Parent');
    });
    act(() => {
      result.current.addFolder(parentId!, 'Child');
    });
    expect(result.current.tree[0].children).toHaveLength(1);
    expect(result.current.tree[0].children![0].name).toBe('Child');
  });

  it('editNode updates a node name', () => {
    localStorage.setItem('hotty_host_tree', JSON.stringify(sampleTree));
    const { result } = renderHook(() => useHostManager());
    act(() => {
      result.current.editNode('host-1', { name: 'Renamed Server' });
    });
    const hosts = flattenHosts(result.current.tree);
    const renamed = hosts.find(h => h.id === 'host-1');
    expect(renamed?.name).toBe('Renamed Server');
  });

  it('editNode caches an edited plaintext passphrase', () => {
    localStorage.setItem('hotty_host_tree', JSON.stringify(sampleTree));
    const { result } = renderHook(() => useHostManager());
    act(() => {
      result.current.editNode('host-1', {
        entry: { protocol: 'ssh', host: '10.0.0.1', port: 22, privateKeyPassphrase: 'secret-pass' },
      });
    });
    // Regression guard: editNode previously cached username/password but not the
    // passphrase, so a freshly-edited passphrase could be served stale.
    expect(getCachedCredential('host-1')?.privateKeyPassphrase).toBe('secret-pass');
  });

  it('deleteNode removes a node', () => {
    localStorage.setItem('hotty_host_tree', JSON.stringify(sampleTree));
    const { result } = renderHook(() => useHostManager());
    act(() => {
      result.current.deleteNode('host-3');
    });
    expect(result.current.tree).toHaveLength(1); // only the folder remains at root
    expect(flattenHosts(result.current.tree)).toHaveLength(2);
  });

  it('moveNode moves a node before another', () => {
    localStorage.setItem('hotty_host_tree', JSON.stringify(sampleTree));
    const { result } = renderHook(() => useHostManager());
    // Move host-3 before folder-1
    act(() => {
      result.current.moveNode('host-3', 'folder-1', 'before');
    });
    expect(result.current.tree[0].id).toBe('host-3');
    expect(result.current.tree[1].id).toBe('folder-1');
  });

  it('moveNode moves a node inside a folder', () => {
    localStorage.setItem('hotty_host_tree', JSON.stringify(sampleTree));
    const { result } = renderHook(() => useHostManager());
    act(() => {
      result.current.moveNode('host-3', 'folder-1', 'inside');
    });
    expect(result.current.tree).toHaveLength(1); // host-3 moved inside folder-1
    expect(result.current.tree[0].children).toHaveLength(3);
  });

  it('moveNode prevents circular move (descendant into ancestor)', () => {
    localStorage.setItem('hotty_host_tree', JSON.stringify(sampleTree));
    const { result } = renderHook(() => useHostManager());
    // Try to move folder-1 inside host-1 (which is its child) — should be no-op
    act(() => {
      result.current.moveNode('folder-1', 'host-1', 'inside');
    });
    // Tree should remain unchanged
    expect(result.current.tree[0].id).toBe('folder-1');
  });

  it('calls migrateHostTreeCredentials on mount with the loaded tree JSON', async () => {
    localStorage.setItem('hotty_host_tree', JSON.stringify(sampleTree));
    renderHook(() => useHostManager());
    await waitFor(() => {
      expect(tauriService.migrateHostTreeCredentials).toHaveBeenCalledTimes(1);
    });
    const arg = vi.mocked(tauriService.migrateHostTreeCredentials).mock.calls[0][0];
    expect(JSON.parse(arg)).toEqual(sampleTree);
  });

  it('persists the migrated tree to localStorage when migration changed the JSON', async () => {
    const v1Tree: HostTreeNode[] = [
      {
        id: 'h1',
        type: 'host',
        name: 'Old',
        entry: { protocol: 'ssh', host: 'h', port: 22, username: '[SAFE]v1blob' },
      },
    ];
    const migratedTree: HostTreeNode[] = [
      {
        id: 'h1',
        type: 'host',
        name: 'Old',
        entry: { protocol: 'ssh', host: 'h', port: 22, username: '[SAFE]v2blob' },
      },
    ];
    localStorage.setItem('hotty_host_tree', JSON.stringify(v1Tree));
    vi.mocked(tauriService.migrateHostTreeCredentials).mockResolvedValueOnce(
      JSON.stringify(migratedTree)
    );

    const { result } = renderHook(() => useHostManager());
    await waitFor(() => {
      expect(localStorage.getItem('hotty_host_tree')).toBe(JSON.stringify(migratedTree));
    });
    expect(result.current.tree[0].entry?.username).toBe('[SAFE]v2blob');
  });

  it('does not rewrite localStorage when migration returns identical JSON', async () => {
    const original = JSON.stringify(sampleTree);
    localStorage.setItem('hotty_host_tree', original);
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    renderHook(() => useHostManager());
    await waitFor(() => {
      expect(tauriService.migrateHostTreeCredentials).toHaveBeenCalled();
    });
    // No setItem call for the host tree key after the initial load.
    expect(
      setItemSpy.mock.calls.some(([k, v]) => k === 'hotty_host_tree' && v !== original)
    ).toBe(false);
    setItemSpy.mockRestore();
  });

  it('falls back to the raw tree when migration throws', async () => {
    localStorage.setItem('hotty_host_tree', JSON.stringify(sampleTree));
    vi.mocked(tauriService.migrateHostTreeCredentials).mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useHostManager());
    await waitFor(() => {
      expect(result.current.tree).toHaveLength(2);
    });
    expect(result.current.tree[0].name).toBe('Servers');
  });

  it('migrates legacy SSH+iapTunnel entries to gcloud-iap protocol on load', async () => {
    const legacyTree: HostTreeNode[] = [
      {
        id: 'iap-1',
        type: 'host',
        name: 'My IAP host',
        entry: {
          protocol: 'ssh',
          host: 'instance-name',
          port: 22,
          username: 'someone',
          password: '[SAFE]ignored',
          jumpboxId: 'should-be-cleared',
          iapTunnel: { project: 'my-project', zone: 'us-central1-a', instance: 'instance-name' },
        },
      },
    ];
    localStorage.setItem('hotty_host_tree', JSON.stringify(legacyTree));

    const { result } = renderHook(() => useHostManager());
    await waitFor(() => {
      expect(result.current.tree[0].entry?.protocol).toBe('gcloud-iap');
    });
    const entry = result.current.tree[0].entry!;
    expect(entry.username).toBeUndefined();
    expect(entry.password).toBeUndefined();
    expect(entry.jumpboxId).toBeUndefined();
    expect(entry.iapTunnel?.instance).toBe('instance-name');

    // Persisted to localStorage so the next load is idempotent.
    const persisted: HostTreeNode[] = JSON.parse(localStorage.getItem('hotty_host_tree') || '[]');
    expect(persisted[0].entry?.protocol).toBe('gcloud-iap');
  });

  it('leaves regular SSH/Telnet entries untouched by the IAP migration', async () => {
    localStorage.setItem('hotty_host_tree', JSON.stringify(sampleTree));
    const { result } = renderHook(() => useHostManager());
    await waitFor(() => {
      expect(result.current.tree).toHaveLength(2);
    });
    const hosts = flattenHosts(result.current.tree);
    for (const h of hosts) {
      expect(h.entry?.protocol).not.toBe('gcloud-iap');
    }
  });

  it('migrates IAP entries nested inside folders', async () => {
    const nested: HostTreeNode[] = [
      {
        id: 'f1',
        type: 'folder',
        name: 'GCP',
        children: [
          {
            id: 'h-nested',
            type: 'host',
            name: 'nested IAP',
            entry: {
              protocol: 'ssh',
              host: 'vm-01',
              port: 22,
              iapTunnel: { project: 'p', zone: 'us-central1-a', instance: 'vm-01' },
            },
          },
        ],
      },
    ];
    localStorage.setItem('hotty_host_tree', JSON.stringify(nested));
    const { result } = renderHook(() => useHostManager());
    await waitFor(() => {
      expect(result.current.tree[0].children?.[0].entry?.protocol).toBe('gcloud-iap');
    });
  });

  it('sortFolder sorts children alphabetically (folders first)', () => {
    const unsorted: HostTreeNode[] = [
      {
        id: 'f1',
        type: 'folder',
        name: 'Root',
        children: [
          { id: 'h1', type: 'host', name: 'Zulu', entry: { protocol: 'ssh', host: '1.1.1.1', port: 22 } },
          { id: 'f2', type: 'folder', name: 'Beta', children: [] },
          { id: 'h2', type: 'host', name: 'Alpha', entry: { protocol: 'ssh', host: '2.2.2.2', port: 22 } },
          { id: 'f3', type: 'folder', name: 'Alpha', children: [] },
        ],
      },
    ];
    localStorage.setItem('hotty_host_tree', JSON.stringify(unsorted));
    const { result } = renderHook(() => useHostManager());
    act(() => {
      result.current.sortFolder('f1');
    });
    const names = result.current.tree[0].children!.map(c => c.name);
    // folders first (alphabetical), then hosts (alphabetical)
    expect(names).toEqual(['Alpha', 'Beta', 'Alpha', 'Zulu']);
  });

  it('sortFolder desc sorts children in reverse name order (folders still first)', () => {
    const unsorted: HostTreeNode[] = [
      {
        id: 'f1',
        type: 'folder',
        name: 'Root',
        children: [
          { id: 'h1', type: 'host', name: 'Alpha', entry: { protocol: 'ssh', host: '1.1.1.1', port: 22 } },
          { id: 'f2', type: 'folder', name: 'Alpha', children: [] },
          { id: 'h2', type: 'host', name: 'Zulu', entry: { protocol: 'ssh', host: '2.2.2.2', port: 22 } },
          { id: 'f3', type: 'folder', name: 'Beta', children: [] },
        ],
      },
    ];
    localStorage.setItem('hotty_host_tree', JSON.stringify(unsorted));
    const { result } = renderHook(() => useHostManager());
    act(() => {
      result.current.sortFolder('f1', 'desc');
    });
    const names = result.current.tree[0].children!.map(c => c.name);
    // folders first (reverse alphabetical), then hosts (reverse alphabetical)
    expect(names).toEqual(['Beta', 'Alpha', 'Zulu', 'Alpha']);
  });
});
