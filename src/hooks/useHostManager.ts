import { useState, useCallback, useEffect } from 'react';
import { STORAGE_KEYS } from '../constants/storage';
import { tauriService, isEncrypted } from '../services/tauriService';
import type { HostTreeNode, HostEntry } from '../types/appTypes';

const STORAGE_KEY = STORAGE_KEYS.HOST_TREE;

// ── Jumpbox helpers ──

/** Flatten the tree into an array of host nodes. */
export function flattenHosts(nodes: HostTreeNode[]): HostTreeNode[] {
    const result: HostTreeNode[] = [];
    function traverse(list: HostTreeNode[]) {
        for (const n of list) {
            if (n.type === 'host') result.push(n);
            if (n.children) traverse(n.children);
        }
    }
    traverse(nodes);
    return result;
}

/** Return all hosts whose jumpboxId references the given id. */
export function getJumpboxReferences(nodes: HostTreeNode[], jumpboxId: string): HostTreeNode[] {
    return flattenHosts(nodes).filter(n => n.entry?.jumpboxId === jumpboxId);
}

function generateId(): string {
    return self.crypto.randomUUID();
}

// ── DPAPI batch helpers ──

/**
 * Encrypts an array of credential strings via the Tauri backend (Windows DPAPI).
 * Handles undefined values by filtering them out and mapping results back.
 */
async function encryptBatch(values: (string | undefined)[]): Promise<(string | undefined)[]> {
    if (values.length === 0) return values;

    const indices: number[] = [];
    const filtered: string[] = [];
    for (let i = 0; i < values.length; i++) {
        if (values[i] !== undefined) {
            indices.push(i);
            filtered.push(values[i]!);
        }
    }

    if (filtered.length === 0) return values;

    try {
        const encrypted = await tauriService.dpapiEncryptBatch(filtered);
        const result: (string | undefined)[] = [...values];
        for (let i = 0; i < indices.length; i++) {
            result[indices[i]] = encrypted[i];
        }
        return result;
    } catch (err) {
        console.error('[HostManager] Failed to batch encrypt credentials:', err);
        return values;
    }
}

/**
 * Decrypts an array of credential strings via the Tauri backend (Windows DPAPI).
 * Handles undefined values by filtering them out and mapping results back.
 */
export async function decryptBatch(values: (string | undefined)[]): Promise<(string | undefined)[]> {
    if (values.length === 0) return values;

    const indices: number[] = [];
    const filtered: string[] = [];
    for (let i = 0; i < values.length; i++) {
        if (values[i] !== undefined) {
            indices.push(i);
            filtered.push(values[i]!);
        }
    }

    if (filtered.length === 0) return values;

    try {
        const decrypted = await tauriService.dpapiDecryptBatch(filtered);
        const result: (string | undefined)[] = [...values];
        for (let i = 0; i < indices.length; i++) {
            result[indices[i]] = decrypted[i];
        }
        return result;
    } catch (err) {
        console.error('[HostManager] Failed to batch decrypt credentials:', err);
        return values;
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
                const entry = { ...n.entry };

                if (entry.username && !isEncrypted(entry.username)) {
                    secrets.push(entry.username);
                    setters.push((val) => entry.username = val);
                }

                if (entry.password && !isEncrypted(entry.password)) {
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

// ── Storage ──

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
        if (a.type !== b.type) {
            return a.type === 'folder' ? -1 : 1;
        }
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
}

// ── Hook ──

export function useHostManager() {
    const [tree, setTree] = useState<HostTreeNode[]>([]);

    useEffect(() => {
        const raw = loadRawTree();
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setTree(raw);

        const eagerDecryptTree = async (nodes: HostTreeNode[]) => {
            const secrets: (string | undefined)[] = [];
            const targets: { id: string; type: 'username' | 'password' }[] = [];
            let hasLegacyDpapi = false;

            function traverse(nodeList: HostTreeNode[]) {
                for (const n of nodeList) {
                    if (n.type === 'host' && n.entry && !decryptedCache[n.id]?.decrypted) {
                        if (n.entry.username && isEncrypted(n.entry.username)) {
                            if (n.entry.username.startsWith('[DPAPI]')) hasLegacyDpapi = true;
                            secrets.push(n.entry.username);
                            targets.push({ id: n.id, type: 'username' });
                        }
                        if (n.entry.password && isEncrypted(n.entry.password)) {
                            if (n.entry.password.startsWith('[DPAPI]')) hasLegacyDpapi = true;
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
                for (let i = 0; i < targets.length; i++) {
                    const t = targets[i];
                    const val = decrypted[i];
                    if (val !== undefined) {
                        setCachedCredential(t.id, { [t.type]: val });
                    }
                }

                if (hasLegacyDpapi) {
                    const replacePlaintext = (nodeList: HostTreeNode[]): HostTreeNode[] =>
                        nodeList.map(n => {
                            const children = n.children ? replacePlaintext(n.children) : undefined;
                            if (n.type === 'host' && n.entry) {
                                const cached = decryptedCache[n.id];
                                const entry = { ...n.entry };
                                if (cached?.username !== undefined && entry.username?.startsWith('[DPAPI]')) {
                                    entry.username = cached.username;
                                }
                                if (cached?.password !== undefined && entry.password?.startsWith('[DPAPI]')) {
                                    entry.password = cached.password;
                                }
                                return { ...n, entry, children };
                            }
                            return { ...n, children };
                        });
                    const plaintextNodes = replacePlaintext(nodes);
                    encryptTree(plaintextNodes).then(saveRawTree).catch(err => {
                        console.error('[HostManager] Migration re-encryption failed:', err);
                    });
                }
            }

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

        eagerDecryptTree(raw).catch(err => {
            console.error('[HostManager] Background eager decryption failed:', err);
        });
    }, []);

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
            entry,
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

            const patchedNode = flattenHosts(next).find(n => n.id === id);
            if (patchedNode?.type === 'host' && patchedNode.entry) {
                if (patch.entry?.username && !isEncrypted(patch.entry.username)) {
                    setCachedCredential(id, { username: patch.entry.username });
                }
                if (patch.entry?.password && !isEncrypted(patch.entry.password)) {
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
        return persistAndSet(newTree);
    }, [persistAndSet]);

    const moveNode = useCallback((nodeId: string, targetId: string, position: 'before' | 'after' | 'inside') => {
        setTree(prev => {
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

            const treeWithoutNode = removeNode(prev, nodeId);

            if (position === 'inside') {
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
        const idMap = new Map<string, string>();
        const buildIdMap = (nodeList: HostTreeNode[]): void => {
            for (const n of nodeList) {
                idMap.set(n.id, generateId());
                if (n.children) buildIdMap(n.children);
            }
        };
        buildIdMap(nodes);

        const reassignIds = (nodeList: HostTreeNode[]): HostTreeNode[] => {
            return nodeList.map(n => {
                const newNode: HostTreeNode = {
                    ...n,
                    id: idMap.get(n.id) || generateId(),
                    children: n.children ? reassignIds(n.children) : undefined
                };
                if (newNode.entry?.jumpboxId) {
                    const newJumpboxId = idMap.get(newNode.entry.jumpboxId);
                    newNode.entry = {
                        ...newNode.entry,
                        jumpboxId: newJumpboxId || undefined
                    };
                }
                return newNode;
            });
        };

        const importedNodes = reassignIds(nodes);
        const targetFolderId = parentId || generateId();

        setTree(prev => {
            let next: HostTreeNode[];
            if (parentId) {
                next = insertNodes(prev, parentId, importedNodes);
            } else {
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
