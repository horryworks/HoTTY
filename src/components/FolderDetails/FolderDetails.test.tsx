import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FolderDetails } from './FolderDetails';
import type { HostTreeNode } from '../../types/appTypes';

const host = (id: string, name: string, address: string): HostTreeNode => ({
    id, type: 'host', name, entry: { protocol: 'ssh', host: address, port: 22 },
});

const site = (children: HostTreeNode[], prefixes?: string[]): HostTreeNode => ({
    id: 'site',
    type: 'folder',
    name: 'tok Tokyo',
    children,
    netbox: { server: 'default', kind: 'site', objectId: 6, ...(prefixes ? { prefixes } : {}) },
});

const plain = (children: HostTreeNode[] = []): HostTreeNode => ({
    id: 'lab', type: 'folder', name: 'Lab', children,
});

function view(folder: HostTreeNode, over: Partial<React.ComponentProps<typeof FolderDetails>> = {}) {
    const props = {
        folder,
        onSelectChild: vi.fn(),
        ...over,
    };
    render(<FolderDetails {...props} />);
    return props;
}

describe('FolderDetails', () => {
    it('lists the folder ranges', () => {
        view(site([], ['10.6.0.0/16', '10.6.1.0/24']));
        expect(screen.getByText('IP ranges')).toBeTruthy();
        expect(screen.getByText('10.6.0.0/16')).toBeTruthy();
        expect(screen.getByText('10.6.1.0/24')).toBeTruthy();
    });

    it('drops the whole IP ranges heading when there are none', () => {
        // An empty frame would claim the feature is on and found nothing.
        view(site([host('h1', 'web-01', '10.6.1.10')]));
        expect(screen.queryByText('IP ranges')).toBeNull();
    });

    it('shows no NetBox badge on a hand-made folder', () => {
        view(plain([host('h1', 'web-01', '10.6.1.10')]));
        expect(screen.queryByText(/NetBox/)).toBeNull();
    });

    it('names the NetBox object kind', () => {
        view(site([], ['10.6.0.0/16']));
        expect(screen.getByText('NetBox · Site')).toBeTruthy();
    });

    it('warns, with a date, when NetBox has lost the folder', () => {
        const folder: HostTreeNode = {
            ...site([], ['10.6.0.0/16']),
            netbox: {
                server: 'default', kind: 'site', objectId: 6,
                prefixes: ['10.6.0.0/16'],
                missing: true, missingSince: '2026-09-10T03:04:00.000Z',
            },
        };
        view(folder);
        expect(screen.getByRole('status').textContent).toContain('Not found in NetBox since');
    });

    it('marks only the host outside every range', () => {
        view(site([
            host('h1', 'web-01', '10.6.1.10'),
            host('h2', 'old-01', '172.16.0.5'),
        ], ['10.6.0.0/16']));
        expect(screen.getAllByText('out of range')).toHaveLength(1);
    });

    it('marks nothing when the folder has no range to be outside of', () => {
        view(plain([host('h1', 'anything', '203.0.113.9')]));
        expect(screen.queryByText('out of range')).toBeNull();
    });

    it('counts direct children only', () => {
        view(site([
            plain([host('deep', 'buried', '10.6.1.99')]),
            host('h1', 'web-01', '10.6.1.10'),
        ], ['10.6.0.0/16']));
        expect(screen.getByText('Folders 1 · Hosts 1')).toBeTruthy();
        expect(screen.queryByText('buried')).toBeNull();
    });

    it('says so when the folder is empty', () => {
        view(plain());
        expect(screen.getByText('This folder is empty.')).toBeTruthy();
    });

    it('selects a child on a single click', () => {
        const props = view(site([host('h1', 'web-01', '10.6.1.10')], ['10.6.0.0/16']));
        fireEvent.click(screen.getByText('web-01'));
        expect(props.onSelectChild).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'h1' }),
        );
    });

    it('reports stored ranges it could not read rather than hiding them', () => {
        view(site([], ['10.6.0.0/16', 'not-a-prefix']));
        expect(screen.getByText(/could not be read/)).toBeTruthy();
    });
});
