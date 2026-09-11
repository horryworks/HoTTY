import { describe, it, expect } from 'vitest';
import { summarizeFolder } from './folderSummary';
import type { HostTreeNode } from '../types/appTypes';

const host = (name: string, address: string): HostTreeNode => ({
    id: `h-${name}`,
    type: 'host',
    name,
    entry: { protocol: 'ssh', host: address, port: 22 },
});

const sub = (name: string, children: HostTreeNode[] = []): HostTreeNode => ({
    id: `f-${name}`,
    type: 'folder',
    name,
    children,
});

const site = (children: HostTreeNode[], prefixes?: string[]): HostTreeNode => ({
    id: 'site',
    type: 'folder',
    name: 'tok Tokyo',
    children,
    netbox: {
        server: 'default',
        kind: 'site',
        objectId: 6,
        ...(prefixes ? { prefixes } : {}),
    },
});

describe('summarizeFolder', () => {
    it('counts only the folder it was given, never its grandchildren', () => {
        const folder = site([
            host('web-01', '10.6.1.10'),
            sub('rack-a', [host('buried', '10.6.1.20')]),
        ], ['10.6.0.0/16']);
        const s = summarizeFolder(folder);
        expect(s.hosts).toHaveLength(1);
        expect(s.folders).toHaveLength(1);
        expect(s.hosts[0].node.name).toBe('web-01');
    });

    it('marks nothing at all when the folder carries no prefix', () => {
        // Every hand-made folder is this case. A warning here would put a mark
        // on most of the tree and mean nothing.
        const s = summarizeFolder(sub('Lab', [host('a', '10.6.1.10'), host('b', '203.0.113.9')]));
        expect(s.hosts.map(h => h.range)).toEqual(['unknown', 'unknown']);
        expect(s.outOfRangeCount).toBe(0);
    });

    it('marks a host outside every prefix', () => {
        const s = summarizeFolder(site([host('old-01', '172.16.0.5')], ['10.6.0.0/16']));
        expect(s.hosts[0].range).toBe('out');
        expect(s.outOfRangeCount).toBe(1);
    });

    it('leaves a host inside any one prefix unmarked', () => {
        const s = summarizeFolder(
            site([host('a', '10.6.1.10'), host('b', '192.0.2.7')], ['10.6.0.0/16', '192.0.2.0/24']),
        );
        expect(s.hosts.map(h => h.range)).toEqual(['in', 'in']);
        expect(s.outOfRangeCount).toBe(0);
    });

    it('never marks something it could not read as an address', () => {
        // `entry.host` is a free string. Refusing to judge is the fail-safe.
        const s = summarizeFolder(
            site([host('a', 'web-01.example.com'), host('b', 'alice@10.6.1.10'), host('c', '')], [
                '10.6.0.0/16',
            ]),
        );
        expect(s.hosts.map(h => h.range)).toEqual(['unknown', 'unknown', 'unknown']);
        expect(s.outOfRangeCount).toBe(0);
    });

    it('does not let an IPv4 prefix claim an IPv6 host', () => {
        const s = summarizeFolder(site([host('v6', '2001:db8::1')], ['10.6.0.0/16']));
        expect(s.hosts[0].range).toBe('out');
    });

    it('does not let an IPv6 prefix claim an IPv4 host', () => {
        const s = summarizeFolder(site([host('v4', '10.6.1.10')], ['2001:db8::/32']));
        expect(s.hosts[0].range).toBe('out');
    });

    it('keeps judging on the prefixes it could read when one is unreadable', () => {
        const s = summarizeFolder(site([host('a', '10.6.1.10')], ['not-a-prefix', '10.6.0.0/16']));
        expect(s.unparsedPrefixes).toEqual(['not-a-prefix']);
        expect(s.prefixes).toHaveLength(1);
        expect(s.hosts[0].range).toBe('in');
    });

    it('reports an empty folder as empty rather than throwing', () => {
        const s = summarizeFolder({ id: 'e', type: 'folder', name: 'Empty' });
        expect(s.folders).toEqual([]);
        expect(s.hosts).toEqual([]);
        expect(s.prefixes).toEqual([]);
    });

    it('keeps children in tree order', () => {
        const s = summarizeFolder(site([host('z', '10.6.1.1'), host('a', '10.6.1.2')], ['10.6.0.0/16']));
        expect(s.hosts.map(h => h.node.name)).toEqual(['z', 'a']);
    });
});
