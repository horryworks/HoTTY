import { useState, useCallback, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { STORAGE_KEYS } from '../constants/storage';
import { tauriService, isEncrypted } from '../services/tauriService';
import { logError } from '../utils/logger';
import i18n from '../i18n';
import { WINDOW_LABEL, IS_TAURI } from '../utils/windowLabel';
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
 * Run a defined-only batch transform over `values` via the given backend RPC:
 * filter out `undefined` slots, send the rest to `rpc`, and splice the results
 * back into their original positions. Shared by encrypt/decrypt (which were
 * byte-identical apart from the RPC and the log label) so the index-mapping
 * logic and its empty-input guards live in one place.
 *
 * `failClosed` picks what an RPC failure means, and the two directions need
 * opposite answers. Decrypting fails **open**: returning the input leaves the
 * ciphertext in place, which is harmless. Encrypting must fail **closed** —
 * returning the input there hands plaintext secrets back to a caller that
 * believes they are encrypted, and the caller persists and broadcasts them.
 */
async function mapDefinedBatch(
    values: (string | undefined)[],
    rpc: (defined: string[]) => Promise<string[]>,
    label: string,
    failClosed = false,
): Promise<(string | undefined)[]> {
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
        const mapped = await rpc(filtered);
        const result: (string | undefined)[] = [...values];
        for (let i = 0; i < indices.length; i++) {
            result[indices[i]] = mapped[i];
        }
        return result;
    } catch (err) {
        logError('HostManager', i18n.t('notifications.errors.credentialBatch', { label }), err);
        if (failClosed) throw err;
        return values;
    }
}

/**
 * Encrypt credential strings via the Tauri backend (Windows DPAPI).
 *
 * Fails closed: `dpapi_encrypt_batch` collects into a `Result`, so one bad value
 * — or any IPC-layer rejection — fails the whole batch. Swallowing that and
 * returning the input would let `encryptTree` splice plaintext back into the
 * entries and `saveRawTree` write it to disk and broadcast it to every window.
 */
async function encryptBatch(values: (string | undefined)[]): Promise<(string | undefined)[]> {
    return mapDefinedBatch(values, (v) => tauriService.dpapiEncryptBatch(v), 'encrypt', true);
}

/**
 * Decrypt credential strings via the Tauri backend (Windows DPAPI).
 *
 * `dpapi_decrypt_batch` contains per-entry failures by returning an empty string
 * for them (so one bad blob can't fail the whole batch). Every caller only ever
 * passes values that already satisfied `isEncrypted()`, and `encryptTree` never
 * encrypts an empty value — so `''` coming back is unambiguously "could not
 * decrypt", never a real secret. Normalise it to `undefined` here: every caller
 * already guards on `!== undefined` and leaves its existing value in place, which
 * keeps the original ciphertext instead of overwriting a credential with blank.
 */
export async function decryptBatch(values: (string | undefined)[]): Promise<(string | undefined)[]> {
    const mapped = await mapDefinedBatch(values, (v) => tauriService.dpapiDecryptBatch(v), 'decrypt');
    return mapped.map((val, i) => (val === '' && values[i] !== '' ? undefined : val));
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

                if (entry.privateKeyPassphrase && !isEncrypted(entry.privateKeyPassphrase)) {
                    secrets.push(entry.privateKeyPassphrase);
                    setters.push((val) => entry.privateKeyPassphrase = val);
                }

                return { ...n, entry, children };
            }
            return { ...n, children };
        });
    }

    const newTree = traverse(nodes);
    const encryptedSecrets = await encryptBatch(secrets);

    for (let i = 0; i < encryptedSecrets.length; i++) {
        const val = encryptedSecrets[i];
        // Second line of defence behind `encryptBatch`'s fail-closed throw: a
        // short or malformed response would otherwise leave a plaintext secret
        // (or `undefined`, wiping a saved credential) in the tree handed to
        // `saveRawTree`, which persists it AND broadcasts it to every window.
        // Only values that came back as ciphertext are allowed through.
        if (val === undefined || !isEncrypted(val)) {
            throw new Error(`encryptTree: credential ${i} did not come back encrypted`);
        }
        setters[i](val);
    }

    return newTree;
}

// ── Cross-Instance Tree Synchronization ──
//
// `useHostManager` is called from multiple components (SessionDialog,
// SaveToHostTreeDialog). Each call produces its own React state, so a mutation
// in one instance was previously invisible to the other until the next full
// app restart. To keep them in lockstep, every mutation broadcasts the new
// tree synchronously via this module-level listener set; each instance's
// effect-registered listener calls setTree(newTree) to mirror the change.
type TreeListener = (tree: HostTreeNode[]) => void;
const treeListeners = new Set<TreeListener>();

function broadcastTreeUpdate(tree: HostTreeNode[]): void {
    for (const listener of treeListeners) listener(tree);
}

// Monotonic, MODULE-level write sequence. A local async encrypt only persists if
// it is still the latest write at resolve time. Module-level (not per-hook) so it
// coordinates across all useHostManager instances AND lets a cross-window remote
// update (which bumps it) invalidate an in-flight local encrypt — otherwise that
// stale encrypt would clobber the remote edit (lost update).
let treeWriteSeq = 0;

// ── In-Memory Decryption Cache ──

type DecryptedCredentialInfo = {
    username?: string;
    password?: string;
    privateKeyPassphrase?: string;
    decrypted?: boolean;
};
const decryptedCache: Record<string, DecryptedCredentialInfo> = {};

export function getCachedCredential(id: string): DecryptedCredentialInfo | undefined {
    return decryptedCache[id];
}

function setCachedCredential(id: string, info: DecryptedCredentialInfo) {
    if (!decryptedCache[id]) decryptedCache[id] = {};
    if (info.username !== undefined) decryptedCache[id].username = info.username;
    if (info.password !== undefined) decryptedCache[id].password = info.password;
    if (info.privateKeyPassphrase !== undefined) decryptedCache[id].privateKeyPassphrase = info.privateKeyPassphrase;
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
    const json = JSON.stringify(tree);
    localStorage.setItem(STORAGE_KEY, json);
    // Mirror the (encrypted) tree into other windows so the shared host tree
    // stays consistent across the single process. The blob is the encrypted
    // localStorage value — no plaintext credentials cross the event bus.
    if (IS_TAURI) void tauriService.broadcastSharedChange(STORAGE_KEY, json);
}

// Apply host-tree changes broadcast by other windows (once per window, at
// module load). Re-read the raw (encrypted) tree from localStorage and push it
// to every in-window consumer via the same listener set used for in-window
// mirroring — no re-broadcast, so it never echoes.
if (IS_TAURI) {
    void tauriService
        .onSharedStoreChanged(({ channel, payload, origin }) => {
            if (origin === WINDOW_LABEL || channel !== STORAGE_KEY) return;
            if (localStorage.getItem(STORAGE_KEY) === payload) return;
            localStorage.setItem(STORAGE_KEY, payload);
            // Invalidate any in-flight local encrypt so its delayed saveRawTree
            // can't overwrite this remote edit (lost update).
            treeWriteSeq++;
            // Drop the in-memory plaintext cache: another window may have changed
            // a host's credentials, so cached decrypts are now stale. They are
            // rebuilt lazily on next connect/save from the new encrypted blob.
            clearDecryptedCache();
            broadcastTreeUpdate(loadRawTree());
        })
        .catch(() => {
            /* listen() unavailable — host-tree cross-window sync stays a no-op */
        });
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

// Descending reverses only the name order — folders stay grouped before hosts.
function sortNodes(nodes: HostTreeNode[], direction: 'asc' | 'desc' = 'asc'): HostTreeNode[] {
    const sign = direction === 'desc' ? -1 : 1;
    return [...nodes].sort((a, b) => {
        if (a.type !== b.type) {
            return a.type === 'folder' ? -1 : 1;
        }
        return sign * a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
}

// ── Hook ──

export function useHostManager() {
    const [tree, setTree] = useState<HostTreeNode[]>([]);

    const persistEncryptedAsync = useCallback((nodes: HostTreeNode[]) => {
        // Mirror the change into every other useHostManager instance before
        // the async encrypt/persist: the SessionDialog tree and any other
        // consumer must see the new node immediately, not on next app launch.
        broadcastTreeUpdate(nodes);
        // Capture the module-level write sequence; only persist if still latest
        // at resolve time. Guards against out-of-order async encrypts AND a
        // concurrent cross-window remote update (which bumps the sequence).
        const myId = ++treeWriteSeq;
        encryptTree(nodes)
            .then((encrypted) => {
                if (treeWriteSeq === myId) {
                    saveRawTree(encrypted);
                }
            })
            .catch((err) => {
                logError('HostManager', i18n.t('notifications.errors.hostTreeEncrypt'), err);
            });
    }, []);

    // Subscribe this instance to cross-instance tree updates. The source
    // instance also fires its own listener with the same reference, which
    // React bails out on — so this is safe to register unconditionally.
    useEffect(() => {
        const listener: TreeListener = (newTree) => {
            setTree(newTree);
        };
        treeListeners.add(listener);
        return () => {
            treeListeners.delete(listener);
        };
    }, []);

    useEffect(() => {
        const raw = loadRawTree();
        setTree(raw);

        // v1 (Electron safeStorage) credentials live as [SAFE] + base64("v10" + DPAPI-blob);
        // v2 expects [SAFE] + base64(DPAPI-blob). The upgrade is done Rust-side so plaintext
        // never crosses IPC. Idempotent — v2 blobs are byte-equal in the response.
        const migrateV1Credentials = async (nodes: HostTreeNode[]): Promise<HostTreeNode[]> => {
            try {
                const inputJson = JSON.stringify(nodes);
                const migratedJson = await tauriService.migrateHostTreeCredentials(inputJson);
                if (migratedJson === inputJson) return nodes;
                const migrated: HostTreeNode[] = JSON.parse(migratedJson);
                saveRawTree(migrated);
                setTree(migrated);
                return migrated;
            } catch (err) {
                logError('HostManager', i18n.t('notifications.errors.credentialMigration'), err);
                return nodes;
            }
        };

        // IAP protocol migration: in v2.0.0 IAP hosts were stored as
        // `protocol: 'ssh' + iapTunnel: {...}`. v2.0.1 makes IAP its own
        // protocol. On load, rewrite legacy entries to `protocol: 'gcloud-iap'`
        // and clear username/password/jumpboxId (gcloud handles auth).
        // Idempotent: hosts already on 'gcloud-iap' pass through unchanged.
        const migrateIapProtocol = (nodes: HostTreeNode[]): HostTreeNode[] => {
            let changed = false;
            const walk = (list: HostTreeNode[]): HostTreeNode[] =>
                list.map(n => {
                    const children = n.children ? walk(n.children) : undefined;
                    if (
                        n.type === 'host' &&
                        n.entry &&
                        n.entry.protocol === 'ssh' &&
                        n.entry.iapTunnel
                    ) {
                        changed = true;
                        return {
                            ...n,
                            entry: {
                                ...n.entry,
                                protocol: 'gcloud-iap',
                                username: undefined,
                                password: undefined,
                                isJumpbox: undefined,
                                jumpboxId: undefined,
                            },
                            children,
                        };
                    }
                    return children ? { ...n, children } : n;
                });
            const result = walk(nodes);
            if (changed) {
                saveRawTree(result);
                setTree(result);
            }
            return result;
        };

        const eagerDecryptTree = async (nodes: HostTreeNode[]) => {
            const secrets: (string | undefined)[] = [];
            const targets: { id: string; type: 'username' | 'password' | 'privateKeyPassphrase' }[] = [];
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
                        if (n.entry.privateKeyPassphrase && isEncrypted(n.entry.privateKeyPassphrase)) {
                            if (n.entry.privateKeyPassphrase.startsWith('[DPAPI]')) hasLegacyDpapi = true;
                            secrets.push(n.entry.privateKeyPassphrase);
                            targets.push({ id: n.id, type: 'privateKeyPassphrase' });
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
                                if (cached?.privateKeyPassphrase !== undefined && entry.privateKeyPassphrase?.startsWith('[DPAPI]')) {
                                    entry.privateKeyPassphrase = cached.privateKeyPassphrase;
                                }
                                return { ...n, entry, children };
                            }
                            return { ...n, children };
                        });
                    const plaintextNodes = replacePlaintext(nodes);
                    persistEncryptedAsync(plaintextNodes);
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

        migrateV1Credentials(raw)
            .then(migrateIapProtocol)
            .then(eagerDecryptTree)
            .catch(err => {
                logError('HostManager', i18n.t('notifications.errors.credentialPreload'), err);
            });
    }, [persistEncryptedAsync]);

    const persistAndSet = useCallback(async (decryptedTree: HostTreeNode[]) => {
        const myId = ++treeWriteSeq;
        try {
            const encrypted = await encryptTree(decryptedTree);
            if (treeWriteSeq === myId) {
                saveRawTree(encrypted);
            }
        } catch (err) {
            // `encryptTree` now fails closed, so reaching here means nothing was
            // written — which is the point. Report it and keep going: the caller
            // (`saveTree`, awaited inside the connect flow) must not be rejected,
            // and the in-memory tree is still broadcast below so the edit stays
            // on screen. This mirrors how `persistEncryptedAsync` behaves.
            logError('HostManager', i18n.t('notifications.errors.hostTreeEncrypt'), err);
        }
        // Broadcast first so every instance (including this one) updates via
        // the same listener path — keeps source and mirror state-change paths
        // identical, avoiding subtle drift.
        broadcastTreeUpdate(decryptedTree);
    }, []);

    const addFolder = useCallback((parentId: string | null, name: string) => {
        const node: HostTreeNode = {
            id: generateId(),
            type: 'folder',
            name,
            children: [],
        };
        let next: HostTreeNode[] = [];
        flushSync(() => {
            setTree(prev => {
                next = insertNode(prev, parentId, node);
                return next;
            });
        });
        persistEncryptedAsync(next);
        return node.id;
    }, [persistEncryptedAsync]);

    const addHost = useCallback((parentId: string | null, name: string, entry: HostEntry) => {
        const node: HostTreeNode = {
            id: generateId(),
            type: 'host',
            name,
            entry,
        };
        let next: HostTreeNode[] = [];
        flushSync(() => {
            setTree(prev => {
                next = insertNode(prev, parentId, node);
                return next;
            });
        });
        persistEncryptedAsync(next);
        return node.id;
    }, [persistEncryptedAsync]);

    const editNode = useCallback((id: string, patch: Partial<HostTreeNode>) => {
        let next: HostTreeNode[] = [];
        flushSync(() => {
            setTree(prev => {
                next = patchNode(prev, id, patch);
                return next;
            });
        });
        const patchedNode = flattenHosts(next).find(n => n.id === id);
        if (patchedNode?.type === 'host' && patchedNode.entry) {
            if (patch.entry?.username && !isEncrypted(patch.entry.username)) {
                setCachedCredential(id, { username: patch.entry.username });
            }
            if (patch.entry?.password && !isEncrypted(patch.entry.password)) {
                setCachedCredential(id, { password: patch.entry.password });
            }
            // Cache an edited passphrase too — the cache treats all three
            // credentials symmetrically elsewhere, so omitting it here meant a
            // freshly-edited passphrase could be served stale on reconnect.
            if (patch.entry?.privateKeyPassphrase && !isEncrypted(patch.entry.privateKeyPassphrase)) {
                setCachedCredential(id, { privateKeyPassphrase: patch.entry.privateKeyPassphrase });
            }
        }
        persistEncryptedAsync(next);
    }, [persistEncryptedAsync]);

    const deleteNode = useCallback((id: string) => {
        let next: HostTreeNode[] = [];
        flushSync(() => {
            setTree(prev => {
                next = removeNode(prev, id);
                return next;
            });
        });
        persistEncryptedAsync(next);
    }, [persistEncryptedAsync]);

    const saveTree = useCallback((newTree: HostTreeNode[]) => {
        return persistAndSet(newTree);
    }, [persistAndSet]);

    const moveNode = useCallback((nodeId: string, targetId: string, position: 'before' | 'after' | 'inside') => {
        let next: HostTreeNode[] = [];
        let changed = false;
        flushSync(() => {
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
                if (!movingNode) { next = prev; return prev; }
                if (nodeId === targetId) { next = prev; return prev; }
                if (isDescendant(movingNode, targetId)) { next = prev; return prev; }

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
                    next = insertInside(treeWithoutNode);
                    changed = true;
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
                next = insertAtPosition(treeWithoutNode);
                changed = true;
                return next;
            });
        });
        if (changed) {
            persistEncryptedAsync(next);
        }
    }, [persistEncryptedAsync]);

    const sortFolder = useCallback((folderId: string | null, direction: 'asc' | 'desc' = 'asc') => {
        let next: HostTreeNode[] = [];
        flushSync(() => {
            setTree(prev => {
                if (folderId === null) {
                    next = sortNodes(prev, direction);
                    return next;
                }

                const sortInTree = (nodes: HostTreeNode[]): HostTreeNode[] => {
                    return nodes.map(n => {
                        if (n.id === folderId && n.type === 'folder') {
                            return { ...n, children: sortNodes(n.children ?? [], direction) };
                        }
                        if (n.children) {
                            return { ...n, children: sortInTree(n.children) };
                        }
                        return n;
                    });
                };

                next = sortInTree(prev);
                return next;
            });
        });
        persistEncryptedAsync(next);
    }, [persistEncryptedAsync]);

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

        let next: HostTreeNode[] = [];
        flushSync(() => {
            setTree(prev => {
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
                return next;
            });
        });
        persistEncryptedAsync(next);

        return targetFolderId;
    }, [persistEncryptedAsync]);

    return { tree, addFolder, addHost, editNode, deleteNode, saveTree, moveNode, sortFolder, importData };
}
