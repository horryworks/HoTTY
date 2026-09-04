import type { HostTreeNode } from '../types/appTypes';

/**
 * Look up saved Host Tree entries by address, for the AI Chat `connect` flow:
 * when the AI asks to open a session to a host, a matching tree entry supplies
 * the credentials (and the human-readable name) without the AI ever seeing them.
 *
 * Pure and dependency-free on purpose — it is consumed by the equally pure
 * `aiConnectRequest` resolver and must stay trivially unit-testable.
 */

export type HostLookupResult =
    | { kind: 'none' }
    | { kind: 'one'; node: HostTreeNode }
    /** Several entries match and the hints could not narrow them to one. */
    | { kind: 'ambiguous'; nodes: HostTreeNode[] };

export interface HostLookupHints {
    /** Only entries with this protocol qualify (an SSH request never borrows a
     *  Telnet entry's credentials, and vice versa). */
    protocol?: 'ssh' | 'telnet';
    /** Hard filter, NOT a tie-breaker: an entry saved for a different port does
     *  not qualify. The saved entry's credentials would otherwise be replayed to
     *  a port the request named — for Telnet that means the stored username and
     *  password are auto-typed in cleartext at whatever is listening there. */
    port?: number;
    /** Tie-breaker among several matches: the entry's tree name (case-insensitive). */
    name?: string;
}

/** Depth-first flatten of the host nodes (folders are skipped, recursed into). */
function flattenHostNodes(nodes: HostTreeNode[]): HostTreeNode[] {
    const out: HostTreeNode[] = [];
    const walk = (list: HostTreeNode[]) => {
        for (const n of list) {
            if (n.type === 'host' && n.entry) out.push(n);
            if (n.children) walk(n.children);
        }
    };
    walk(nodes);
    return out;
}

/**
 * Find the tree entries whose `host` equals `host` (case-insensitive, trimmed).
 * GCP IAP entries are never returned — they carry no reusable credentials.
 *
 * `protocol` and `port` are hard FILTERS: a saved entry only qualifies if it was
 * saved for that exact target. `port` used to be a tie-breaker skipped whenever
 * a single entry matched the hostname, which let an entry saved for port 2222
 * hand its credentials to a request for port 23. `name` stays a tie-breaker —
 * it narrows among equally-valid candidates and carries no credential risk.
 */
export function findHostNodesByAddress(
    tree: HostTreeNode[],
    host: string,
    hints: HostLookupHints = {},
): HostLookupResult {
    const target = host.trim().toLowerCase();
    if (!target) return { kind: 'none' };

    let matches = flattenHostNodes(tree).filter((n) => {
        const e = n.entry!;
        if (e.protocol === 'gcloud-iap') return false;
        if (hints.protocol && e.protocol !== hints.protocol) return false;
        if (hints.port !== undefined && e.port !== hints.port) return false;
        return e.host.trim().toLowerCase() === target;
    });

    if (matches.length > 1 && hints.name) {
        const wanted = hints.name.trim().toLowerCase();
        const byName = matches.filter((n) => n.name.trim().toLowerCase() === wanted);
        if (byName.length > 0) matches = byName;
    }

    if (matches.length === 0) return { kind: 'none' };
    if (matches.length === 1) return { kind: 'one', node: matches[0] };
    return { kind: 'ambiguous', nodes: matches };
}
