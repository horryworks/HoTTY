import type { HostTreeNode } from '../types/appTypes';

/**
 * Narrow the Host Tree down to the nodes matching a free-text query, for the
 * filter box above the tree in the New Session dialog.
 *
 * Pure and dependency-free on purpose — the same shape as `hostLookup.ts` — so
 * the matching rules are unit-testable without rendering the tree.
 */

/**
 * The text a node is matched against: its display name, plus — for a host — the
 * address shown next to the name in the row. Everything a user can *see* on the
 * row is searchable; the username and the protocol deliberately are not.
 */
export function nodeSearchText(node: HostTreeNode): string {
    const parts: string[] = [node.name];
    if (node.type === 'host' && node.entry) {
        const e = node.entry;
        parts.push(e.host);
        // An IAP host shows "<project>:<instance>" instead of a plain address.
        if (e.iapTunnel) parts.push(e.iapTunnel.project, e.iapTunnel.instance);
    }
    return parts.filter(Boolean).join(' ').toLowerCase();
}

/** Case-insensitive substring test against {@link nodeSearchText}. */
function matches(node: HostTreeNode, needle: string): boolean {
    return nodeSearchText(node).includes(needle);
}

/**
 * Keep only the nodes matching `query`, preserving the tree shape.
 *
 * - An empty query returns `nodes` unchanged (same reference — no re-render churn).
 * - A folder that matches by name is kept **whole**: its children survive even
 *   when none of them match, so typing a folder name browses that folder.
 * - A folder that does not match is recursed into and dropped when nothing
 *   inside it survives.
 * - A host is kept only when it matches itself.
 */
export function filterHostTree(nodes: HostTreeNode[], query: string): HostTreeNode[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return nodes;

    const out: HostTreeNode[] = [];
    for (const node of nodes) {
        if (node.type === 'folder') {
            if (matches(node, needle)) {
                out.push(node);
                continue;
            }
            const children = filterHostTree(node.children ?? [], needle);
            if (children.length > 0) out.push({ ...node, children });
        } else if (matches(node, needle)) {
            out.push(node);
        }
    }
    return out;
}
