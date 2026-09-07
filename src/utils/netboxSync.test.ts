import { describe, it, expect } from 'vitest';
import type { HostTreeNode, NetboxNodeLink, NetboxSnapshot } from '../types/appTypes';
import {
    NETBOX_DEFAULT_SERVER,
    isNetboxNamed,
    isNetboxNode,
    netboxRef,
    reconcileNetboxTree,
    siteFolderName,
} from './netboxSync';

// ── fixtures ───────────────────────────────────────────────────────────────

const SERVER = NETBOX_DEFAULT_SERVER;
const NOW = '2026-01-02T03:04:05.000Z';

/** Deterministic ids, so a created folder can be asserted on by name AND id. */
function idGen(): () => string {
    let n = 0;
    return () => `new-${++n}`;
}

const opts = (over: Partial<{ now: string; rootFolderName: string; newId: () => string }> = {}) => ({
    now: NOW,
    rootFolderName: 'NetBox',
    newId: idGen(),
    ...over,
});

const host = (id: string, name: string, address = '10.0.0.1'): HostTreeNode => ({
    id,
    type: 'host',
    name,
    entry: { protocol: 'ssh', host: address, port: 22 },
});

const folder = (id: string, name: string, children: HostTreeNode[] = []): HostTreeNode => ({
    id,
    type: 'folder',
    name,
    children,
});

const managed = (
    id: string,
    name: string,
    link: Partial<NetboxNodeLink> & Pick<NetboxNodeLink, 'kind'>,
    children: HostTreeNode[] = [],
): HostTreeNode => ({
    id,
    type: 'folder',
    name,
    children,
    netbox: { server: SERVER, ...link },
});

const snapshot = (over: Partial<NetboxSnapshot> = {}): NetboxSnapshot => ({
    serverKey: SERVER,
    siteIdField: 'facility',
    regions: [],
    sites: [],
    ...over,
});

const region = (id: number, name: string, parentId: number | null = null, depth = 0) =>
    ({ id, name, parentId, depth });

const site = (id: number, name: string, regionId: number | null = null, siteId: string | null = null) =>
    ({ id, name, regionId, siteId });

// ── tree helpers for assertions ────────────────────────────────────────────

function find(nodes: HostTreeNode[], name: string): HostTreeNode | undefined {
    for (const n of nodes) {
        if (n.name === name) return n;
        const hit = n.children ? find(n.children, name) : undefined;
        if (hit) return hit;
    }
    return undefined;
}

function findById(nodes: HostTreeNode[], id: string): HostTreeNode | undefined {
    for (const n of nodes) {
        if (n.id === id) return n;
        const hit = n.children ? findById(n.children, id) : undefined;
        if (hit) return hit;
    }
    return undefined;
}

/** The parent's name for a node, or null when it sits at the tree root. */
function parentOf(nodes: HostTreeNode[], name: string, parent: string | null = null): string | null | undefined {
    for (const n of nodes) {
        if (n.name === name) return parent;
        if (n.children) {
            const hit = parentOf(n.children, name, n.name);
            if (hit !== undefined) return hit;
        }
    }
    return undefined;
}

function names(nodes: HostTreeNode[] | undefined): string[] {
    return (nodes ?? []).map(n => n.name);
}

// ── helpers under test ─────────────────────────────────────────────────────

describe('netboxRef', () => {
    it('gives a region and a site with the same NetBox id different keys', () => {
        expect(netboxRef({ server: SERVER, kind: 'region', objectId: 7 }))
            .not.toBe(netboxRef({ server: SERVER, kind: 'site', objectId: 7 }));
    });

    it('gives the container no ref — it mirrors no NetBox object', () => {
        expect(netboxRef({ server: SERVER, kind: 'root' })).toBeNull();
    });

    it('separates the same object id on two different servers', () => {
        expect(netboxRef({ server: 'a', kind: 'site', objectId: 1 }))
            .not.toBe(netboxRef({ server: 'b', kind: 'site', objectId: 1 }));
    });
});

describe('siteFolderName', () => {
    it('puts the code before the name, separated by one space', () => {
        expect(siteFolderName(site(1, 'Example Site', null, 'SITE-01'))).toBe('SITE-01 Example Site');
    });

    it('falls back to the bare name when the site has no code', () => {
        expect(siteFolderName(site(1, 'Example Site'))).toBe('Example Site');
    });

    it('treats a whitespace-only code as absent', () => {
        expect(siteFolderName(site(1, 'Example Site', null, '   '))).toBe('Example Site');
    });
});

describe('isNetboxNode', () => {
    it('is false for a hand-made folder and true for a managed one', () => {
        expect(isNetboxNode(folder('f', 'Mine'))).toBe(false);
        expect(isNetboxNode(managed('f', 'Mine', { kind: 'site', objectId: 1 }))).toBe(true);
    });

    it('is false for a folder belonging to another server', () => {
        const n: HostTreeNode = {
            id: 'f', type: 'folder', name: 'Other',
            netbox: { server: 'other', kind: 'site', objectId: 1 },
        };
        expect(isNetboxNode(n, SERVER)).toBe(false);
    });
});

// ── the reconcile ──────────────────────────────────────────────────────────

describe('reconcileNetboxTree — first run', () => {
    it('creates the container at the END of the root, below the user folders', () => {
        const tree = [folder('u1', 'My hosts'), folder('u2', 'Favourites')];
        const { tree: out, report } = reconcileNetboxTree(tree, snapshot(), opts());

        expect(names(out)).toEqual(['My hosts', 'Favourites', 'NetBox']);
        expect(report.rootCreated).toBe(true);
        expect(report.changed).toBe(true);
    });

    it('nests regions and hangs sites off them', () => {
        const snap = snapshot({
            regions: [region(1, 'Asia'), region(2, 'Japan', 1, 1)],
            sites: [site(10, 'Example Site', 2, 'SITE-01')],
        });
        const { tree: out, report } = reconcileNetboxTree([], snap, opts());

        expect(parentOf(out, 'Asia')).toBe('NetBox');
        expect(parentOf(out, 'Japan')).toBe('Asia');
        expect(parentOf(out, 'SITE-01 Example Site')).toBe('Japan');
        expect(report.created).toBe(3);
        expect(report.regions).toBe(2);
        expect(report.sites).toBe(1);
    });

    it('nests a three-deep region tree given in a shuffled order', () => {
        // The backend sorts by (depth, id), but this function must not depend
        // on that — it is the only thing standing between a permission quirk
        // and a mis-parented tree.
        const snap = snapshot({
            regions: [
                region(3, 'Kanto', 2, 2),
                region(1, 'Asia', null, 0),
                region(2, 'Japan', 1, 1),
            ],
            sites: [site(10, 'Example Site', 3, 'SITE-01')],
        });
        const { tree: out } = reconcileNetboxTree([], snap, opts());

        expect(parentOf(out, 'Asia')).toBe('NetBox');
        expect(parentOf(out, 'Japan')).toBe('Asia');
        expect(parentOf(out, 'Kanto')).toBe('Japan');
        expect(parentOf(out, 'SITE-01 Example Site')).toBe('Kanto');
    });

    it('lands a region whose parent was not returned at the container root', () => {
        const snap = snapshot({ regions: [region(2, 'Japan', 99, 1)] });
        const { tree: out } = reconcileNetboxTree([], snap, opts());
        expect(parentOf(out, 'Japan')).toBe('NetBox');
    });

    it('lands a site whose region was not returned at the container root', () => {
        // NetBox object permissions can hide a region while still listing its
        // sites. Dangling the site would break the whole sync over one object.
        const snap = snapshot({ sites: [site(10, 'Example Site', 99, 'SITE-01')] });
        const { tree: out } = reconcileNetboxTree([], snap, opts());
        expect(parentOf(out, 'SITE-01 Example Site')).toBe('NetBox');
    });

    it('groups regions before sites and name-sorts within each kind', () => {
        const snap = snapshot({
            regions: [region(1, 'Zulu'), region(2, 'Alpha')],
            sites: [site(10, 'Sierra'), site(11, 'Bravo')],
        });
        const { tree: out } = reconcileNetboxTree([], snap, opts());
        const container = find(out, 'NetBox');
        expect(names(container?.children)).toEqual(['Alpha', 'Zulu', 'Bravo', 'Sierra']);
    });
});

describe('reconcileNetboxTree — idempotence', () => {
    it('reports no change and returns the SAME ARRAY on an unchanged re-run', () => {
        const snap = snapshot({
            regions: [region(1, 'Asia')],
            sites: [site(10, 'Example Site', 1, 'SITE-01')],
        });
        const first = reconcileNetboxTree([], snap, opts());
        const second = reconcileNetboxTree(first.tree, snap, opts());

        expect(second.report.changed).toBe(false);
        expect(second.tree).toBe(first.tree);
        expect(second.report.created).toBe(0);
        expect(second.report.renamed).toBe(0);
        expect(second.report.moved).toBe(0);
        expect(second.report.rootCreated).toBe(false);
    });

    it('does not re-create the container when one already exists', () => {
        const tree = [managed('c', 'NetBox', { kind: 'root' })];
        const { report } = reconcileNetboxTree(tree, snapshot(), opts());
        expect(report.rootCreated).toBe(false);
        expect(report.changed).toBe(false);
    });

    it('never renames a container the user renamed', () => {
        const tree = [managed('c', 'Our NetBox', { kind: 'root' })];
        const { tree: out, report } = reconcileNetboxTree(tree, snapshot(), opts());
        expect(names(out)).toEqual(['Our NetBox']);
        expect(report.renamed).toBe(0);
    });
});

describe('reconcileNetboxTree — the ownership split', () => {
    it('carries the user hosts inside a site folder through, as the SAME objects', () => {
        const web = host('h1', 'web-01');
        const db = host('h2', 'db-01');
        const tree = [
            managed('c', 'NetBox', { kind: 'root' }, [
                managed('s10', 'OLD Example Site', { kind: 'site', objectId: 10 }, [web, db]),
            ]),
        ];
        const snap = snapshot({ sites: [site(10, 'Example Site', null, 'SITE-01')] });
        const { tree: out, report } = reconcileNetboxTree(tree, snap, opts());

        const site10 = findById(out, 's10');
        expect(site10?.name).toBe('SITE-01 Example Site');
        expect(report.renamed).toBe(1);
        // Same objects, same order — the sync never reads a folder's children.
        expect(site10?.children).toHaveLength(2);
        expect(site10?.children?.[0]).toBe(web);
        expect(site10?.children?.[1]).toBe(db);
    });

    it('overwrites a name the user changed by hand', () => {
        // This is why the UI blocks renaming a synced folder: allowing it would
        // ship a control that silently undoes itself on the next sync.
        const tree = [
            managed('c', 'NetBox', { kind: 'root' }, [
                managed('s10', 'my own label', { kind: 'site', objectId: 10 }),
            ]),
        ];
        const snap = snapshot({ sites: [site(10, 'Example Site', null, 'SITE-01')] });
        const { tree: out, report } = reconcileNetboxTree(tree, snap, opts());

        expect(findById(out, 's10')?.name).toBe('SITE-01 Example Site');
        expect(report.renamed).toBe(1);
    });

    it('re-parents a site inside the container when its region changed', () => {
        const web = host('h1', 'web-01');
        const tree = [
            managed('c', 'NetBox', { kind: 'root' }, [
                managed('r1', 'Asia', { kind: 'region', objectId: 1 }, [
                    managed('s10', 'Example Site', { kind: 'site', objectId: 10 }, [web]),
                ]),
                managed('r2', 'Europe', { kind: 'region', objectId: 2 }),
            ]),
        ];
        const snap = snapshot({
            siteIdField: null,
            regions: [region(1, 'Asia'), region(2, 'Europe')],
            sites: [site(10, 'Example Site', 2)],
        });
        const { tree: out, report } = reconcileNetboxTree(tree, snap, opts());

        expect(parentOf(out, 'Example Site')).toBe('Europe');
        expect(report.moved).toBe(1);
        expect(findById(out, 's10')?.children?.[0]).toBe(web);
    });

    it('leaves a folder the user dragged OUT of the container where it is', () => {
        const tree = [
            folder('u1', 'My hosts', [
                managed('s10', 'Example Site', { kind: 'site', objectId: 10 }),
            ]),
            managed('c', 'NetBox', { kind: 'root' }, [
                managed('r1', 'Asia', { kind: 'region', objectId: 1 }),
            ]),
        ];
        const snap = snapshot({
            regions: [region(1, 'Asia')],
            sites: [site(10, 'Example Site', 1, 'SITE-01')],
        });
        const { tree: out, report } = reconcileNetboxTree(tree, snap, opts());

        // Still under the user's folder, but the name is still NetBox's.
        expect(parentOf(out, 'SITE-01 Example Site')).toBe('My hosts');
        expect(report.detached).toBe(1);
        expect(report.moved).toBe(0);
        expect(report.renamed).toBe(1);
    });

    it('keeps a detached folder detached on every later run', () => {
        const tree = [
            folder('u1', 'My hosts', [
                managed('s10', 'SITE-01 Example Site', { kind: 'site', objectId: 10 }),
            ]),
            managed('c', 'NetBox', { kind: 'root' }),
        ];
        const snap = snapshot({ sites: [site(10, 'Example Site', null, 'SITE-01')] });
        const first = reconcileNetboxTree(tree, snap, opts());
        expect(first.report.changed).toBe(false);

        const second = reconcileNetboxTree(first.tree, snap, opts());
        expect(parentOf(second.tree, 'SITE-01 Example Site')).toBe('My hosts');
        expect(second.report.detached).toBe(1);
        expect(second.report.changed).toBe(false);
    });

    it('never rewrites an existing sibling order', () => {
        // The user sorted or dragged these; the sync only chooses where NEW
        // folders land.
        const tree = [
            managed('c', 'NetBox', { kind: 'root' }, [
                managed('s11', 'Zulu', { kind: 'site', objectId: 11 }),
                managed('s10', 'Alpha', { kind: 'site', objectId: 10 }),
            ]),
        ];
        const snap = snapshot({
            siteIdField: null,
            sites: [site(10, 'Alpha'), site(11, 'Zulu')],
        });
        const { tree: out, report } = reconcileNetboxTree(tree, snap, opts());

        expect(names(find(out, 'NetBox')?.children)).toEqual(['Zulu', 'Alpha']);
        expect(report.changed).toBe(false);
    });

    it('leaves a user folder inside the container alone when inserting', () => {
        const tree = [
            managed('c', 'NetBox', { kind: 'root' }, [folder('u1', 'Scratch')]),
        ];
        const snap = snapshot({ siteIdField: null, sites: [site(10, 'Alpha')] });
        const { tree: out } = reconcileNetboxTree(tree, snap, opts());

        expect(names(find(out, 'NetBox')?.children)).toEqual(['Scratch', 'Alpha']);
    });

    it('never touches a host node anywhere in the tree', () => {
        const loose = host('h9', 'loose-box');
        const tree = [loose, managed('c', 'NetBox', { kind: 'root' })];
        const snap = snapshot({ sites: [site(10, 'Example Site')] });
        const { tree: out } = reconcileNetboxTree(tree, snap, opts());

        expect(out[0]).toBe(loose);
    });
});

describe('reconcileNetboxTree — objects that vanish', () => {
    const existing = (): HostTreeNode[] => [
        managed('c', 'NetBox', { kind: 'root' }, [
            managed('r1', 'Asia', { kind: 'region', objectId: 1 }, [
                managed('s10', 'SITE-01 Example Site', { kind: 'site', objectId: 10 }, [
                    host('h1', 'web-01'),
                ]),
            ]),
        ]),
    ];

    it('marks a vanished site instead of deleting it, keeping its hosts', () => {
        const snap = snapshot({ regions: [region(1, 'Asia')] });
        const { tree: out, report } = reconcileNetboxTree(existing(), snap, opts());

        const gone = findById(out, 's10');
        expect(gone).toBeDefined();
        expect(gone?.netbox?.missing).toBe(true);
        expect(gone?.netbox?.missingSince).toBe(NOW);
        expect(gone?.children).toHaveLength(1);
        expect(report.markedMissing).toBe(1);
        expect(report.stillMissing).toBe(0);
    });

    it('keeps a whole vanished region subtree, marking each node', () => {
        const { tree: out, report } = reconcileNetboxTree(existing(), snapshot(), opts());

        expect(findById(out, 'r1')?.netbox?.missing).toBe(true);
        expect(findById(out, 's10')?.netbox?.missing).toBe(true);
        expect(findById(out, 'h1')).toBeDefined();
        expect(report.markedMissing).toBe(2);
    });

    it('does not re-mark on the next run, and reports it as still missing', () => {
        const snap = snapshot({ regions: [region(1, 'Asia')] });
        const first = reconcileNetboxTree(existing(), snap, opts());
        const second = reconcileNetboxTree(first.tree, snap, opts());

        expect(second.report.markedMissing).toBe(0);
        expect(second.report.stillMissing).toBe(1);
        expect(second.report.changed).toBe(false);
        expect(second.tree).toBe(first.tree);
    });

    it('clears the mark when the object comes back', () => {
        const snap = snapshot({ regions: [region(1, 'Asia')] });
        const first = reconcileNetboxTree(existing(), snap, opts());

        const back = snapshot({
            regions: [region(1, 'Asia')],
            sites: [site(10, 'Example Site', 1, 'SITE-01')],
        });
        const second = reconcileNetboxTree(first.tree, back, opts());

        const node = findById(second.tree, 's10');
        expect(node?.netbox?.missing).toBeUndefined();
        expect(node?.netbox?.missingSince).toBeUndefined();
        expect(second.report.unmarkedMissing).toBe(1);
    });
});

describe('reconcileNetboxTree — duplicates from an imported tree', () => {
    it('keeps the copy inside the container and demotes the other', () => {
        // `importData` reassigns every id, so an exported-and-reimported NetBox
        // subtree arrives as a second set of nodes carrying the same markers.
        const tree = [
            folder('u1', 'Imported', [
                managed('dup', 'SITE-01 Example Site', { kind: 'site', objectId: 10 }, [
                    host('h9', 'kept-host'),
                ]),
            ]),
            managed('c', 'NetBox', { kind: 'root' }, [
                managed('s10', 'SITE-01 Example Site', { kind: 'site', objectId: 10 }),
            ]),
        ];
        const snap = snapshot({ sites: [site(10, 'Example Site', null, 'SITE-01')] });
        const { tree: out, report } = reconcileNetboxTree(tree, snap, opts());

        expect(report.duplicatesAdopted).toBe(1);
        // The loser keeps its id, name, position and children — it is just an
        // ordinary folder now.
        const loser = findById(out, 'dup');
        expect(loser?.netbox).toBeUndefined();
        expect(loser?.name).toBe('SITE-01 Example Site');
        expect(loser?.children?.[0]?.id).toBe('h9');
        expect(parentOf(out, 'SITE-01 Example Site')).toBe('Imported');
        // The winner is still managed.
        expect(findById(out, 's10')?.netbox?.objectId).toBe(10);
    });

    it('resolves duplicates once — a second run finds none', () => {
        const tree = [
            folder('u1', 'Imported', [
                managed('dup', 'Alpha', { kind: 'site', objectId: 10 }),
            ]),
            managed('c', 'NetBox', { kind: 'root' }, [
                managed('s10', 'Alpha', { kind: 'site', objectId: 10 }),
            ]),
        ];
        const snap = snapshot({ siteIdField: null, sites: [site(10, 'Alpha')] });
        const first = reconcileNetboxTree(tree, snap, opts());
        const second = reconcileNetboxTree(first.tree, snap, opts());

        expect(second.report.duplicatesAdopted).toBe(0);
        expect(second.report.changed).toBe(false);
    });

    it('elects one container and demotes the extra', () => {
        const tree = [
            managed('c1', 'NetBox', { kind: 'root' }),
            folder('u1', 'Imported', [managed('c2', 'NetBox', { kind: 'root' })]),
        ];
        const { tree: out, report } = reconcileNetboxTree(tree, snapshot(), opts());

        expect(report.duplicatesAdopted).toBe(1);
        expect(findById(out, 'c1')?.netbox?.kind).toBe('root');
        expect(findById(out, 'c2')?.netbox).toBeUndefined();
        expect(report.rootCreated).toBe(false);
    });

    it('does not mark a demoted duplicate as missing', () => {
        const tree = [
            folder('u1', 'Imported', [
                managed('dup', 'Alpha', { kind: 'site', objectId: 10 }),
            ]),
            managed('c', 'NetBox', { kind: 'root' }, [
                managed('s10', 'Alpha', { kind: 'site', objectId: 10 }),
            ]),
        ];
        // Object 10 is gone from NetBox as well.
        const { tree: out, report } = reconcileNetboxTree(tree, snapshot(), opts());

        expect(findById(out, 'dup')?.netbox).toBeUndefined();
        expect(findById(out, 's10')?.netbox?.missing).toBe(true);
        expect(report.markedMissing).toBe(1);
    });
});

describe('reconcileNetboxTree — folders belonging to another server', () => {
    it('leaves them completely alone', () => {
        const other: HostTreeNode = {
            id: 'x', type: 'folder', name: 'Other site',
            netbox: { server: 'other-netbox', kind: 'site', objectId: 10 },
        };
        const tree = [other, managed('c', 'NetBox', { kind: 'root' })];
        const snap = snapshot({ siteIdField: null, sites: [site(10, 'Example Site')] });
        const { tree: out, report } = reconcileNetboxTree(tree, snap, opts());

        // Not renamed, not moved, not demoted, not marked missing.
        const untouched = findById(out, 'x');
        expect(untouched?.name).toBe('Other site');
        expect(untouched?.netbox?.server).toBe('other-netbox');
        expect(untouched?.netbox?.missing).toBeUndefined();
        expect(report.duplicatesAdopted).toBe(0);
        expect(report.markedMissing).toBe(0);
        // The site was created fresh, under our own container.
        expect(parentOf(out, 'Example Site')).toBe('NetBox');
    });
});

describe('reconcileNetboxTree — the Site ID report', () => {
    it('counts sites with no value in the configured field', () => {
        const snap = snapshot({
            siteIdField: 'facility',
            sites: [
                site(1, 'A', null, 'SITE-01'),
                site(2, 'B'),
                site(3, 'C', null, '  '),
            ],
        });
        const { report } = reconcileNetboxTree([], snap, opts());
        expect(report.sites).toBe(3);
        expect(report.sitesWithoutSiteId).toBe(2);
    });

    it('counts none when no Site ID field is configured', () => {
        // Nothing was asked for, so nothing is missing.
        const snap = snapshot({ siteIdField: null, sites: [site(1, 'A'), site(2, 'B')] });
        const { report } = reconcileNetboxTree([], snap, opts());
        expect(report.sitesWithoutSiteId).toBe(0);
    });
});

describe('isNetboxNamed', () => {
    it('is true for the folders whose names the sync overwrites', () => {
        expect(isNetboxNamed(managed('r', 'Asia', { kind: 'region', objectId: 1 }))).toBe(true);
        expect(isNetboxNamed(managed('s', 'Site', { kind: 'site', objectId: 10 }))).toBe(true);
    });

    it('is false for the container, whose name belongs to the user', () => {
        expect(isNetboxNamed(managed('c', 'NetBox', { kind: 'root' }))).toBe(false);
    });

    it('is false for a hand-made folder and for a host', () => {
        expect(isNetboxNamed(folder('f', 'Mine'))).toBe(false);
        expect(isNetboxNamed(host('h', 'web-01'))).toBe(false);
    });
});
