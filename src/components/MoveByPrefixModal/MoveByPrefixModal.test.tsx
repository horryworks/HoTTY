import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MoveByPrefixModal } from './MoveByPrefixModal';
import type { HostTreeNode } from '../../types/appTypes';

const host = (id: string, name: string, address: string): HostTreeNode => ({
    id, type: 'host', name, entry: { protocol: 'ssh', host: address, port: 22 },
});

const site = (id: string, name: string, prefixes: string[], children: HostTreeNode[] = []): HostTreeNode => ({
    id,
    type: 'folder',
    name,
    children,
    netbox: { server: 'default', kind: 'site', objectId: Number(id.slice(1)) || 1, prefixes },
});

/** Inbox with three hosts, two site folders that can claim them. */
function tree(): HostTreeNode[] {
    return [
        site('s1', 'TOK Tokyo', ['10.1.0.0/16']),
        site('s2', 'OSA Osaka', ['10.2.0.0/16'], [host('h9', 'osaka-99', '10.2.0.99')]),
        {
            id: 'inbox', type: 'folder', name: 'Inbox', children: [
                host('h1', 'tokyo-01', '10.1.0.1'),
                host('h2', 'osaka-01', '10.2.0.1'),
                host('h3', 'by-name', 'router1.example.com'),
                host('h4', 'nowhere', '203.0.113.9'),
            ],
        },
    ];
}

const open = (over: Record<string, unknown> = {}) => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(
        <MoveByPrefixModal
            tree={tree()}
            scopeFolderId={null}
            onApply={onApply}
            onClose={onClose}
            {...over}
        />,
    );
    return { onApply, onClose };
};

describe('MoveByPrefixModal', () => {
    it('lists what will move, what is already in place, what is ambiguous and what did not match', () => {
        open();
        expect(screen.getByText(/Will move \(2\)/)).toBeTruthy();
        expect(screen.getByText(/Already in the right folder \(1\)/)).toBeTruthy();
        expect(screen.getByText(/No match \(2\)/)).toBeTruthy();
        expect(screen.getByText(/not an IP address/)).toBeTruthy();
        expect(screen.getByText(/outside every prefix/)).toBeTruthy();
    });

    it('moves nothing until the user applies', () => {
        const { onApply } = open();
        expect(onApply).not.toHaveBeenCalled();
        fireEvent.click(screen.getByText('Move 2'));
        expect(onApply).toHaveBeenCalledTimes(1);
    });

    it('applies only the rows still ticked', () => {
        const { onApply } = open();
        fireEvent.click(screen.getByLabelText(/tokyo-01/));
        fireEvent.click(screen.getByText('Move 1'));
        expect(onApply).toHaveBeenCalledWith([{ hostId: 'h2', targetFolderId: 's2' }]);
    });

    it('never offers to move an ambiguous host', () => {
        const tied: HostTreeNode[] = [
            site('s1', 'TOK Tokyo', ['192.168.1.0/24']),
            site('s2', 'OSA Osaka', ['192.168.1.0/24']),
            { id: 'inbox', type: 'folder', name: 'Inbox', children: [host('h1', 'dup', '192.168.1.5')] },
        ];
        const { onApply } = open({ tree: tied });
        expect(screen.getByText(/More than one folder claims these \(1\)/)).toBeTruthy();
        // Read-only: no checkbox, and nothing to apply.
        expect(screen.queryByLabelText(/dup/)).toBeNull();
        expect((screen.getByText('Move 0') as HTMLButtonElement).disabled).toBe(true);
        expect(onApply).not.toHaveBeenCalled();
    });

    it('narrows the candidates to the scope subtree by default', () => {
        // The only real defence when the same private range is reused per site.
        const scoped: HostTreeNode[] = [
            {
                id: 'asia', type: 'folder', name: 'Asia', children: [
                    site('s1', 'TOK Tokyo', ['192.168.1.0/24']),
                    { id: 'inbox', type: 'folder', name: 'Inbox', children: [host('h1', 'dup', '192.168.1.5')] },
                ],
            },
            site('s2', 'OSA Osaka', ['192.168.1.0/24']),
        ];
        open({ tree: scoped, scopeFolderId: 'asia' });
        expect(screen.getByText(/Will move \(1\)/)).toBeTruthy();
        // Widening brings the second claimant back and the host turns ambiguous.
        fireEvent.click(screen.getByLabelText(/The whole tree/));
        expect(screen.getByText(/More than one folder claims these \(1\)/)).toBeTruthy();
    });

    it('says plainly when the tree carries no prefixes yet', () => {
        const bare: HostTreeNode[] = [
            { id: 'inbox', type: 'folder', name: 'Inbox', children: [host('h1', 'a', '10.1.0.1')] },
        ];
        open({ tree: bare });
        expect(screen.getByText(/No folder in the tree carries a NetBox prefix yet/)).toBeTruthy();
    });

    it('says so when every host is already where it belongs', () => {
        const settled: HostTreeNode[] = [site('s1', 'TOK Tokyo', ['10.1.0.0/16'], [host('h1', 'a', '10.1.0.1')])];
        open({ tree: settled });
        expect(screen.getByText(/already where its address says it belongs/)).toBeTruthy();
    });

    it('closes without applying on Cancel', () => {
        const { onApply, onClose } = open();
        fireEvent.click(screen.getByText('Cancel'));
        expect(onClose).toHaveBeenCalled();
        expect(onApply).not.toHaveBeenCalled();
    });
});
