import { describe, it, expect } from 'vitest';
import type { NetboxSnapshot } from '../types/appTypes';
import { reconcileNetboxTree } from './netboxSync';
import { collectPrefixFolders, suggestFolderForHost } from './netboxPlacement';

/**
 * The whole chain, from the shape the backend actually sends to the folder a
 * host is offered.
 *
 * Written after the feature reached a real NetBox and did nothing at all. Each
 * piece had passing tests; what none of them covered was the joins between
 * them, using the exact payload a NetBox 4.6 returns. This file exists to make
 * "every part works but the feature does not" a failing test rather than a
 * report from the user.
 *
 * The snapshot below mirrors a verified live response: two sites, three
 * regions, four prefixes, every one of them carrying `scopeType: 'site'` — 4.x
 * sends `scope_type` / `scope_id` and leaves the legacy `site` field null.
 */
describe('NetBox placement, end to end', () => {
    const snapshot: NetboxSnapshot = {
        serverKey: 'default',
        siteIdField: 'slug',
        regions: [
            { id: 1, name: 'Asia', parentId: null, depth: 0 },
            { id: 2, name: 'Japan', parentId: 1, depth: 1 },
            { id: 3, name: 'EMEA', parentId: null, depth: 0 },
        ],
        sites: [
            { id: 6, name: 'Tokyo', regionId: 2, siteId: 'tok' },
            { id: 7, name: 'Osaka', regionId: 2, siteId: 'osa' },
        ],
        prefixes: [
            { prefix: '10.6.0.0/16', scopeKind: 'site', scopeId: 6 },
            { prefix: '10.6.1.0/24', scopeKind: 'site', scopeId: 6 },
            { prefix: '10.7.0.0/16', scopeKind: 'site', scopeId: 7 },
            { prefix: '192.168.1.0/24', scopeKind: 'site', scopeId: 7 },
        ],
        prefixesUnavailable: null,
        prefixesSkipped: 0,
    };

    function syncedTree() {
        let n = 0;
        return reconcileNetboxTree([], snapshot, {
            now: '2026-09-11T00:00:00.000Z',
            newId: () => `n${++n}`,
        });
    }

    it('a first sync puts the prefixes on the site folders it just created', () => {
        const { report } = syncedTree();
        expect(report.created).toBe(5); // 3 regions + 2 sites
        expect(report.prefixes).toBe(4);
        expect(report.prefixesUnparsed).toBe(0);
        expect(report.foldersWithPrefixes).toBe(2);
    });

    it('the folders the reconcile wrote are the folders the matcher reads', () => {
        // The join that was never covered: `netboxRef` keys on the write side
        // and `collectPrefixFolders` on the read side must agree.
        const { tree } = syncedTree();
        expect(collectPrefixFolders(tree)).toHaveLength(4);
    });

    it('an address lands in the site NetBox says owns it', () => {
        const { tree } = syncedTree();
        const folders = collectPrefixFolders(tree);
        const r = suggestFolderForHost(folders, '10.7.0.9');
        expect(r.kind === 'one' && r.folder.name).toBe('osa Osaka');
    });

    it('the narrower prefix wins inside the same site', () => {
        const { tree } = syncedTree();
        const folders = collectPrefixFolders(tree);
        const r = suggestFolderForHost(folders, '10.6.1.9');
        expect(r.kind === 'one' && r.folder.prefix.bits).toBe(24);
    });

    it('a second sync of the same data changes nothing', () => {
        const first = syncedTree();
        const second = reconcileNetboxTree(first.tree, snapshot, {
            now: '2026-09-11T01:00:00.000Z',
        });
        expect(second.report.changed).toBe(false);
        expect(second.tree).toBe(first.tree);
    });

    it('losing permission to read prefixes keeps the ones already matched', () => {
        const first = syncedTree();
        const denied = reconcileNetboxTree(
            first.tree,
            { ...snapshot, prefixes: null, prefixesUnavailable: 'denied' },
            { now: '2026-09-11T01:00:00.000Z' },
        );
        expect(collectPrefixFolders(denied.tree)).toHaveLength(4);
        expect(denied.report.changed).toBe(false);
    });

    it('a 3.x snapshot with no prefix list at all does not throw', () => {
        // An older backend omits the three fields; `undefined` must read as
        // "no authoritative list", exactly like `null`.
        const legacy = {
            serverKey: 'default',
            siteIdField: null,
            regions: [],
            sites: [{ id: 6, name: 'Tokyo', regionId: null, siteId: null }],
        } as unknown as NetboxSnapshot;
        const { report } = reconcileNetboxTree([], legacy, { now: '2026-09-11T00:00:00.000Z' });
        expect(report.prefixes).toBe(0);
        expect(report.prefixesUnavailable).toBeNull();
    });
});
