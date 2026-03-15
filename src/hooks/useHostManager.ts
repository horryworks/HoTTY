import { useState, useCallback, useEffect } from 'react';
import { STORAGE_KEYS } from '../constants/storage';
import * as electronService from '../services/electronService';

const STORAGE_KEY = STORAGE_KEYS.HOST_TREE;

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

// ── DPAPI batch helpers ──

/**
 * Encrypts an array of credential strings via the main process (Windows DPAPI).
 * Returns the original values if electronAPI is unavailable.
 */
async function encryptBatch(values: (string | undefined)[]): Promise<(string | undefined)[]> {
    if (values.length === 0) return values;
    try {
        return await electronService.encryptSecrets(values);
    } catch (err) {
        console.error('[HostManager] Failed to batch encrypt credentials:', err);
        return values; // fallback: return as-is
    }
}

/**
 * Decrypts an array of credential strings via the main process (Windows DPAPI).
 * Returns the original values if electronAPI is unavailable.
 */
export async function decryptBatch(values: (string | undefined)[]): Promise<(string | undefined)[]> {
    if (values.length === 0) return values;
    try {
        return await electronService.decryptSecrets(values);
    } catch (err) {
        console.error('[HostManager] Failed to batch decrypt credentials:', err);
        return values; // fallback: return as-is
    }
}

// ── Serialization / Deserialization ──

/**
 * Encrypts all HostEntry nodes in a tree before persisting (using a single batch call).
 */
async function encryptTree(nodes: HostTreeNode[]): Promise<HostTreeNode[]> {
    const secrets: (string | undefined)[] = [];
    const setters: ((val: string | undefined) => void)[] = [];

    function traverse(nodeList: HostTreeNode[]): HostTreeNode[] {
        return nodeList.map(n => {
            const children = n.children ? traverse(n.children) : undefined;
            if (n.type === 'host' && n.entry) {
                // clone the entry so we can mutate it after batch encryption
                const entry = { ...n.entry };

                if (entry.username && !entry.username.startsWith('[DPAPI]')) {
                    secrets.push(entry.username);
                    setters.push((val) => entry.username = val);
                }

                if (entry.password && !entry.password.startsWith('[DPAPI]')) {
                    secrets.push(entry.password);
                    setters.push((val) => entry.password = val);
                }

                return { ...n, entry, children };
            }
            return { ...n, children };
        });
    }

    const newTree = traverse(nodes);
    const encryptedSecrets = await encryptBatch(secrets);

    for (let i = 0; i < encryptedSecrets.length; i++) {
        setters[i](encryptedSecrets[i]);
    }

    return newTree;
}
// ── In-Memory Decryption Cache ──

type DecryptedCredentialInfo = { username?: string; password?: string; decrypted?: boolean };
const decryptedCache: Record<string, DecryptedCredentialInfo> = {};

export function getCachedCredential(id: string): DecryptedCredentialInfo | undefined {
    return decryptedCache[id];
}

export function setCachedCredential(id: string, info: DecryptedCredentialInfo) {
    if (!decryptedCache[id]) decryptedCache[id] = {};
    if (info.username !== undefined) decryptedCache[id].username = info.username;
    if (info.password !== undefined) decryptedCache[id].password = info.password;
    if (info.decrypted !== undefined) decryptedCache[id].decrypted = info.decrypted;
}

export function clearDecryptedCache() {
    for (const key in decryptedCache) {
        delete decryptedCache[key];
    }
}

// ── Serialization / Deserialization ──

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

function insertNodes(nodes: HostTreeNode[], parentId: string | null, newNodes: HostTreeNode[]): HostTreeNode[] {
    if (parentId === null) {
        return [...nodes, ...newNodes];
    }
    return nodes.map(n => {
        if (n.id === parentId && n.type === 'folder') {
            return { ...n, children: [...(n.children ?? []), ...newNodes] };
        }
        if (n.children) {
            return { ...n, children: insertNodes(n.children, parentId, newNodes) };
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

function sortNodes(nodes: HostTreeNode[]): HostTreeNode[] {
    return [...nodes].sort((a, b) => {
        // Folders first
        if (a.type !== b.type) {
            return a.type === 'folder' ? -1 : 1;
        }
        // Then alphabetical by name
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
}

// ── Hook ──

export function useHostManager() {
    // State holds the full tree (passwords remain encrypted until explicitly decrypted by UI)
    const [tree, setTree] = useState<HostTreeNode[]>([]);

    // On mount: load raw (encrypted) tree from localStorage and set it immediately for 0-latency UI render.
    useEffect(() => {
        const raw = loadRawTree();
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setTree(raw);

        // --- Eager Pre-Decryption ---
        // Fire off a background task to decrypt all [DPAPI] strings in the tree and load them into the cache
        const eagerDecryptTree = async (nodes: HostTreeNode[]) => {
            const secrets: (string | undefined)[] = [];
            const targets: { id: string, type: 'username' | 'password' }[] = [];

            function traverse(nodeList: HostTreeNode[]) {
                for (const n of nodeList) {
                    if (n.type === 'host' && n.entry && !decryptedCache[n.id]?.decrypted) {
                        if (n.entry.username?.startsWith('[DPAPI]')) {
                            secrets.push(n.entry.username);
                            targets.push({ id: n.id, type: 'username' });
                        }
                        if (n.entry.password?.startsWith('[DPAPI]')) {
                            secrets.push(n.entry.password);
                            targets.push({ id: n.id, type: 'password' });
                        }
                    }
                    if (n.children) {
                        traverse(n.children);
                    }
                }
            }

            traverse(nodes);

            if (secrets.length > 0) {
                const decrypted = await decryptBatch(secrets);
                // Populate cache
                for (let i = 0; i < targets.length; i++) {
                    const t = targets[i];
                    const val = decrypted[i];
                    if (val !== undefined) {
                        setCachedCredential(t.id, { [t.type]: val });
                    }
                }
            }

            // Mark all visited hosts as decrypted in cache so we don't try again
            function markDecrypted(nodeList: HostTreeNode[]) {
                for (const n of nodeList) {
                    if (n.type === 'host') {
                        setCachedCredential(n.id, { decrypted: true });
                    }
                    if (n.children) {
                        markDecrypted(n.children);
                    }
                }
            }
            markDecrypted(nodes);
        };

        // Run non-blocking
        eagerDecryptTree(raw).catch(err => {
            console.error('[HostManager] Background eager decryption failed:', err);
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

            // Need to track this id in cache if username/password changed to unencrypted string
            const patchedNode = next.flatMap(n => n.type === 'host' ? [n] : n.children ?? []).find(n => n.id === id);
            if (patchedNode?.type === 'host' && patchedNode.entry) {
                if (patch.entry?.username && !patch.entry.username.startsWith('[DPAPI]')) {
                    setCachedCredential(id, { username: patch.entry.username });
                }
                if (patch.entry?.password && !patch.entry.password.startsWith('[DPAPI]')) {
                    setCachedCredential(id, { password: patch.entry.password });
                }
            }

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

    const moveNode = useCallback((nodeId: string, targetId: string, position: 'before' | 'after' | 'inside') => {
        setTree(prev => {
            // Find the node to move
            const findNode = (nodes: HostTreeNode[]): HostTreeNode | null => {
                for (const n of nodes) {
                    if (n.id === nodeId) return n;
                    if (n.children) {
                        const found = findNode(n.children);
                        if (found) return found;
                    }
                }
                return null;
            };

            // Check if targetId is a descendant of nodeId (prevent circular move)
            const isDescendant = (parentNode: HostTreeNode, childId: string): boolean => {
                if (!parentNode.children) return false;
                for (const child of parentNode.children) {
                    if (child.id === childId) return true;
                    if (isDescendant(child, childId)) return true;
                }
                return false;
            };

            const movingNode = findNode(prev);
            if (!movingNode) return prev;
            if (nodeId === targetId) return prev;
            if (isDescendant(movingNode, targetId)) return prev;

            // Remove the node from its current position
            const treeWithoutNode = removeNode(prev, nodeId);

            // Insert at new position
            if (position === 'inside') {
                // Insert as last child of target folder
                const insertInside = (nodes: HostTreeNode[]): HostTreeNode[] => {
                    return nodes.map(n => {
                        if (n.id === targetId && n.type === 'folder') {
                            return { ...n, children: [...(n.children ?? []), movingNode] };
                        }
                        if (n.children) {
                            return { ...n, children: insertInside(n.children) };
                        }
                        return n;
                    });
                };
                const next = insertInside(treeWithoutNode);
                encryptTree(next).then(saveRawTree);
                return next;
            }

            // Insert before or after target
            const insertAtPosition = (nodes: HostTreeNode[]): HostTreeNode[] => {
                const result: HostTreeNode[] = [];
                for (const n of nodes) {
                    if (n.id === targetId) {
                        if (position === 'before') {
                            result.push(movingNode, n);
                        } else {
                            result.push(n, movingNode);
                        }
                    } else {
                        if (n.children) {
                            result.push({ ...n, children: insertAtPosition(n.children) });
                        } else {
                            result.push(n);
                        }
                    }
                }
                return result;
            };
            const next = insertAtPosition(treeWithoutNode);
            encryptTree(next).then(saveRawTree);
            return next;
        });
    }, []);

    const sortFolder = useCallback((folderId: string | null) => {
        setTree(prev => {
            if (folderId === null) {
                const next = sortNodes(prev);
                encryptTree(next).then(saveRawTree);
                return next;
            }

            const sortInTree = (nodes: HostTreeNode[]): HostTreeNode[] => {
                return nodes.map(n => {
                    if (n.id === folderId && n.type === 'folder') {
                        return { ...n, children: sortNodes(n.children ?? []) };
                    }
                    if (n.children) {
                        return { ...n, children: sortInTree(n.children) };
                    }
                    return n;
                });
            };

            const next = sortInTree(prev);
            encryptTree(next).then(saveRawTree);
            return next;
        });
    }, []);

    const importData = useCallback(async (nodes: HostTreeNode[], folderName: string = 'Imported', parentId: string | null = null): Promise<string> => {
        // Assign new IDs recursively to avoid collisions
        const reassignIds = (nodeList: HostTreeNode[]): HostTreeNode[] => {
            return nodeList.map(n => ({
                ...n,
                id: generateId(),
                children: n.children ? reassignIds(n.children) : undefined
            }));
        };

        const importedNodes = reassignIds(nodes);
        const targetFolderId = parentId || generateId();

        setTree(prev => {
            let next: HostTreeNode[];
            if (parentId) {
                // If parentId is specified, insert nodes directly into that folder
                next = insertNodes(prev, parentId, importedNodes);
            } else {
                // Otherwise create a wrapper folder at the root with the generated ID
                const importedFolder: HostTreeNode = {
                    id: targetFolderId,
                    type: 'folder',
                    name: folderName,
                    children: importedNodes
                };
                next = [...prev, importedFolder];
            }
            encryptTree(next).then(saveRawTree);
            return next;
        });

        return targetFolderId;
    }, []);

    return { tree, addFolder, addHost, editNode, deleteNode, saveTree, moveNode, sortFolder, importData };
}
