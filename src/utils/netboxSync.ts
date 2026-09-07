import type {
    HostEntry,
    HostTreeNode,
    NetboxNodeLink,
    NetboxSiteDto,
    NetboxSnapshot,
} from '../types/appTypes';

/**
 * Reconcile the Host Tree against a snapshot of a NetBox server's Regions and
 * Sites.
 *
 * Pure and dependency-free on purpose — the same shape as `hostTreeFilter.ts` —
 * so every rule below is unit-testable with no HTTP and no Tauri. Essentially
 * all of this feature's design risk lives in this file.
 *
 * ## Who owns what
 *
 * The whole design rests on deciding up front who decides each thing, so there
 * is no conflict left to resolve:
 *
 * | thing                                   | owner  | what a sync does                       |
 * |-----------------------------------------|--------|----------------------------------------|
 * | a region/site folder's name             | NetBox | overwritten every sync                 |
 * | a site folder's children (user's hosts) | user   | never read, written or reordered       |
 * | placement INSIDE the container          | NetBox | re-parented when NetBox's parent moves |
 * | placement OUTSIDE the container         | user   | never moved; still renamed             |
 * | sibling order, after creation           | user   | new folders inserted name-sorted only  |
 * | the container's own name and position   | user   | set once at creation                   |
 * | an object that vanished from NetBox     | nobody | marked `missing`, NEVER deleted        |
 * | every `type: 'host'` node, anywhere     | user   | never touched                          |
 */

/** The only configurable server today. Mirrored in Rust as `DEFAULT_SERVER_KEY`
 *  (`src-tauri/src/services/netbox/mod.rs`) — the two must agree. */
export const NETBOX_DEFAULT_SERVER = 'default';

/** Name given to the container folder WHEN IT IS CREATED. Not translated: the
 *  tree is persisted, and a translated default would rename itself under the
 *  user when they switch language. Afterwards the name is the user's. */
export const NETBOX_ROOT_FOLDER_NAME = 'NetBox';

export interface ReconcileOptions {
    /** ISO stamp written when an object is first found missing. Injected so
     *  tests are deterministic and one run cannot straddle two clocks. */
    now: string;
    /** Only used when the container must be created. */
    rootFolderName?: string;
    /** Injected so tests get stable ids. */
    newId?: () => string;
}

export interface NetboxSyncReport {
    /** Objects in the snapshot, not folders in the tree. */
    regions: number;
    sites: number;
    created: number;
    renamed: number;
    moved: number;
    /** NetBox folders the user dragged out of the container. Left where they
     *  are, on purpose — that move was a deliberate act. */
    detached: number;
    markedMissing: number;
    unmarkedMissing: number;
    stillMissing: number;
    /**
     * Sites with no value in the configured Site ID field. Zero when no field
     * is configured — nothing was asked for, so nothing is missing.
     *
     * This number is the whole antidote to the feature's quietest failure:
     * picking the wrong Site ID field produces no error, no failed sync and no
     * changed name, so "it doesn't work" and "that field is empty on every
     * site" look identical without it.
     */
    sitesWithoutSiteId: number;
    /** Nodes that carried a NetBox marker already claimed by another node —
     *  the shape an exported-then-imported tree comes back in. Demoted to
     *  ordinary folders, never deleted. */
    duplicatesAdopted: number;
    rootCreated: boolean;
    /** `false` ⇒ the returned tree is REFERENCE-EQUAL to the input, and the
     *  caller can skip persisting entirely (no encrypt, no write, no broadcast). */
    changed: boolean;
}

/**
 * The stable identity of one NetBox object as a string key.
 *
 * `kind` is part of the key because NetBox region 7 and site 7 are different
 * objects; without it a sync would rename one into the other.
 *
 * `null` for the container, which mirrors no NetBox object.
 */
export function netboxRef(link: NetboxNodeLink): string | null {
    if (link.kind === 'root' || link.objectId === undefined) return null;
    return `${link.server}:${link.kind}:${link.objectId}`;
}

/**
 * Whether NetBox owns this folder's name.
 *
 * True for region and site folders, whose names the sync overwrites on every
 * run — which is why the UI refuses to rename them: allowing it would ship a
 * control that silently undoes itself. False for the container, whose name is
 * the user's from the moment it is created.
 */
export function isNetboxNamed(node: HostTreeNode): boolean {
    return node.netbox !== undefined && node.netbox.kind !== 'root';
}

/**
 * The folder name for one site: the code, one space, then NetBox's name.
 *
 * The separator is deliberately not configurable — one format was asked for,
 * and a setting nobody uses is a thing to carry forever.
 */
export function siteFolderName(site: NetboxSiteDto): string {
    const code = site.siteId?.trim();
    return code ? `${code} ${site.name}` : site.name;
}

// ── internals ──────────────────────────────────────────────────────────────

/**
 * A folder being reconciled. Folders are shallow-copied into drafts so they can
 * be edited freely; hosts are carried by reference and never copied, which is
 * exactly how a user's hand-made hosts survive a sync unchanged.
 */
interface Draft {
    draft: true;
    id: string;
    name: string;
    entry?: HostEntry;
    netbox?: NetboxNodeLink;
    children: Child[];
    parent: Draft | null;
    /** Whether the source node had a `children` array at all, so materializing
     *  an untouched empty folder does not invent one. */
    hadChildren: boolean;
}

type Child = Draft | HostTreeNode;

function isDraft(c: Child): c is Draft {
    return (c as Draft).draft === true;
}

/** Matches `sortNodes` in `useHostManager.ts`, so sync-inserted folders land
 *  where a manual sort would have put them. */
function compareNames(a: string, b: string): number {
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

function toDraft(node: HostTreeNode, parent: Draft | null): Child {
    if (node.type !== 'folder') return node;
    const d: Draft = {
        draft: true,
        id: node.id,
        name: node.name,
        entry: node.entry,
        netbox: node.netbox,
        children: [],
        parent,
        hadChildren: node.children !== undefined,
    };
    d.children = (node.children ?? []).map(c => toDraft(c, d));
    return d;
}

function materialize(c: Child): HostTreeNode {
    if (!isDraft(c)) return c;
    const out: HostTreeNode = { id: c.id, type: 'folder', name: c.name };
    if (c.entry !== undefined) out.entry = c.entry;
    if (c.children.length > 0 || c.hadChildren) out.children = c.children.map(materialize);
    if (c.netbox !== undefined) out.netbox = c.netbox;
    return out;
}

/** Depth-first pre-order over folder drafts. */
function walk(children: Child[], visit: (d: Draft) => void): void {
    for (const c of children) {
        if (!isDraft(c)) continue;
        visit(c);
        walk(c.children, visit);
    }
}

function isInside(node: Draft, ancestor: Draft): boolean {
    for (let p = node.parent; p; p = p.parent) {
        if (p === ancestor) return true;
    }
    return false;
}

function emptyReport(): NetboxSyncReport {
    return {
        regions: 0, sites: 0, created: 0, renamed: 0, moved: 0, detached: 0,
        markedMissing: 0, unmarkedMissing: 0, stillMissing: 0,
        sitesWithoutSiteId: 0, duplicatesAdopted: 0,
        rootCreated: false, changed: false,
    };
}

// ── the reconcile ──────────────────────────────────────────────────────────

export function reconcileNetboxTree(
    tree: HostTreeNode[],
    snapshot: NetboxSnapshot,
    options: ReconcileOptions,
): { tree: HostTreeNode[]; report: NetboxSyncReport } {
    const server = snapshot.serverKey;
    const newId = options.newId ?? (() => self.crypto.randomUUID());
    const report = emptyReport();
    report.regions = snapshot.regions.length;
    report.sites = snapshot.sites.length;
    report.sitesWithoutSiteId = snapshot.siteIdField
        ? snapshot.sites.filter(s => !s.siteId || !s.siteId.trim()).length
        : 0;
    let changed = false;

    // A virtual root, so the tree's top level is just another parent and the
    // placement rules need no special case for it.
    const root: Draft = {
        draft: true, id: '', name: '', children: [], parent: null, hadChildren: true,
    };
    root.children = tree.map(n => toDraft(n, root));

    // 1. Index every folder this server manages, in pre-order.
    const managed: Draft[] = [];
    walk(root.children, d => {
        if (d.netbox?.server === server) managed.push(d);
    });

    /** Demote a folder to an ordinary one. Never deletes: it may hold hosts. */
    const adopt = (d: Draft): void => {
        d.netbox = undefined;
        report.duplicatesAdopted++;
        changed = true;
    };

    // 2. Elect the single container.
    const containers = managed.filter(d => d.netbox?.kind === 'root');
    let container: Draft | undefined = containers[0];
    for (const extra of containers.slice(1)) adopt(extra);

    // 3. Resolve duplicate object markers. `importData` reassigns every node id
    //    on import, so an exported-and-reimported NetBox subtree arrives as a
    //    second set of nodes carrying the same markers. Keep one, demote the
    //    rest — the demoted copy is a real folder with the user's hosts in it,
    //    it just stops being managed.
    const byRef = new Map<string, Draft>();
    const dupes = new Map<string, Draft[]>();
    for (const d of managed) {
        if (!d.netbox) continue; // already demoted above
        const ref = netboxRef(d.netbox);
        if (ref === null) continue;
        const list = dupes.get(ref);
        if (list) list.push(d);
        else dupes.set(ref, [d]);
    }
    for (const [ref, list] of dupes) {
        let winner = list[0];
        if (list.length > 1) {
            // Prefer the copy that lives inside the container.
            const home = container;
            const inside = home ? list.find(d => isInside(d, home)) : undefined;
            winner = inside ?? list[0];
            for (const d of list) if (d !== winner) adopt(d);
        }
        byRef.set(ref, winner);
    }

    // 4. Make sure the container exists. Appended at the END of the root array:
    //    inserting at the front would displace whatever the user keeps on top.
    if (!container) {
        container = {
            draft: true,
            id: newId(),
            name: options.rootFolderName ?? NETBOX_ROOT_FOLDER_NAME,
            children: [],
            parent: root,
            hadChildren: true,
            netbox: { server, kind: 'root' },
        };
        root.children.push(container);
        report.rootCreated = true;
        changed = true;
    }
    const containerFolder = container;

    /** Where a new NetBox folder goes among its siblings: name-sorted within
     *  its own kind, regions grouped before sites. Existing order is never
     *  rewritten — a manual sort or drag stays put. */
    const insertPos = (parent: Draft, kind: 'region' | 'site', name: string): number => {
        for (let i = 0; i < parent.children.length; i++) {
            const c = parent.children[i];
            if (!isDraft(c)) continue;
            const link = c.netbox;
            if (!link || link.server !== server || link.kind === 'root') continue;
            if (kind === 'region') {
                if (link.kind === 'site') return i;
                if (compareNames(c.name, name) > 0) return i;
            } else if (link.kind === 'site' && compareNames(c.name, name) > 0) {
                return i;
            }
        }
        return parent.children.length;
    };

    const move = (d: Draft, to: Draft): void => {
        const from = d.parent;
        if (from) {
            const i = from.children.indexOf(d);
            if (i >= 0) from.children.splice(i, 1);
        }
        to.children.splice(insertPos(to, d.netbox!.kind as 'region' | 'site', d.name), 0, d);
        d.parent = to;
    };

    const upsert = (
        kind: 'region' | 'site',
        objectId: number,
        desiredName: string,
        desiredParent: Draft,
    ): Draft => {
        const ref = `${server}:${kind}:${objectId}`;
        const existing = byRef.get(ref);
        if (!existing) {
            const created: Draft = {
                draft: true,
                id: newId(),
                name: desiredName,
                children: [],
                parent: desiredParent,
                hadChildren: false,
                netbox: { server, kind, objectId },
            };
            desiredParent.children.splice(insertPos(desiredParent, kind, desiredName), 0, created);
            byRef.set(ref, created);
            report.created++;
            changed = true;
            return created;
        }

        // The name is NetBox's, unconditionally. This is why the UI blocks
        // renaming a synced folder: allowing it would ship a control that
        // silently undoes itself on the next sync.
        if (existing.name !== desiredName) {
            existing.name = desiredName;
            report.renamed++;
            changed = true;
        }

        const link = existing.netbox!;
        if (link.missing) {
            existing.netbox = { server: link.server, kind: link.kind, objectId: link.objectId };
            report.unmarkedMissing++;
            changed = true;
        }

        // Placement: NetBox owns the arrangement inside its own container; the
        // user owns everything outside it.
        const current = existing.parent;
        if (current !== desiredParent && !isInside(desiredParent, existing)) {
            if (current && current.netbox?.server === server) {
                move(existing, desiredParent);
                report.moved++;
                changed = true;
            } else {
                // The user dragged this out. Keep renaming it; never move it again.
                report.detached++;
            }
        }
        return existing;
    };

    // 5. Regions, parents before children.
    //
    // The backend already returns them sorted by (depth, id) — a parent must
    // exist before its children are placed. Sorting again here costs nothing
    // and makes this function correct on its own, independent of that contract.
    const knownRegions = new Set(snapshot.regions.map(r => r.id));
    const regionDrafts = new Map<number, Draft>();
    const ordered = [...snapshot.regions].sort((a, b) => a.depth - b.depth || a.id - b.id);
    for (const r of ordered) {
        const parent = r.parentId !== null && knownRegions.has(r.parentId)
            ? regionDrafts.get(r.parentId) ?? containerFolder
            : containerFolder;
        regionDrafts.set(r.id, upsert('region', r.id, r.name, parent));
    }

    // 6. Sites. A site whose region was not returned — NetBox object
    //    permissions can hide a region while still listing its sites — lands at
    //    the container root rather than dangling against a folder that was
    //    never created.
    for (const s of snapshot.sites) {
        const parent = s.regionId !== null && knownRegions.has(s.regionId)
            ? regionDrafts.get(s.regionId) ?? containerFolder
            : containerFolder;
        upsert('site', s.id, siteFolderName(s), parent);
    }

    // 7. Mark what vanished. Never delete: a site folder may hold hosts the
    //    user added, and one mistaken click in NetBox would take them with it.
    const seen = new Set<string>();
    for (const r of snapshot.regions) seen.add(`${server}:region:${r.id}`);
    for (const s of snapshot.sites) seen.add(`${server}:site:${s.id}`);
    for (const d of managed) {
        const link = d.netbox;
        if (!link || link.server !== server || link.kind === 'root') continue;
        const ref = netboxRef(link);
        if (ref === null || seen.has(ref)) continue;
        if (byRef.get(ref) !== d) continue; // a demoted duplicate
        if (link.missing) {
            report.stillMissing++;
            continue;
        }
        d.netbox = { ...link, missing: true, missingSince: options.now };
        report.markedMissing++;
        changed = true;
    }

    report.changed = changed;
    return { tree: changed ? root.children.map(materialize) : tree, report };
}
