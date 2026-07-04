import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HostTree } from './HostTree';
import type { HostTreeNode } from '../../types/appTypes';

// Mock tauriService
vi.mock('../../services/tauriService', () => ({
  tauriService: {
    focusWindow: vi.fn(),
    exportHtree: vi.fn(),
    selectImportFile: vi.fn(),
    decryptImportFile: vi.fn(),
    gceIapCheckGcloud: vi.fn(),
    gceIapCheckAuth: vi.fn(),
    gceIapListProjects: vi.fn(),
    gceIapListZones: vi.fn(),
    gceIapListInstances: vi.fn(),
    openExternal: vi.fn(),
    logDebug: vi.fn(),
  },
  isEncrypted: (value: string) => value.startsWith('[DPAPI]') || value.startsWith('[SAFE]'),
}));

const sampleTree: HostTreeNode[] = [
  {
    id: 'folder-1',
    type: 'folder',
    name: 'Production',
    children: [
      {
        id: 'host-1',
        type: 'host',
        name: 'Web Server',
        entry: { protocol: 'ssh', host: '10.0.0.1', port: 22 },
      },
    ],
  },
  {
    id: 'host-2',
    type: 'host',
    name: 'Dev Box',
    entry: { protocol: 'ssh', host: '10.0.0.2', port: 22 },
  },
];

const defaultProps = {
  tree: sampleTree,
  selectedId: null,
  onSelect: vi.fn(),
  onDoubleClickHost: vi.fn(),
  onAddFolder: vi.fn(),
  onAddHost: vi.fn(),
  onEditNode: vi.fn(),
  onDeleteNode: vi.fn(),
  onMoveNode: vi.fn(),
  onSortFolder: vi.fn(),
  onImportData: vi.fn(),
  onShowMessage: vi.fn(),
};

describe('HostTree', () => {
  it('renders tree nodes', () => {
    render(<HostTree {...defaultProps} />);
    expect(screen.getByText('Production')).toBeTruthy();
    expect(screen.getByText('Web Server')).toBeTruthy();
    expect(screen.getByText('Dev Box')).toBeTruthy();
  });

  it('renders empty message when tree is empty', () => {
    render(<HostTree {...defaultProps} tree={[]} />);
    expect(screen.getByText(/Right-click or use the \+ buttons/)).toBeTruthy();
  });

  it('renders toolbar buttons', () => {
    render(<HostTree {...defaultProps} />);
    expect(screen.getByTitle('Add Folder')).toBeTruthy();
    expect(screen.getByTitle('Add Host')).toBeTruthy();
    expect(screen.getByTitle('Export Tree')).toBeTruthy();
    expect(screen.getByTitle('Import Tree')).toBeTruthy();
  });

  it('calls onSelect when a node is clicked', () => {
    const onSelect = vi.fn();
    render(<HostTree {...defaultProps} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Dev Box'));
    expect(onSelect).toHaveBeenCalledWith(sampleTree[1]);
  });

  it('calls onDoubleClickHost when a host is double-clicked', () => {
    const onDoubleClickHost = vi.fn();
    render(<HostTree {...defaultProps} onDoubleClickHost={onDoubleClickHost} />);
    fireEvent.doubleClick(screen.getByText('Dev Box'));
    expect(onDoubleClickHost).toHaveBeenCalledWith(sampleTree[1]);
  });

  it('opens context menu on right-click', () => {
    render(<HostTree {...defaultProps} />);
    fireEvent.contextMenu(screen.getByText('Production'));
    expect(screen.getByText('Add Folder')).toBeTruthy();
    expect(screen.getByText('Add Host')).toBeTruthy();
    expect(screen.getByText('Delete')).toBeTruthy();
  });

  it('shows rename option in context menu', () => {
    render(<HostTree {...defaultProps} />);
    fireEvent.contextMenu(screen.getByText('Production'));
    expect(screen.getByText('Rename (F2)')).toBeTruthy();
  });

  it('shows sort options for folder context menu', () => {
    render(<HostTree {...defaultProps} />);
    fireEvent.contextMenu(screen.getByText('Production'));
    expect(screen.getByText('Sort Ascending')).toBeTruthy();
    expect(screen.getByText('Sort Descending')).toBeTruthy();
  });

  it('calls onSortFolder with "desc" when Sort Descending is clicked', () => {
    const onSortFolder = vi.fn();
    render(<HostTree {...defaultProps} onSortFolder={onSortFolder} />);
    fireEvent.contextMenu(screen.getByText('Production'));
    fireEvent.click(screen.getByText('Sort Descending'));
    expect(onSortFolder).toHaveBeenCalledWith('folder-1', 'desc');
  });

  it('highlights selected node', () => {
    render(<HostTree {...defaultProps} selectedId="host-2" />);
    const row = screen.getByText('Dev Box').closest('.host-tree-row');
    expect(row?.classList.contains('selected')).toBe(true);
  });

  it('displays host metadata (host address)', () => {
    render(<HostTree {...defaultProps} />);
    expect(screen.getByText('10.0.0.2')).toBeTruthy();
  });

  describe('Open All', () => {
    it('shows "Open All" for a folder with hosts and calls onOpenAllInFolder (small folder: no confirm)', () => {
      const onOpenAllInFolder = vi.fn();
      render(<HostTree {...defaultProps} onOpenAllInFolder={onOpenAllInFolder} />);
      fireEvent.contextMenu(screen.getByText('Production'));
      fireEvent.click(screen.getByText('Open All'));
      expect(onOpenAllInFolder).toHaveBeenCalledWith(expect.objectContaining({ id: 'folder-1' }));
    });

    it('does not show "Open All" when onOpenAllInFolder is not provided', () => {
      render(<HostTree {...defaultProps} />);
      fireEvent.contextMenu(screen.getByText('Production'));
      expect(screen.queryByText('Open All')).toBeNull();
    });

    it('does not show "Open All" for a host', () => {
      render(<HostTree {...defaultProps} onOpenAllInFolder={vi.fn()} />);
      fireEvent.contextMenu(screen.getByText('Dev Box'));
      expect(screen.queryByText('Open All')).toBeNull();
    });

    it('does not show "Open All" for an empty folder', () => {
      const tree: HostTreeNode[] = [{ id: 'f-empty', type: 'folder', name: 'Empty', children: [] }];
      render(<HostTree {...defaultProps} tree={tree} onOpenAllInFolder={vi.fn()} />);
      fireEvent.contextMenu(screen.getByText('Empty'));
      expect(screen.queryByText('Open All')).toBeNull();
    });

    it('confirms before opening when a folder holds 5+ hosts', () => {
      const tree: HostTreeNode[] = [
        {
          id: 'f-big',
          type: 'folder',
          name: 'Fleet',
          children: Array.from({ length: 5 }, (_, i) => ({
            id: `h${i}`,
            type: 'host' as const,
            name: `Host ${i}`,
            entry: { protocol: 'ssh' as const, host: `10.0.1.${i}`, port: 22 },
          })),
        },
      ];
      const onOpenAllInFolder = vi.fn();
      render(<HostTree {...defaultProps} tree={tree} onOpenAllInFolder={onOpenAllInFolder} />);
      fireEvent.contextMenu(screen.getByText('Fleet'));
      fireEvent.click(screen.getByText('Open All'));
      // Gated: not opened until the confirm dialog is accepted.
      expect(onOpenAllInFolder).not.toHaveBeenCalled();
      expect(screen.getByText('Open all hosts')).toBeTruthy();
      fireEvent.click(screen.getByText('Open All')); // confirm button
      expect(onOpenAllInFolder).toHaveBeenCalledWith(expect.objectContaining({ id: 'f-big' }));
    });
  });

  describe('New Connection pseudo-row', () => {
    it('renders when onNewConnection is provided', () => {
      const onNewConnection = vi.fn();
      render(<HostTree {...defaultProps} onNewConnection={onNewConnection} />);
      expect(screen.getByText('New Connection')).toBeTruthy();
    });

    it('does not render when onNewConnection is not provided', () => {
      render(<HostTree {...defaultProps} />);
      expect(screen.queryByText('New Connection')).toBeNull();
    });

    it('is highlighted when selectedId is null', () => {
      const onNewConnection = vi.fn();
      render(<HostTree {...defaultProps} selectedId={null} onNewConnection={onNewConnection} />);
      const row = screen.getByText('New Connection').closest('.host-tree-row');
      expect(row?.classList.contains('selected')).toBe(true);
    });

    it('is not highlighted when a host is selected', () => {
      const onNewConnection = vi.fn();
      render(<HostTree {...defaultProps} selectedId="host-2" onNewConnection={onNewConnection} />);
      const row = screen.getByText('New Connection').closest('.host-tree-row');
      expect(row?.classList.contains('selected')).toBe(false);
    });

    it('calls onNewConnection when clicked', () => {
      const onNewConnection = vi.fn();
      render(<HostTree {...defaultProps} onNewConnection={onNewConnection} />);
      fireEvent.click(screen.getByText('New Connection'));
      expect(onNewConnection).toHaveBeenCalledTimes(1);
    });

    it('calls onNewConnection on Enter key', () => {
      const onNewConnection = vi.fn();
      render(<HostTree {...defaultProps} onNewConnection={onNewConnection} />);
      const row = screen.getByText('New Connection').closest('.host-tree-row') as HTMLElement;
      fireEvent.keyDown(row, { key: 'Enter' });
      expect(onNewConnection).toHaveBeenCalledTimes(1);
    });

    it('renders even when the tree is empty', () => {
      const onNewConnection = vi.fn();
      render(<HostTree {...defaultProps} tree={[]} onNewConnection={onNewConnection} />);
      expect(screen.getByText('New Connection')).toBeTruthy();
    });
  });
});
