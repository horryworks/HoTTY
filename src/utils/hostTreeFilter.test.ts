import { describe, it, expect } from 'vitest';
import type { HostTreeNode } from '../types/appTypes';
import { filterHostTree, nodeSearchText } from './hostTreeFilter';

const host = (id: string, name: string, address: string): HostTreeNode => ({
    id,
    type: 'host',
    name,
    entry: { protocol: 'ssh', host: address, port: 22 },
});

const folder = (id: string, name: string, children: HostTreeNode[]): HostTreeNode => ({
    id,
    type: 'folder',
    name,
    children,
});

const tree: HostTreeNode[] = [
    folder('f-prod', 'Production', [
        folder('f-tokyo', 'Tokyo', [
            host('h-web1', 'web-01', '10.0.0.1'),
            host('h-db1', 'db-01', '10.0.0.2'),
        ]),
        host('h-edge', 'edge-router', '192.168.1.1'),
    ]),
    folder('f-stg', 'Staging', [host('h-webstg', 'web-stg', '172.16.0.9')]),
    host('h-dev', 'Dev Box', '192.168.1.50'),
];

describe('nodeSearchText', () => {
    it('covers the name and the address of a host', () => {
        expect(nodeSearchText(host('h', 'web-01', '10.0.0.1'))).toBe('web-01 10.0.0.1');
    });

    it('covers only the name of a folder', () => {
        expect(nodeSearchText(folder('f', 'Production', []))).toBe('production');
    });

    it('covers the project and instance of an IAP host', () => {
        const iap: HostTreeNode = {
            id: 'h-iap',
            type: 'host',
            name: 'Bastion',
            entry: {
                protocol: 'gcloud-iap',
                host: '',
                port: 22,
                iapTunnel: { project: 'proj-1', zone: 'asia-northeast1-a', instance: 'vm-01' },
            },
        };
        expect(nodeSearchText(iap)).toBe('bastion proj-1 vm-01');
    });

    it('does not cover the username', () => {
        const withUser: HostTreeNode = {
            id: 'h',
            type: 'host',
            name: 'web-01',
            entry: { protocol: 'ssh', host: '10.0.0.1', port: 22, username: 'alice' },
        };
        expect(nodeSearchText(withUser)).not.toContain('alice');
    });
});

describe('filterHostTree', () => {
    it('returns the same reference for an empty query', () => {
        expect(filterHostTree(tree, '')).toBe(tree);
        expect(filterHostTree(tree, '   ')).toBe(tree);
    });

    it('keeps only the branches leading to a matching host', () => {
        const result = filterHostTree(tree, 'db-01');
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('f-prod');
        expect(result[0].children?.map(n => n.id)).toEqual(['f-tokyo']);
        expect(result[0].children?.[0].children?.map(n => n.id)).toEqual(['h-db1']);
    });

    it('keeps a whole folder when the folder name matches', () => {
        const result = filterHostTree(tree, 'tokyo');
        const tokyo = result[0].children?.[0];
        expect(tokyo?.id).toBe('f-tokyo');
        // db-01 does not match "tokyo" but survives because its folder does.
        expect(tokyo?.children?.map(n => n.id)).toEqual(['h-web1', 'h-db1']);
        // The folder object is passed through untouched.
        expect(tokyo).toBe(tree[0].children?.[0]);
    });

    it('matches on the host address', () => {
        const result = filterHostTree(tree, '192.168.1.');
        expect(result.map(n => n.id)).toEqual(['f-prod', 'h-dev']);
        expect(result[0].children?.map(n => n.id)).toEqual(['h-edge']);
    });

    it('ignores case', () => {
        expect(filterHostTree(tree, 'WEB-01')[0].id).toBe('f-prod');
        expect(filterHostTree(tree, 'ProDucTion').map(n => n.id)).toEqual(['f-prod']);
    });

    it('matches across sibling branches', () => {
        const result = filterHostTree(tree, 'web');
        expect(result.map(n => n.id)).toEqual(['f-prod', 'f-stg']);
        expect(result[0].children?.[0].children?.map(n => n.id)).toEqual(['h-web1']);
        expect(result[1].children?.map(n => n.id)).toEqual(['h-webstg']);
    });

    it('returns an empty array when nothing matches', () => {
        expect(filterHostTree(tree, 'zzz')).toEqual([]);
    });

    it('keeps a matching root-level host', () => {
        expect(filterHostTree(tree, 'dev box').map(n => n.id)).toEqual(['h-dev']);
    });

    it('drops an empty folder that does not match', () => {
        expect(filterHostTree([folder('f-empty', 'Empty', [])], 'x')).toEqual([]);
    });
});
