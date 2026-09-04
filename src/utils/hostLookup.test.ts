import { describe, it, expect } from 'vitest';
import { findHostNodesByAddress } from './hostLookup';
import type { HostTreeNode } from '../types/appTypes';

const host = (id: string, name: string, entry: Partial<HostTreeNode['entry']> & { host: string }): HostTreeNode => ({
    id,
    type: 'host',
    name,
    entry: { protocol: 'ssh', port: 22, ...entry } as HostTreeNode['entry'],
});

const tree: HostTreeNode[] = [
    {
        id: 'f1',
        type: 'folder',
        name: 'Site A',
        children: [
            host('n1', 'core-01', { host: '192.0.2.1', username: 'alice', password: '[SAFE]x' }),
            host('n2', 'sw-01', { host: '192.0.2.10' }),
            host('n3', 'sw-01-telnet', { host: '192.0.2.10', protocol: 'telnet', port: 23 }),
        ],
    },
    host('n4', 'SW-01 mgmt', { host: '192.0.2.10', port: 2222 }),
    host('n5', 'vm-01', { host: 'vm-01', protocol: 'gcloud-iap' }),
];

describe('findHostNodesByAddress', () => {
    it('returns none for an empty or unknown host', () => {
        expect(findHostNodesByAddress(tree, '')).toEqual({ kind: 'none' });
        expect(findHostNodesByAddress(tree, '   ')).toEqual({ kind: 'none' });
        expect(findHostNodesByAddress(tree, '203.0.113.9')).toEqual({ kind: 'none' });
    });

    it('matches case-insensitively and ignores surrounding whitespace', () => {
        const r = findHostNodesByAddress(tree, '  192.0.2.1 ');
        expect(r.kind).toBe('one');
        if (r.kind === 'one') expect(r.node.id).toBe('n1');
    });

    it('excludes GCP IAP entries (they carry no reusable credentials)', () => {
        expect(findHostNodesByAddress(tree, 'vm-01')).toEqual({ kind: 'none' });
    });

    it('filters strictly by protocol when given', () => {
        const r = findHostNodesByAddress(tree, '192.0.2.10', { protocol: 'telnet' });
        expect(r.kind).toBe('one');
        if (r.kind === 'one') expect(r.node.id).toBe('n3');
        // An SSH-only host never borrows a Telnet entry.
        expect(findHostNodesByAddress(tree, '192.0.2.1', { protocol: 'telnet' })).toEqual({ kind: 'none' });
    });

    it('reports ambiguity when several entries match and no hint narrows them', () => {
        const r = findHostNodesByAddress(tree, '192.0.2.10', { protocol: 'ssh' });
        expect(r.kind).toBe('ambiguous');
        if (r.kind === 'ambiguous') expect(r.nodes.map((n) => n.id)).toEqual(['n2', 'n4']);
    });

    it('filters strictly by port, then narrows by tree name', () => {
        const byPort = findHostNodesByAddress(tree, '192.0.2.10', { protocol: 'ssh', port: 2222 });
        expect(byPort.kind).toBe('one');
        if (byPort.kind === 'one') expect(byPort.node.id).toBe('n4');

        const byName = findHostNodesByAddress(tree, '192.0.2.10', { protocol: 'ssh', name: 'sw-01' });
        expect(byName.kind).toBe('one');
        if (byName.kind === 'one') expect(byName.node.id).toBe('n2');
    });

    it('ignores a NAME hint that matches nothing instead of eliminating every candidate', () => {
        const r = findHostNodesByAddress(tree, '192.0.2.10', { protocol: 'ssh', name: 'nope' });
        expect(r.kind).toBe('ambiguous');
    });

    // Security: `port` is a hard filter, never a tie-breaker. A saved entry must
    // not lend its credentials to a port it was not saved for — for Telnet the
    // stored username/password are auto-typed in cleartext at whatever answers.
    it('returns none when the requested port matches no entry, even with several host matches', () => {
        expect(findHostNodesByAddress(tree, '192.0.2.10', { protocol: 'ssh', port: 9999 })).toEqual({ kind: 'none' });
    });

    it('returns none when the only hostname match was saved for a different port', () => {
        // n1 is the sole 192.0.2.1 entry and holds a password; it is saved on 22.
        expect(findHostNodesByAddress(tree, '192.0.2.1')).toMatchObject({ kind: 'one' });
        expect(findHostNodesByAddress(tree, '192.0.2.1', { port: 22 })).toMatchObject({ kind: 'one' });
        expect(findHostNodesByAddress(tree, '192.0.2.1', { port: 2222 })).toEqual({ kind: 'none' });
    });
});
