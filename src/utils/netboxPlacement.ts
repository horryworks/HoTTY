import type { HostTreeNode } from '../types/appTypes';
import { parseCidr, parseIpAddress, prefixContains, type IpPrefix } from './cidr';

/**
 * Decide which NetBox folder a host belongs in, from its address.
 *
 * Pure and dependency-free, the same shape as `netboxSync.ts` and
 * `hostLookup.ts`, so every rule is testable with no tree state and no server.
 *
 * ## What this is and is not
 *
 * It **proposes**. Nothing here moves a host, and a sync never calls it: the
 * ownership split in ADR-018 keeps every `type: 'host'` node the user's, and a
 * placement rule that wrote to the tree on its own would fight the user's own
 * drags last-writer-wins. A host moves only because someone confirmed it
 * (ADR-020).
 *
 * ## Two refusals worth knowing about
 *
 *  * **A name is never resolved.** If `entry.host` is not an IP literal the
 *    answer is `notAnAddress`, not a DNS lookup — that would make the folder a
 *    host lands in depend on what a resolver said at that moment.
 *  * **Two folders claiming the same network are never split.** Same mask
 *    length, more than one folder ⇒ `ambiguous`, and the caller shows both.
 *    Picking one would hide a NetBox data problem behind a plausible answer,
 *    and re-using an RFC 1918 range across sites is common enough that the
 *    problem is worth surfacing.
 */

/** One folder that carries prefixes, flattened out of the tree. */
export interface PrefixFolder {
    id: string;
    name: string;
    kind: 'region' | 'site';
    /** The prefix that matched, for the UI to name. */
    prefix: IpPrefix;
}

export type PlacementResult =
    /** No folder in the tree carries a prefix. Show NOTHING: this is every user
     *  who has not set the feature up, and a line about matching would be noise
     *  they cannot act on. Distinct from `unmatched` for exactly that reason. */
    | { kind: 'noPrefixes' }
    /** The address is not an IP literal. Nothing was resolved. */
    | { kind: 'notAnAddress' }
    /** Read as an address, but inside no prefix in the tree. */
    | { kind: 'unmatched' }
    | { kind: 'one'; folder: PrefixFolder }
    /** Several folders claim the address at the same mask length. */
    | { kind: 'ambiguous'; folders: PrefixFolder[] };

/** One host and where the plan would put it. */
export interface PlannedMove {
    host: HostTreeNode;
    /** The folder id the host sits in now; `null` at the tree root. */
    from: string | null;
    folder: PrefixFolder;
}

export interface PlacementPlan {
    move: PlannedMove[];
    /** Hosts already sitting in the folder their address matches. Counted, not
     *  listed: without it "apply did nothing" and "nothing matched" look alike. */
    alreadyPlaced: number;
    ambiguous: { host: HostTreeNode; folders: PrefixFolder[] }[];
    unmatched: { host: HostTreeNode; reason: 'notAnAddress' | 'noMatch' }[];
    /** Whether anything in scope carried a prefix at all. */
    anyPrefixes: boolean;
}

/** A folder plus one of its prefixes, before a winner is chosen. */
interface Candidate {
    id: string;
    name: string;
    kind: 'region' | 'site';
    prefix: IpPrefix;
}

/**
 * Every prefix-carrying folder under `scopeFolderId` (the whole tree when
 * `null`), one entry per prefix.
 *
 * Includes folders the user dragged out of the NetBox container — the marker
 * rides along and NetBox still names them, so they are still that site. Skips
 * folders NetBox no longer knows about: putting a new host into a site that
 * has been deleted upstream is not a suggestion worth making.
 */
export function collectPrefixFolders(
    tree: HostTreeNode[],
    scopeFolderId: string | null = null,
): PrefixFolder[] {
    const out: Candidate[] = [];
    const walk = (nodes: HostTreeNode[]) => {
        for (const n of nodes) {
            if (n.type !== 'folder') continue;
            const link = n.netbox;
            if (link && !link.missing && (link.kind === 'region' || link.kind === 'site')) {
                for (const text of link.prefixes ?? []) {
                    const prefix = parseCidr(text);
                    // Stored values are canonical, so this only fires on a tree
                    // hand-edited or written by an older build.
                    if (prefix !== null) {
                        out.push({ id: n.id, name: n.name, kind: link.kind, prefix });
                    }
                }
            }
            if (n.children) walk(n.children);
        }
    };
    walk(scopeFolderId === null ? tree : (findFolder(tree, scopeFolderId)?.children ?? []));
    return out;
}

/**
 * The id of the folder `nodeId` currently sits in; `null` when it sits at the
 * tree root, `undefined` when the tree holds no such node.
 *
 * The three answers are deliberately distinct: `null` is a real location a host
 * can be moved out of, while `undefined` means the question was about something
 * that is not there — folding them together would make "at the root" and "gone"
 * look alike to a caller deciding whether a move is a no-op.
 */
export function findParentFolderId(
    tree: HostTreeNode[],
    nodeId: string,
): string | null | undefined {
    const walk = (nodes: HostTreeNode[], parentId: string | null): string | null | undefined => {
        for (const n of nodes) {
            if (n.id === nodeId) return parentId;
            if (n.children) {
                const hit = walk(n.children, n.id);
                if (hit !== undefined) return hit;
            }
        }
        return undefined;
    };
    return walk(tree, null);
}

/** The folder with this id, or undefined. */
export function findFolder(tree: HostTreeNode[], id: string): HostTreeNode | undefined {
    for (const n of tree) {
        if (n.id === id && n.type === 'folder') return n;
        if (n.children) {
            const hit = findFolder(n.children, id);
            if (hit) return hit;
        }
    }
    return undefined;
}

/**
 * The folder an address belongs in, by longest prefix match.
 *
 * A site's `/24` beats a region's `/16` because it is **narrower**, not because
 * it is a site. Two folders tied at the same mask length are reported as tied;
 * ranking region below site there would quietly resolve a contradiction the
 * user should see.
 */
export function suggestFolderForHost(folders: PrefixFolder[], host: string): PlacementResult {
    if (folders.length === 0) return { kind: 'noPrefixes' };
    const addr = parseIpAddress(host);
    if (addr === null) return { kind: 'notAnAddress' };

    let bestBits = -1;
    let best: PrefixFolder[] = [];
    for (const f of folders) {
        if (!prefixContains(f.prefix, addr)) continue;
        if (f.prefix.bits > bestBits) {
            bestBits = f.prefix.bits;
            best = [f];
        } else if (f.prefix.bits === bestBits) {
            best.push(f);
        }
    }
    if (best.length === 0) return { kind: 'unmatched' };

    // One folder can hold two prefixes of equal length that both match only if
    // they are the same network, which de-duplication already prevents — but
    // fold by id anyway so a hand-edited tree cannot fake a tie with itself.
    const byId = new Map<string, PrefixFolder>();
    for (const f of best) if (!byId.has(f.id)) byId.set(f.id, f);
    const unique = [...byId.values()];
    if (unique.length === 1) return { kind: 'one', folder: unique[0] };
    unique.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return { kind: 'ambiguous', folders: unique };
}

/**
 * Where every host under `scopeFolderId` would go.
 *
 * `folders` is passed in rather than derived, so a caller can offer "match
 * against this subtree" and "match against the whole tree" from one tree walk —
 * narrowing the candidates is the only real defence against an estate that
 * reuses `192.168.1.0/24` at every site.
 */
export function planPlacements(
    tree: HostTreeNode[],
    scopeFolderId: string | null,
    folders: PrefixFolder[],
): PlacementPlan {
    const plan: PlacementPlan = {
        move: [],
        alreadyPlaced: 0,
        ambiguous: [],
        unmatched: [],
        anyPrefixes: folders.length > 0,
    };

    const walk = (nodes: HostTreeNode[], parentId: string | null) => {
        for (const n of nodes) {
            if (n.type === 'host') {
                if (!n.entry) continue;
                const result = suggestFolderForHost(folders, n.entry.host);
                switch (result.kind) {
                    case 'one':
                        if (result.folder.id === parentId) plan.alreadyPlaced++;
                        else plan.move.push({ host: n, from: parentId, folder: result.folder });
                        break;
                    case 'ambiguous':
                        plan.ambiguous.push({ host: n, folders: result.folders });
                        break;
                    case 'notAnAddress':
                        plan.unmatched.push({ host: n, reason: 'notAnAddress' });
                        break;
                    // `noPrefixes` cannot differ per host: it is decided by
                    // `folders` alone, and `anyPrefixes` already carries it.
                    default:
                        plan.unmatched.push({ host: n, reason: 'noMatch' });
                }
                continue;
            }
            if (n.children) walk(n.children, n.id);
        }
    };

    if (scopeFolderId === null) walk(tree, null);
    else {
        const scope = findFolder(tree, scopeFolderId);
        if (scope) walk(scope.children ?? [], scope.id);
    }
    return plan;
}
