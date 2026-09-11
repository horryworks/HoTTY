import type { HostTreeNode } from '../types/appTypes';
import { parseCidr, parseIpAddress, prefixContains, type IpPrefix } from './cidr';

/**
 * What a folder holds, for the details panel beside the tree.
 *
 * Read-only, and deliberately shallow: only the folder's own children are
 * reported. A Region selected in the tree therefore lists the Sites under it
 * and no hosts, which is the honest answer to "what is in this folder".
 */

/**
 * Whether a host's address sits inside one of its folder's own prefixes.
 *
 * `unknown` is the safe answer and covers two different situations on purpose:
 * the folder carries no readable prefix (so there is nothing to be outside of),
 * and the address is not an IP literal. Neither is evidence of a misplaced
 * host, and marking them would put a warning on most of the tree.
 */
export type HostRange = 'in' | 'out' | 'unknown';

export interface FolderHost {
    node: HostTreeNode;
    /** `entry.host` verbatim — a free string, shown as the user typed it. */
    address: string;
    range: HostRange;
}

export interface FolderSummary {
    /** Direct child folders, in tree order. */
    folders: HostTreeNode[];
    /** Direct child hosts, in tree order. */
    hosts: FolderHost[];
    /** The folder's own prefixes, parsed. */
    prefixes: IpPrefix[];
    /**
     * Stored prefix text that would not parse. Only reachable on a tree written
     * by an older build or edited by hand — the sync stores canonical form —
     * but counted rather than dropped, so "my range is missing" has an answer.
     */
    unparsedPrefixes: string[];
    /** Whether any host is outside every prefix. Drives the panel's summary. */
    outOfRangeCount: number;
}

export function summarizeFolder(folder: HostTreeNode): FolderSummary {
    const prefixes: IpPrefix[] = [];
    const unparsedPrefixes: string[] = [];
    for (const text of folder.netbox?.prefixes ?? []) {
        const parsed = parseCidr(text);
        if (parsed === null) unparsedPrefixes.push(text);
        else prefixes.push(parsed);
    }

    const folders: HostTreeNode[] = [];
    const hosts: FolderHost[] = [];
    let outOfRangeCount = 0;

    for (const child of folder.children ?? []) {
        if (child.type === 'folder') {
            folders.push(child);
            continue;
        }
        const address = child.entry?.host ?? '';
        const range = rangeOf(address, prefixes);
        if (range === 'out') outOfRangeCount++;
        hosts.push({ node: child, address, range });
    }

    return { folders, hosts, prefixes, unparsedPrefixes, outOfRangeCount };
}

function rangeOf(address: string, prefixes: IpPrefix[]): HostRange {
    // Nothing to be inside or outside of.
    if (prefixes.length === 0) return 'unknown';
    // Never resolve a name: `user@host`, `host:22` and real hostnames all land
    // here, and a DNS answer would make the verdict depend on the moment it was
    // asked (ADR-020).
    const addr = parseIpAddress(address);
    if (addr === null) return 'unknown';
    return prefixes.some(p => prefixContains(p, addr)) ? 'in' : 'out';
}
