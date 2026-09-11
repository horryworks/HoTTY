import { describe, it, expect } from 'vitest';
import type { HostTreeNode, NetboxNodeLink } from '../types/appTypes';
import { NETBOX_DEFAULT_SERVER } from './netboxSync';
import {
    collectPrefixFolders,
    planPlacements,
    suggestFolderForHost,
} from './netboxPlacement';

const SERVER = NETBOX_DEFAULT_SERVER;

const host = (id: string, name: string, address: string): HostTreeNode => ({
    id,
    type: 'host',
    name,
    entry: { protocol: 'ssh', host: address, port: 22 },
});

const folder = (id: string, name: string, children: HostTreeNode[] = []): HostTreeNode => ({
    id, type: 'folder', name, children,
});

const site = (
    id: string,
    name: string,
    prefixes: string[],
    children: HostTreeNode[] = [],
    over: Partial<NetboxNodeLink> = {},
): HostTreeNode => ({
    id,
    type: 'folder',
    name,
    children,
    netbox: { server: SERVER, kind: 'site', objectId: Number(id.replace(/[^0-9]/g, '')) || 1, prefixes, ...over },
});

const regionFolder = (id: string, name: string, prefixes: string[], children: HostTreeNode[] = []): HostTreeNode => ({
    id,
    type: 'folder',
    name,
    children,
    netbox: { server: SERVER, kind: 'region', objectId: 99, prefixes },
});

describe('collectPrefixFolders', () => {
    it('finds a site folder inside the container', () => {
        const tree = [
            folder('c', 'NetBox', [site('s1', 'TOK Tokyo', ['10.1.0.0/16'])]),
        ];
        tree[0].netbox = { server: SERVER, kind: 'root' };
        const found = collectPrefixFolders(tree);
        expect(found.map(f => f.name)).toEqual(['TOK Tokyo']);
        expect(found[0].kind).toBe('site');
    });

    it('finds a folder the user dragged out of the container', () => {
        // The marker rides along and NetBox still names it, so it is still
        // that site — refusing to match it would punish a deliberate move.
        const tree = [site('s1', 'TOK Tokyo', ['10.1.0.0/16'])];
        expect(collectPrefixFolders(tree)).toHaveLength(1);
    });

    it('skips a folder NetBox no longer knows about', () => {
        // Suggesting a site that was deleted upstream is not a suggestion.
        const tree = [site('s1', 'TOK Tokyo', ['10.1.0.0/16'], [], { missing: true })];
        expect(collectPrefixFolders(tree)).toHaveLength(0);
    });

    it('returns nothing for a tree with no NetBox prefixes at all', () => {
        const tree = [folder('f', 'Mine', [host('h', 'web-01', '10.1.0.1')])];
        expect(collectPrefixFolders(tree)).toHaveLength(0);
    });

    it('skips prefix text it cannot read, rather than throwing', () => {
        const tree = [site('s1', 'TOK Tokyo', ['not a prefix', '10.1.0.0/16'])];
        expect(collectPrefixFolders(tree)).toHaveLength(1);
    });

    it('narrows to a scope subtree when one is given', () => {
        const tree = [
            folder('a', 'Asia', [site('s1', 'TOK Tokyo', ['10.1.0.0/16'])]),
            folder('e', 'EMEA', [site('s2', 'LON London', ['10.2.0.0/16'])]),
        ];
        expect(collectPrefixFolders(tree, 'a').map(f => f.name)).toEqual(['TOK Tokyo']);
        expect(collectPrefixFolders(tree)).toHaveLength(2);
    });

    it('lists one entry per prefix on a folder', () => {
        const tree = [site('s1', 'TOK Tokyo', ['10.1.0.0/16', '10.9.0.0/16'])];
        expect(collectPrefixFolders(tree)).toHaveLength(2);
    });
});

describe('suggestFolderForHost', () => {
    const folders = collectPrefixFolders([
        regionFolder('r1', 'Asia', ['10.0.0.0/8'], [
            site('s1', 'TOK Tokyo', ['10.1.0.0/16']),
            site('s2', 'OSA Osaka', ['10.2.0.0/16']),
        ]),
    ]);

    it('says so when nothing in the tree carries a prefix', () => {
        // Distinct from `unmatched`: the UI must show nothing at all here.
        expect(suggestFolderForHost([], '10.1.0.1')).toEqual({ kind: 'noPrefixes' });
    });

    it('says so when the address is not an IP literal, without resolving anything', () => {
        expect(suggestFolderForHost(folders, 'router1.example.com').kind).toBe('notAnAddress');
        expect(suggestFolderForHost(folders, 'alice@10.1.0.1').kind).toBe('notAnAddress');
        expect(suggestFolderForHost(folders, '').kind).toBe('notAnAddress');
    });

    it('picks the longest matching prefix', () => {
        const r = suggestFolderForHost(folders, '10.1.0.9');
        expect(r.kind === 'one' && r.folder.name).toBe('TOK Tokyo');
    });

    it('prefers a site /24 over a region /16 because it is narrower, not because it is a site', () => {
        const mixed = collectPrefixFolders([
            regionFolder('r1', 'Asia', ['10.1.0.0/16']),
            site('s1', 'TOK Tokyo', ['10.1.5.0/24']),
        ]);
        const inSite = suggestFolderForHost(mixed, '10.1.5.9');
        expect(inSite.kind === 'one' && inSite.folder.name).toBe('TOK Tokyo');
        // …and outside the /24 the region wins, on the same rule.
        const inRegion = suggestFolderForHost(mixed, '10.1.6.9');
        expect(inRegion.kind === 'one' && inRegion.folder.name).toBe('Asia');
    });

    it('falls back to the region when no site claims the address', () => {
        const r = suggestFolderForHost(folders, '10.9.0.1');
        expect(r.kind === 'one' && r.folder.name).toBe('Asia');
    });

    it('refuses to choose between two folders claiming the same network', () => {
        // Reusing 192.168.1.0/24 at every site is common; picking one would
        // hide that rather than surface it.
        const dup = collectPrefixFolders([
            site('s1', 'TOK Tokyo', ['192.168.1.0/24']),
            site('s2', 'OSA Osaka', ['192.168.1.0/24']),
        ]);
        const r = suggestFolderForHost(dup, '192.168.1.9');
        expect(r.kind).toBe('ambiguous');
        expect(r.kind === 'ambiguous' && r.folders.map(f => f.name)).toEqual(['OSA Osaka', 'TOK Tokyo']);
    });

    it('refuses to choose between a region and a site at the same mask length', () => {
        const tie = collectPrefixFolders([
            regionFolder('r1', 'Asia', ['10.1.0.0/16']),
            site('s1', 'TOK Tokyo', ['10.1.0.0/16']),
        ]);
        expect(suggestFolderForHost(tie, '10.1.0.9').kind).toBe('ambiguous');
    });

    it('reports nothing matched when the address is outside every prefix', () => {
        expect(suggestFolderForHost(folders, '203.0.113.9').kind).toBe('unmatched');
    });

    it('never matches an IPv4 host against an IPv6 prefix', () => {
        const v6 = collectPrefixFolders([site('s1', 'TOK Tokyo', ['::/0'])]);
        expect(suggestFolderForHost(v6, '10.1.0.1').kind).toBe('unmatched');
    });

    it('matches an IPv6 host written in a different but equal form', () => {
        const v6 = collectPrefixFolders([site('s1', 'TOK Tokyo', ['2001:db8::/32'])]);
        const r = suggestFolderForHost(v6, '2001:0DB8:0000::0001');
        expect(r.kind === 'one' && r.folder.name).toBe('TOK Tokyo');
    });

    it('reports the prefix that matched, so the UI can show it', () => {
        const r = suggestFolderForHost(folders, '10.1.0.9');
        expect(r.kind === 'one' && r.folder.prefix.bits).toBe(16);
    });
});

describe('planPlacements', () => {
    function tree(): HostTreeNode[] {
        return [
            site('s1', 'TOK Tokyo', ['10.1.0.0/16'], [host('h1', 'tokyo-01', '10.1.0.1')]),
            site('s2', 'OSA Osaka', ['10.2.0.0/16']),
            folder('inbox', 'Inbox', [
                host('h2', 'osaka-01', '10.2.0.1'),
                host('h3', 'by-name', 'router1.example.com'),
                host('h4', 'nowhere', '203.0.113.9'),
            ]),
        ];
    }

    it('leaves a host that is already in its matched folder out of the move list', () => {
        const t = tree();
        const plan = planPlacements(t, null, collectPrefixFolders(t));
        expect(plan.move.map(m => m.host.name)).toEqual(['osaka-01']);
        expect(plan.alreadyPlaced).toBe(1);
    });

    it('splits the scope into moved, already placed, ambiguous and unmatched', () => {
        const t = [
            ...tree(),
            site('s3', 'KYO Kyoto', ['192.168.1.0/24'], [host('h5', 'dup-a', '192.168.1.5')]),
            site('s4', 'NAG Nagoya', ['192.168.1.0/24']),
        ];
        const plan = planPlacements(t, null, collectPrefixFolders(t));
        expect(plan.move).toHaveLength(1);
        expect(plan.alreadyPlaced).toBe(1);
        expect(plan.ambiguous.map(a => a.host.name)).toEqual(['dup-a']);
        expect(plan.unmatched.map(u => u.host.name).sort()).toEqual(['by-name', 'nowhere']);
    });

    it('gives a reason for a host whose address is a name', () => {
        const t = tree();
        const plan = planPlacements(t, null, collectPrefixFolders(t));
        const byName = plan.unmatched.find(u => u.host.name === 'by-name');
        expect(byName?.reason).toBe('notAnAddress');
        expect(plan.unmatched.find(u => u.host.name === 'nowhere')?.reason).toBe('noMatch');
    });

    it('only looks at hosts under the scope folder', () => {
        const t = tree();
        const plan = planPlacements(t, 'inbox', collectPrefixFolders(t));
        expect(plan.move.map(m => m.host.name)).toEqual(['osaka-01']);
        expect(plan.alreadyPlaced).toBe(0);
    });

    it('records where each host is moving from', () => {
        const t = tree();
        const plan = planPlacements(t, null, collectPrefixFolders(t));
        expect(plan.move[0].from).toBe('inbox');
        expect(plan.move[0].folder.id).toBe('s2');
    });

    it('says plainly when nothing in scope carries a prefix', () => {
        const t = [folder('f', 'Mine', [host('h', 'web-01', '10.1.0.1')])];
        const plan = planPlacements(t, null, collectPrefixFolders(t));
        expect(plan.anyPrefixes).toBe(false);
        expect(plan.move).toHaveLength(0);
    });

    it('never plans a move for a folder node', () => {
        const t = tree();
        const plan = planPlacements(t, null, collectPrefixFolders(t));
        for (const m of plan.move) expect(m.host.type).toBe('host');
    });
});
