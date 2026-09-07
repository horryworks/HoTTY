import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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

  describe('expand / collapse', () => {
    it('collapses a folder on the first click and reopens it on the second', () => {
      render(<HostTree {...defaultProps} />);
      expect(screen.getByText('Web Server')).toBeTruthy();

      fireEvent.click(screen.getByText('Production'));
      expect(screen.queryByText('Web Server')).toBeNull();

      fireEvent.click(screen.getByText('Production'));
      expect(screen.getByText('Web Server')).toBeTruthy();
    });

    it('collapses from the chevron without selecting the folder', () => {
      const onSelect = vi.fn();
      render(<HostTree {...defaultProps} onSelect={onSelect} />);
      const chevron = screen
        .getByText('Production')
        .closest('.host-tree-row')
        ?.querySelector('.tree-icon') as HTMLElement;
      fireEvent.click(chevron);
      expect(screen.queryByText('Web Server')).toBeNull();
      expect(onSelect).not.toHaveBeenCalled();
    });
  });

  describe('filter', () => {
    const typeFilter = (value: string) => {
      const input = screen.getByLabelText('Filter folders and hosts') as HTMLInputElement;
      fireEvent.change(input, { target: { value } });
      return input;
    };

    it('hides nodes that do not match', () => {
      render(<HostTree {...defaultProps} />);
      typeFilter('Dev');
      expect(screen.getByText('Dev Box')).toBeTruthy();
      expect(screen.queryByText('Production')).toBeNull();
      expect(screen.queryByText('Web Server')).toBeNull();
    });

    it('keeps every child when the folder name matches', () => {
      render(<HostTree {...defaultProps} />);
      typeFilter('production');
      expect(screen.getByText('Production')).toBeTruthy();
      // "Web Server" does not contain "production" — it survives via its folder.
      expect(screen.getByText('Web Server')).toBeTruthy();
      expect(screen.queryByText('Dev Box')).toBeNull();
    });

    it('matches on the host address', () => {
      render(<HostTree {...defaultProps} />);
      typeFilter('10.0.0.2');
      expect(screen.getByText('Dev Box')).toBeTruthy();
      expect(screen.queryByText('Web Server')).toBeNull();
    });

    it('shows a no-matches message distinct from the empty-tree hint', () => {
      render(<HostTree {...defaultProps} />);
      typeFilter('zzz');
      expect(screen.getByText('No folders or hosts match "zzz"')).toBeTruthy();
      expect(screen.queryByText(/Right-click or use the \+ buttons/)).toBeNull();
    });

    it('restores the full tree when cleared', () => {
      render(<HostTree {...defaultProps} />);
      typeFilter('Dev');
      expect(screen.queryByText('Web Server')).toBeNull();
      fireEvent.click(screen.getByLabelText('Clear filter'));
      expect(screen.getByText('Web Server')).toBeTruthy();
      expect(screen.getByText('Dev Box')).toBeTruthy();
    });

    it('reveals a match inside a collapsed folder, then re-collapses it', () => {
      render(<HostTree {...defaultProps} />);
      fireEvent.click(screen.getByText('Production'));
      expect(screen.queryByText('Web Server')).toBeNull();

      typeFilter('Web');
      expect(screen.getByText('Web Server')).toBeTruthy();

      fireEvent.click(screen.getByLabelText('Clear filter'));
      expect(screen.queryByText('Web Server')).toBeNull();
    });

    it('selects the first match on Enter without submitting', () => {
      const onSelect = vi.fn();
      render(<HostTree {...defaultProps} onSelect={onSelect} />);
      const input = typeFilter('10.0.0.');
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'host-1' }));
    });

    it('clears on Escape before giving the key up', () => {
      render(<HostTree {...defaultProps} />);
      const input = typeFilter('Dev');
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(input.value).toBe('');
      expect(screen.getByText('Web Server')).toBeTruthy();
    });

    it('stops dragging while a filter is active', () => {
      render(<HostTree {...defaultProps} />);
      const before = screen.getByText('Dev Box').closest('.host-tree-row') as HTMLElement;
      expect(before.getAttribute('draggable')).toBe('true');
      typeFilter('Dev');
      const during = screen.getByText('Dev Box').closest('.host-tree-row') as HTMLElement;
      expect(during.getAttribute('draggable')).toBe('false');
    });

    it('focuses the filter box on Ctrl+F', () => {
      render(<HostTree {...defaultProps} />);
      const input = screen.getByLabelText('Filter folders and hosts');
      expect(document.activeElement).not.toBe(input);
      fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
      expect(document.activeElement).toBe(input);
    });
  });
});

describe('HostTree — NetBox-synced folders', () => {
  const netboxTree: HostTreeNode[] = [
    {
      id: 'u1',
      type: 'folder',
      name: 'My hosts',
      children: [],
    },
    {
      id: 'nb-root',
      type: 'folder',
      name: 'NetBox',
      netbox: { server: 'default', kind: 'root' },
      children: [
        {
          id: 'nb-region',
          type: 'folder',
          name: 'Asia',
          netbox: { server: 'default', kind: 'region', objectId: 1 },
          children: [
            {
              id: 'nb-site',
              type: 'folder',
              name: 'SITE-01 Example Site',
              netbox: { server: 'default', kind: 'site', objectId: 10 },
              children: [
                {
                  id: 'nb-host',
                  type: 'host',
                  name: 'web-01',
                  entry: { protocol: 'ssh', host: '10.0.0.9', port: 22 },
                },
              ],
            },
            {
              id: 'nb-gone',
              type: 'folder',
              name: 'SITE-02 Old Site',
              netbox: {
                server: 'default',
                kind: 'site',
                objectId: 11,
                missing: true,
                missingSince: '2026-01-01T00:00:00.000Z',
              },
              children: [],
            },
          ],
        },
      ],
    },
  ];

  const netboxProps = { ...defaultProps, tree: netboxTree };

  const rowFor = (name: string) =>
    screen.getByText(name, { exact: false }).closest('.host-tree-row') as HTMLElement;

  describe('the sync button', () => {
    it('is absent when NetBox is not configured', () => {
      render(<HostTree {...netboxProps} onNetboxSync={vi.fn()} netboxConfigured={false} />);
      expect(screen.queryByTitle('Sync from NetBox')).toBeNull();
    });

    it('appears once a base URL is set, and runs a sync when pressed', () => {
      const onNetboxSync = vi.fn();
      render(<HostTree {...netboxProps} onNetboxSync={onNetboxSync} netboxConfigured />);
      const button = screen.getByTitle('Sync from NetBox');
      fireEvent.click(button);
      expect(onNetboxSync).toHaveBeenCalledTimes(1);
    });

    it('does not fire a second sync while one is running', () => {
      const onNetboxSync = vi.fn();
      render(
        <HostTree {...netboxProps} onNetboxSync={onNetboxSync} netboxConfigured netboxSyncing />,
      );
      fireEvent.click(screen.getByTitle('Syncing from NetBox…'));
      expect(onNetboxSync).not.toHaveBeenCalled();
    });

    it('carries the last failure, since a startup sync never pops one up', () => {
      render(
        <HostTree
          {...netboxProps}
          onNetboxSync={vi.fn()}
          netboxConfigured
          netboxLastError="NetBox refused the API token"
        />,
      );
      const button = screen.getByTitle(/NetBox refused the API token/);
      expect(button.className).toContain('netbox-error');
    });
  });

  describe('how a synced folder looks', () => {
    it('marks a managed folder without shouting about it', () => {
      render(<HostTree {...netboxProps} />);
      expect(rowFor('Asia').className).toContain('netbox-managed');
      expect(rowFor('My hosts').className).not.toContain('netbox-managed');
    });

    it('says plainly when a folder is gone from NetBox', () => {
      render(<HostTree {...netboxProps} />);
      expect(screen.getByText('not in NetBox')).toBeTruthy();
      expect(rowFor('SITE-02 Old Site').className).toContain('netbox-missing');
      // Kept, not deleted — it may hold hosts the user added.
      expect(screen.getByText(/SITE-02 Old Site/)).toBeTruthy();
    });

    it('leaves a live synced folder unmarked', () => {
      render(<HostTree {...netboxProps} />);
      expect(rowFor('SITE-01 Example Site').className).not.toContain('netbox-missing');
    });
  });

  describe('renaming', () => {
    it('refuses F2 on a folder NetBox names', () => {
      // Allowing it would ship a control that silently undoes itself on the
      // next sync.
      render(<HostTree {...netboxProps} />);
      fireEvent.keyDown(rowFor('SITE-01 Example Site'), { key: 'F2' });
      expect(document.querySelector('.tree-label-edit-input')).toBeNull();
    });

    it('still allows F2 on the container, whose name is the user\'s', () => {
      const { container } = render(<HostTree {...netboxProps} />);
      const row = container.querySelector('[data-node-id="nb-root"]') as HTMLElement;
      fireEvent.keyDown(row, { key: 'F2' });
      expect(container.querySelector('.tree-label-edit-input')).toBeTruthy();
    });

    it('still allows F2 on a hand-made folder', () => {
      render(<HostTree {...netboxProps} />);
      fireEvent.keyDown(rowFor('My hosts'), { key: 'F2' });
      expect(document.querySelector('.tree-label-edit-input')).toBeTruthy();
    });

    it('hides the Rename menu item for a synced folder', () => {
      render(<HostTree {...netboxProps} />);
      fireEvent.contextMenu(rowFor('Asia'));
      expect(screen.queryByText('Rename (F2)')).toBeNull();
      // The other folder actions are still offered.
      expect(screen.getByText('Delete')).toBeTruthy();
    });

    it('offers Rename on the container', () => {
      const { container } = render(<HostTree {...netboxProps} />);
      const row = container.querySelector('[data-node-id="nb-root"]') as HTMLElement;
      fireEvent.contextMenu(row);
      expect(within(container).getByText('Rename (F2)')).toBeTruthy();
    });
  });

  describe('deleting', () => {
    it('warns that the sync recreates the folder empty', () => {
      render(<HostTree {...netboxProps} />);
      fireEvent.contextMenu(rowFor('SITE-01 Example Site'));
      fireEvent.click(screen.getByText('Delete'));
      expect(screen.getByText(/recreate it empty/)).toBeTruthy();
    });

    it('does not add that warning for a hand-made folder', () => {
      render(<HostTree {...netboxProps} />);
      fireEvent.contextMenu(rowFor('My hosts'));
      fireEvent.click(screen.getByText('Delete'));
      expect(screen.queryByText(/recreate it empty/)).toBeNull();
    });
  });

  it('lets a synced folder still be dragged out', () => {
    // Moving one out of the container is a deliberate act; the reconcile then
    // leaves its position alone forever.
    render(<HostTree {...netboxProps} />);
    expect(rowFor('SITE-01 Example Site').getAttribute('draggable')).toBe('true');
  });
});
