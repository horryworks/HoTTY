import { useState, useCallback } from 'react';

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

function loadTree(): HostTreeNode[] {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        return saved ? JSON.parse(saved) : [];
    } catch {
        return [];
    }
}

function persistTree(tree: HostTreeNode[]) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tree));
}

// --- Tree manipulation helpers (pure functions) ---

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

// --- Hook ---

export function useHostManager() {
    const [tree, setTree] = useState<HostTreeNode[]>(loadTree);

    const saveAndSet = useCallback((newTree: HostTreeNode[]) => {
        persistTree(newTree);
        setTree(newTree);
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
            persistTree(next);
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
            persistTree(next);
            return next;
        });
        return node.id;
    }, []);

    const editNode = useCallback((id: string, patch: Partial<HostTreeNode>) => {
        setTree(prev => {
            const next = patchNode(prev, id, patch);
            persistTree(next);
            return next;
        });
    }, []);

    const deleteNode = useCallback((id: string) => {
        setTree(prev => {
            const next = removeNode(prev, id);
            persistTree(next);
            return next;
        });
    }, []);

    const saveTree = useCallback((newTree: HostTreeNode[]) => {
        saveAndSet(newTree);
    }, [saveAndSet]);

    return { tree, addFolder, addHost, editNode, deleteNode, saveTree };
}
