import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HostTree } from './HostTree';
import type { HostTreeNode } from '../../hooks/useHostManager';

vi.mock('./HostTree.css', () => ({}));
vi.mock('../../hooks/useFocusTrap', () => ({
    useFocusTrap: vi.fn(),
}));
vi.mock('../../hooks/useModalState', () => ({
    useModalState: vi.fn(() => [false, vi.fn(), vi.fn(), undefined]),
}));
vi.mock('../ConfirmModal/ConfirmModal', () => ({
    ConfirmModal: () => null,
}));

// Mock window.electronAPI since HostTree calls it directly
Object.defineProperty(window, 'electronAPI', {
    value: {
        focusWindow: vi.fn(),
        logDebug: vi.fn(),
        selectImportFile: vi.fn(() => Promise.resolve(null)),
        exportHTree: vi.fn(() => Promise.resolve(true)),
        decryptImportFile: vi.fn(() => Promise.resolve(null)),
    },
    writable: true,
});

const baseProps = {
    tree: [] as HostTreeNode[],
    selectedId: null,
    onSelect: vi.fn(),
    onAddFolder: vi.fn(),
    onAddHost: vi.fn(),
    onEditNode: vi.fn(),
    onDeleteNode: vi.fn(),
};

describe('HostTree', () => {
    it('renders empty tree without crashing', () => {
        const { container } = render(<HostTree {...baseProps} />);
        expect(container).toBeTruthy();
    });

    it('renders the tree container element', () => {
        const { container } = render(<HostTree {...baseProps} />);
        expect(container.firstChild).toBeTruthy();
    });

    it('renders a folder node', () => {
        const folderNode: HostTreeNode = {
            id: 'folder1',
            name: 'My Servers',
            type: 'folder',
            children: [],
        };
        render(<HostTree {...baseProps} tree={[folderNode]} />);
        expect(screen.getByText('My Servers')).toBeInTheDocument();
    });

    it('renders a host node', () => {
        const hostNode: HostTreeNode = {
            id: 'host1',
            name: 'Production Server',
            type: 'host',
            children: [],
            entry: {
                protocol: 'ssh',
                host: '192.168.1.1',
                port: 22,
                username: 'admin',
                password: '',
            },
        };
        render(<HostTree {...baseProps} tree={[hostNode]} />);
        expect(screen.getByText('Production Server')).toBeInTheDocument();
    });

    it('renders multiple nodes', () => {
        const nodes: HostTreeNode[] = [
            { id: 'f1', name: 'Folder A', type: 'folder', children: [] },
            {
                id: 'h1',
                name: 'Host B',
                type: 'host',
                children: [],
                entry: { protocol: 'telnet', host: '10.0.0.1', port: 23 },
            },
        ];
        render(<HostTree {...baseProps} tree={nodes} />);
        expect(screen.getByText('Folder A')).toBeInTheDocument();
        expect(screen.getByText('Host B')).toBeInTheDocument();
    });

    it('renders with selectedId set', () => {
        const hostNode: HostTreeNode = {
            id: 'host1',
            name: 'Selected Host',
            type: 'host',
            children: [],
            entry: { protocol: 'ssh', host: '1.2.3.4', port: 22 },
        };
        const { container } = render(
            <HostTree {...baseProps} tree={[hostNode]} selectedId="host1" />
        );
        expect(container).toBeTruthy();
        expect(screen.getByText('Selected Host')).toBeInTheDocument();
    });
});
