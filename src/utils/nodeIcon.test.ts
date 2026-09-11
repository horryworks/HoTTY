import { describe, it, expect } from 'vitest';
import { nodeIcon } from './nodeIcon';
import type { HostTreeNode } from '../types/appTypes';

const folder = (netbox?: HostTreeNode['netbox']): HostTreeNode => ({
    id: 'f',
    type: 'folder',
    name: 'Folder',
    children: [],
    ...(netbox ? { netbox } : {}),
});

const host = (isJumpbox?: boolean): HostTreeNode => ({
    id: 'h',
    type: 'host',
    name: 'Host',
    entry: { protocol: 'ssh', host: '10.0.0.1', port: 22, ...(isJumpbox ? { isJumpbox } : {}) },
});

describe('nodeIcon', () => {
    it('gives regions, sites and hand-made folders three different glyphs', () => {
        const region = nodeIcon(folder({ server: 'default', kind: 'region', objectId: 1 }));
        const site = nodeIcon(folder({ server: 'default', kind: 'site', objectId: 2 }));
        const plain = nodeIcon(folder());
        expect(new Set([region, site, plain]).size).toBe(3);
    });

    it('leaves the NetBox container looking like any other folder', () => {
        // ADR-018 gives the container's name and position to the user, so the
        // glyph must not claim NetBox owns it.
        expect(nodeIcon(folder({ server: 'default', kind: 'root' }))).toBe(nodeIcon(folder()));
    });

    it('keeps the glyph when NetBox has lost the object', () => {
        // The row already says `missing` in words and in colour; a third signal
        // that changes the object's apparent type would be misleading.
        const live = folder({ server: 'default', kind: 'site', objectId: 2 });
        const gone = folder({
            server: 'default',
            kind: 'site',
            objectId: 2,
            missing: true,
            missingSince: '2026-09-10T00:00:00.000Z',
        });
        expect(nodeIcon(gone)).toBe(nodeIcon(live));
    });

    it('tells a jumpbox apart from an ordinary host', () => {
        expect(nodeIcon(host(true))).not.toBe(nodeIcon(host()));
    });

    it('never returns a folder glyph for a host', () => {
        expect(nodeIcon(host())).not.toBe(nodeIcon(folder()));
    });
});
