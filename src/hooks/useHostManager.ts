import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'hterm_host_tree';

export interface HostEntry {
    protocol: 'ssh' | 'telnet';
    host: string;
    port: number;
    username?: string;
    password?: string;
}

export interface HostTreeNode {
    id: string;
    type: 'folder' | 'host';
    name: string;
    // Only when type === 'host'
    entry?: HostEntry;
    children?: HostTreeNode[];
}

function generateId(): string {
    return self.crypto.randomUUID();
}

// ── DPAPI helpers ──

/**
 * Encrypts a credential string via the main process (Windows DPAPI).
 * Returns the original value if electronAPI is unavailable.
 */
async function encrypt(value: string | undefined): Promise<string | undefined> {
    if (!value) return value;
    try {
        return await window.electronAPI.encryptSecret(value);
    } catch (err) {
        console.error('[HostManager] Failed to encrypt credential:', err);
        return value; // fallback: store as-is
    }
}

/**
 * Decrypts a credential string via the main process (Windows DPAPI).
 * Returns the original value if not encrypted or if electronAPI is unavailable.
 */
async function decrypt(value: string | undefined): Promise<string | undefined> {
    if (!value) return value;
    try {
        return await window.electronAPI.decryptSecret(value);
    } catch (err) {
        console.error('[HostManager] Failed to decrypt credential:', err);
        return value; // fallback: return as-is
    }
}

// ── Serialization / Deserialization ──

/**
 * Encrypts sensitive fields of a HostEntry before persisting.
 */
async function encryptEntry(entry: HostEntry): Promise<HostEntry> {
    return {
        ...entry,
        username: await encrypt(entry.username),
        password: await encrypt(entry.password),
    };
}

/**
 * Decrypts sensitive fields of a HostEntry after loading from storage.
 */
async function decryptEntry(entry: HostEntry): Promise<HostEntry> {
    return {
        ...entry,
        username: await decrypt(entry.username),
        password: await decrypt(entry.password),
    };
}

/**
 * Recursively encrypts all HostEntry nodes in a tree before persisting.
 */
async function encryptTree(nodes: HostTreeNode[]): Promise<HostTreeNode[]> {
    return Promise.all(
        nodes.map(async (n) => {
            const children = n.children ? await encryptTree(n.children) : undefined;
            if (n.type === 'host' && n.entry) {
                return { ...n, entry: await encryptEntry(n.entry), children };
            }
            return { ...n, children };
        })
    );
}

/**
 * Recursively decrypts all HostEntry nodes in a tree after loading.
 */
async function decryptTree(nodes: HostTreeNode[]): Promise<HostTreeNode[]> {
    return Promise.all(
        nodes.map(async (n) => {
            const children = n.children ? await decryptTree(n.children) : undefined;
            if (n.type === 'host' && n.entry) {
                return { ...n, entry: await decryptEntry(n.entry), children };
            }
            return { ...n, children };
        })
    );
}

// ── Raw storage (stores encrypted values) ──

function loadRawTree(): HostTreeNode[] {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        return saved ? JSON.parse(saved) : [];
    } catch {
        return [];
    }
}

function saveRawTree(tree: HostTreeNode[]) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tree));
}

// ── Tree manipulation helpers (pure functions) ──

function insertNode(nodes: HostTreeNode[], parentId: string | null, newNode: HostTreeNode): HostTreeNode[] {
    if (parentId === null) {
        return [...nodes, newNode];
    }
    return nodes.map(n => {
        if (n.id === parentId && n.type === 'folder') {
            return { ...n, children: [...(n.children ?? []), newNode] };
        }
        if (n.children) {
            return { ...n, children: insertNode(n.children, parentId, newNode) };
        }
        return n;
    });
}

function patchNode(nodes: HostTreeNode[], id: string, patch: Partial<HostTreeNode>): HostTreeNode[] {
    return nodes.map(n => {
        if (n.id === id) return { ...n, ...patch };
        if (n.children) return { ...n, children: patchNode(n.children, id, patch) };
        return n;
    });
}

function removeNode(nodes: HostTreeNode[], id: string): HostTreeNode[] {
    return nodes
        .filter(n => n.id !== id)
        .map(n => n.children ? { ...n, children: removeNode(n.children, id) } : n);
}

// ── Hook ──

export function useHostManager() {
    // State holds decrypted tree (safe to use in UI / SSH connection)
    const [tree, setTree] = useState<HostTreeNode[]>([]);
    // Ref keeps the encrypted tree synced with localStorage
    const [initialized, setInitialized] = useState(false);

    // On mount: load raw (encrypted) tree from localStorage, then decrypt into state
    useEffect(() => {
        const raw = loadRawTree();
        if (raw.length === 0) {
            setInitialized(true);
            return;
        }
        decryptTree(raw).then((decrypted) => {
            setTree(decrypted);
            setInitialized(true);
        });
    }, []);

    /**
     * Encrypts the given tree and persists to localStorage.
     * Updates the in-memory state with the decrypted version.
     */
    const persistAndSet = useCallback(async (decryptedTree: HostTreeNode[]) => {
        const encrypted = await encryptTree(decryptedTree);
        saveRawTree(encrypted);
        setTree(decryptedTree);
    }, []);

    const addFolder = useCallback((parentId: string | null, name: string) => {
        const node: HostTreeNode = {
            id: generateId(),
            type: 'folder',
            name,
            children: [],
        };
        setTree(prev => {
            const next = insertNode(prev, parentId, node);
            encryptTree(next).then(saveRawTree);
            return next;
        });
        return node.id;
    }, []);

    const addHost = useCallback((parentId: string | null, name: string, entry: HostEntry) => {
        const node: HostTreeNode = {
            id: generateId(),
            type: 'host',
            name,
            entry, // decrypted in state
        };
        setTree(prev => {
            const next = insertNode(prev, parentId, node);
            encryptTree(next).then(saveRawTree);
            return next;
        });
        return node.id;
    }, []);

    const editNode = useCallback((id: string, patch: Partial<HostTreeNode>) => {
        setTree(prev => {
            const next = patchNode(prev, id, patch);
            encryptTree(next).then(saveRawTree);
            return next;
        });
    }, []);

    const deleteNode = useCallback((id: string) => {
        setTree(prev => {
            const next = removeNode(prev, id);
            encryptTree(next).then(saveRawTree);
            return next;
        });
    }, []);

    const saveTree = useCallback((newTree: HostTreeNode[]) => {
        persistAndSet(newTree);
    }, [persistAndSet]);

    return { tree, initialized, addFolder, addHost, editNode, deleteNode, saveTree };
}
