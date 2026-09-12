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
    // The add-host form reads ~/.ssh for its key picker, and can open the
    // key-generate dialog on top of itself.
    listSshKeys: vi.fn().mockResolvedValue({ keys: [], sshDir: null, available: true, truncated: false }),
    selectFile: vi.fn().mockResolvedValue(null),
    generateSshKey: vi.fn(),
    readSshPublicKey: vi.fn(),
    writeClipboard: vi.fn(),
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
    it('leaves the folder open on a single click, and still selects it', () => {
      const onSelect = vi.fn();
      render(<HostTree {...defaultProps} onSelect={onSelect} />);

      fireEvent.click(screen.getByText('Production'));

      expect(screen.getByText('Web Server')).toBeTruthy();
      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: 'Production' }));
    });

    it('collapses a folder on double-click and reopens it on the next one', () => {
      render(<HostTree {...defaultProps} />);
      expect(screen.getByText('Web Server')).toBeTruthy();

      fireEvent.doubleClick(screen.getByText('Production'));
      expect(screen.queryByText('Web Server')).toBeNull();

      fireEvent.doubleClick(screen.getByText('Production'));
      expect(screen.getByText('Web Server')).toBeTruthy();
    });

    // fireEvent.doubleClick fires `dblclick` alone; a real browser sends
    // click, click, dblclick. Spell that out so a toggle creeping back into
    // the row's onClick shows up here as a folder that never closes.
    it('collapses once when the two clicks before the double-click are real', () => {
      render(<HostTree {...defaultProps} />);
      const folder = screen.getByText('Production');

      fireEvent.click(folder);
      fireEvent.click(folder);
      fireEvent.doubleClick(folder);

      expect(screen.queryByText('Web Server')).toBeNull();
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

    it('lands back where it started when the chevron is clicked twice quickly', () => {
      render(<HostTree {...defaultProps} />);
      const chevron = screen
        .getByText('Production')
        .closest('.host-tree-row')
        ?.querySelector('.tree-icon') as HTMLElement;

      // Two toggles, then the dblclick the browser adds on top — which the
      // chevron swallows, so it must not become a third toggle.
      fireEvent.click(chevron);
      fireEvent.click(chevron);
      fireEvent.doubleClick(chevron);

      expect(screen.getByText('Web Server')).toBeTruthy();
    });

    it('ignores the invisible chevron on a folder with no children', () => {
      const emptyFolder: HostTreeNode = { id: 'folder-2', type: 'folder', name: 'Staging', children: [] };
      render(<HostTree {...defaultProps} tree={[...sampleTree, emptyFolder]} />);
      const chevron = screen
        .getByText('Staging')
        .closest('.host-tree-row')
        ?.querySelector('.tree-icon') as HTMLElement;

      expect(chevron.style.opacity).toBe('0');
      fireEvent.click(chevron);
      // Nothing to show either way — the point is that the row does not
      // quietly flip a hidden control.
      expect(screen.getByText('Staging')).toBeTruthy();
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
      fireEvent.doubleClick(screen.getByText('Production'));
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

describe('HostTree — NetBox prefix placement', () => {
  /** Container, one site with a prefix, plus a plain folder to save into. */
  const prefixTree: HostTreeNode[] = [
    {
      id: 'c', type: 'folder', name: 'NetBox',
      netbox: { server: 'default', kind: 'root' },
      children: [
        {
          id: 's1', type: 'folder', name: 'TOK Tokyo', children: [],
          netbox: { server: 'default', kind: 'site', objectId: 10, prefixes: ['10.1.0.0/16'] },
        },
      ],
    },
    { id: 'mine', type: 'folder', name: 'Production', children: [] },
  ];

  const props = (over: Record<string, unknown> = {}) => ({
    ...defaultProps,
    tree: prefixTree,
    netboxPlacement: true,
    onAddHost: vi.fn(),
    onApplyPlacements: vi.fn(() => 1),
    ...over,
  });

  /** Open "Add Host" from the toolbar and type an address. */
  function openAddHost(address: string, p = props()) {
    render(<HostTree {...p} />);
    fireEvent.click(screen.getByTitle('Add Host'));
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'new-host' } });
    fireEvent.change(screen.getByPlaceholderText('192.168.1.1'), { target: { value: address } });
    return p;
  }

  it('suggests the matched site folder when the address falls inside a prefix', () => {
    openAddHost('10.1.0.9');
    expect(screen.getByText(/Matches NetBox 10\.1\.0\.0\/16/)).toBeTruthy();
    expect(screen.getByLabelText('TOK Tokyo')).toBeTruthy();
  });

  it('adds the host to the suggested folder when the suggestion is left selected', () => {
    const p = openAddHost('10.1.0.9');
    fireEvent.click(screen.getByText('Save'));
    expect(p.onAddHost).toHaveBeenCalledWith('s1', 'new-host', expect.objectContaining({ host: '10.1.0.9' }));
  });

  it('adds the host where it would have gone when the user picks the original location', () => {
    const p = openAddHost('10.1.0.9');
    fireEvent.click(screen.getByLabelText(/Here:/));
    fireEvent.click(screen.getByText('Save'));
    expect(p.onAddHost).toHaveBeenCalledWith(null, 'new-host', expect.objectContaining({ host: '10.1.0.9' }));
  });

  it('keeps the user choice when the address is edited again', () => {
    // The stickiness matters: without it, every keystroke would silently undo
    // the decision the user just made.
    const p = openAddHost('10.1.0.9');
    fireEvent.click(screen.getByLabelText(/Here:/));
    fireEvent.change(screen.getByPlaceholderText('192.168.1.1'), { target: { value: '10.1.0.20' } });
    fireEvent.click(screen.getByText('Save'));
    expect(p.onAddHost).toHaveBeenCalledWith(null, 'new-host', expect.objectContaining({ host: '10.1.0.20' }));
  });

  it('says it will not choose when two folders claim the address', () => {
    const tied: HostTreeNode[] = [
      { id: 'a', type: 'folder', name: 'TOK Tokyo', children: [], netbox: { server: 'default', kind: 'site', objectId: 10, prefixes: ['10.1.0.0/16'] } },
      { id: 'b', type: 'folder', name: 'OSA Osaka', children: [], netbox: { server: 'default', kind: 'site', objectId: 11, prefixes: ['10.1.0.0/16'] } },
    ];
    openAddHost('10.1.0.9', props({ tree: tied }));
    expect(screen.getByText(/HoTTY will not choose/)).toBeTruthy();
    expect(screen.queryByText(/Save to/)).toBeNull();
  });

  it('shows nothing at all when the tree carries no prefixes', () => {
    openAddHost('10.1.0.9', props({ tree: sampleTree }));
    expect(screen.queryByText(/Matches NetBox/)).toBeNull();
    expect(screen.queryByText(/No NetBox folder covers/)).toBeNull();
  });

  it('shows nothing while the setting is off', () => {
    openAddHost('10.1.0.9', props({ netboxPlacement: false }));
    expect(screen.queryByText(/Matches NetBox/)).toBeNull();
  });

  it('does not resolve a hostname, so a name suggests nothing', () => {
    openAddHost('router1.example.com');
    expect(screen.queryByText(/Matches NetBox/)).toBeNull();
    expect(screen.queryByText(/No NetBox folder covers/)).toBeNull();
  });

  it('says plainly when the address matches no prefix', () => {
    openAddHost('203.0.113.9');
    expect(screen.getByText(/No NetBox folder covers this address/)).toBeTruthy();
  });

  it('offers the bulk action on a folder and on the empty tree background', () => {
    render(<HostTree {...props()} />);
    fireEvent.contextMenu(screen.getByText('Production'));
    expect(screen.getByText('Sort by IP Range…')).toBeTruthy();
  });

  it('hides the bulk action while the setting is off', () => {
    render(<HostTree {...props({ netboxPlacement: false })} />);
    fireEvent.contextMenu(screen.getByText('Production'));
    expect(screen.queryByText('Sort by IP Range…')).toBeNull();
  });

  it('hides the bulk action when no folder carries a prefix', () => {
    render(<HostTree {...props({ tree: sampleTree })} />);
    fireEvent.contextMenu(screen.getByText('Production'));
    expect(screen.queryByText('Sort by IP Range…')).toBeNull();
  });

  it('opens the bulk preview and applies only on demand', () => {
    // The host sits inside Production, which is the folder right-clicked, so
    // the scope of the action is the thing under test as well.
    const withHost: HostTreeNode[] = [
      prefixTree[0],
      {
        id: 'mine', type: 'folder', name: 'Production', children: [
          { id: 'h1', type: 'host', name: 'tokyo-01', entry: { protocol: 'ssh', host: '10.1.0.9', port: 22 } },
        ],
      },
    ];
    const p = props({ tree: withHost });
    render(<HostTree {...p} />);
    fireEvent.contextMenu(screen.getByText('Production'));
    fireEvent.click(screen.getByText('Sort by IP Range…'));
    expect(screen.getByText(/Will move \(1\)/)).toBeTruthy();
    expect(p.onApplyPlacements).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Move 1'));
    expect(p.onApplyPlacements).toHaveBeenCalledWith([{ hostId: 'h1', targetFolderId: 's1' }]);
  });
});

describe('HostTree — move one host by its IP range', () => {
  /** A site with a range, a plain folder, and hosts to right-click. */
  const tree = (): HostTreeNode[] => [
    {
      id: 'c', type: 'folder', name: 'NetBox',
      netbox: { server: 'default', kind: 'root' },
      children: [
        {
          id: 's1', type: 'folder', name: 'TOK Tokyo',
          netbox: { server: 'default', kind: 'site', objectId: 10, prefixes: ['10.1.0.0/16'] },
          children: [
            { id: 'settled', type: 'host', name: 'settled-01', entry: { protocol: 'ssh', host: '10.1.0.50', port: 22 } },
          ],
        },
      ],
    },
    {
      id: 'mine', type: 'folder', name: 'Production', children: [
        { id: 'match', type: 'host', name: 'tokyo-01', entry: { protocol: 'ssh', host: '10.1.0.9', port: 22 } },
        { id: 'nomatch', type: 'host', name: 'edge-01', entry: { protocol: 'ssh', host: '203.0.113.9', port: 22 } },
        { id: 'byname', type: 'host', name: 'named-01', entry: { protocol: 'ssh', host: 'router1.example.com', port: 22 } },
      ],
    },
  ];

  const props = (over: Record<string, unknown> = {}) => ({
    ...defaultProps,
    tree: tree(),
    netboxPlacement: true,
    onApplyPlacements: vi.fn(() => 1),
    ...over,
  });

  /** The placement row is always first in the menu, above the separator. */
  const rowFor = (hostName: string, p = props()) => {
    render(<HostTree {...p} />);
    fireEvent.contextMenu(screen.getByText(hostName));
    return p;
  };

  it('names the destination folder in the label', () => {
    rowFor('tokyo-01');
    expect(screen.getByText('Move to "TOK Tokyo"')).toBeTruthy();
  });

  it('moves exactly that one host, and nothing else', () => {
    const p = rowFor('tokyo-01');
    fireEvent.click(screen.getByText('Move to "TOK Tokyo"'));
    expect(p.onApplyPlacements).toHaveBeenCalledWith([{ hostId: 'match', targetFolderId: 's1' }]);
    expect(p.onApplyPlacements).toHaveBeenCalledTimes(1);
  });

  it('closes the menu after moving', () => {
    rowFor('tokyo-01');
    fireEvent.click(screen.getByText('Move to "TOK Tokyo"'));
    expect(screen.queryByText('Move to "TOK Tokyo"')).toBeNull();
  });

  it('states, without offering a move, that the host is already there', () => {
    rowFor('settled-01');
    const row = screen.getByText('Already in "TOK Tokyo"') as HTMLButtonElement;
    expect(row.closest('button')!.disabled).toBe(true);
  });

  it('states that nothing matches, rather than hiding the row', () => {
    // A missing row cannot answer "why did this one not move?".
    rowFor('edge-01');
    expect(screen.getByText('No IP range matches').closest('button')!.disabled).toBe(true);
  });

  it('never resolves a name, and says so', () => {
    rowFor('named-01');
    expect(screen.getByText('Not an IP address').closest('button')!.disabled).toBe(true);
  });

  it('refuses to split a tie, naming both folders', () => {
    const tied: HostTreeNode[] = [
      { id: 'a', type: 'folder', name: 'TOK Tokyo', children: [], netbox: { server: 'default', kind: 'site', objectId: 10, prefixes: ['10.1.0.0/16'] } },
      { id: 'b', type: 'folder', name: 'OSA Osaka', children: [], netbox: { server: 'default', kind: 'site', objectId: 11, prefixes: ['10.1.0.0/16'] } },
      { id: 'mine', type: 'folder', name: 'Production', children: [
        { id: 'match', type: 'host', name: 'tokyo-01', entry: { protocol: 'ssh', host: '10.1.0.9', port: 22 } },
      ] },
    ];
    const p = rowFor('tokyo-01', props({ tree: tied }));
    const row = screen.getByText(/Several IP ranges match/);
    expect(row.textContent).toContain('OSA Osaka');
    expect(row.textContent).toContain('TOK Tokyo');
    expect(row.closest('button')!.disabled).toBe(true);
    expect(p.onApplyPlacements).not.toHaveBeenCalled();
  });

  it('shows no row at all while the setting is off', () => {
    rowFor('tokyo-01', props({ netboxPlacement: false }));
    expect(screen.queryByText(/Move to |No IP range matches/)).toBeNull();
  });

  it('shows no row at all when no folder carries a range', () => {
    // ADR-020's `noPrefixes`: noise to anyone who has not set the feature up.
    rowFor('tokyo-01', props({
      tree: [{ id: 'mine', type: 'folder', name: 'Production', children: [
        { id: 'match', type: 'host', name: 'tokyo-01', entry: { protocol: 'ssh', host: '10.1.0.9', port: 22 } },
      ] }],
    }));
    expect(screen.queryByText(/Move to |No IP range matches/)).toBeNull();
  });

  it('leaves the folder menu untouched', () => {
    rowFor('Production');
    expect(screen.queryByText(/Move to |No IP range matches/)).toBeNull();
    expect(screen.getByText('Sort by IP Range…')).toBeTruthy();
  });
});

describe('NetBox folder icons', () => {
  const netboxTree: HostTreeNode[] = [
    { id: 'plain', type: 'folder', name: 'Lab', children: [] },
    {
      id: 'container', type: 'folder', name: 'NetBox', children: [
        {
          id: 'region', type: 'folder', name: 'Asia', children: [
            {
              id: 'site', type: 'folder', name: 'tok Tokyo', children: [],
              netbox: { server: 'default', kind: 'site', objectId: 6, prefixes: ['10.6.0.0/16'] },
            },
          ],
          netbox: { server: 'default', kind: 'region', objectId: 1 },
        },
      ],
      netbox: { server: 'default', kind: 'root' },
    },
  ];

  const iconOf = (name: string): string => {
    const row = screen.getByText(name).closest('.host-tree-row') as HTMLElement;
    // [chevron, object icon] — the object icon is the second .tree-icon.
    return row.querySelectorAll('.tree-icon')[1].textContent ?? '';
  };

  it('gives regions, sites and hand-made folders different icons', () => {
    render(<HostTree {...defaultProps} tree={netboxTree} />);
    const icons = [iconOf('Lab'), iconOf('Asia'), iconOf('tok Tokyo')];
    expect(new Set(icons).size).toBe(3);
  });

  it('leaves the NetBox container looking like a plain folder', () => {
    // ADR-018 gives the container's name and position to the user.
    render(<HostTree {...defaultProps} tree={netboxTree} />);
    expect(iconOf('NetBox')).toBe(iconOf('Lab'));
  });

  it('puts the folder ranges in the row tooltip', () => {
    render(<HostTree {...defaultProps} tree={netboxTree} />);
    const row = screen.getByText('tok Tokyo').closest('.host-tree-row') as HTMLElement;
    expect(row.getAttribute('title')).toContain('10.6.0.0/16');
  });
});

describe('HostTree — public key auth in Add Host', () => {
  const jumpTree: HostTreeNode[] = [
    {
      id: 'bastion',
      type: 'host',
      name: 'Bastion',
      entry: { protocol: 'ssh', host: '10.0.0.9', port: 22, isJumpbox: true },
    },
  ];

  /** Open Add Host from the toolbar and fill in the two fields a host needs. */
  function openAddHost(over: Partial<typeof defaultProps> & { tree?: HostTreeNode[] } = {}) {
    const p = { ...defaultProps, ...over, onAddHost: vi.fn() };
    render(<HostTree {...p} />);
    fireEvent.click(screen.getByTitle('Add Host'));
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'new-host' } });
    fireEvent.change(screen.getByPlaceholderText('192.168.1.1'), { target: { value: '10.0.0.50' } });
    return p;
  }

  const keyPathField = () => screen.getByPlaceholderText('~/.ssh/id_rsa');
  /** Two password fields in this form: the account password, then the passphrase. */
  const passphraseField = () =>
    document.querySelectorAll<HTMLInputElement>('.host-edit-modal input[type="password"]')[1];
  const protocolSelect = () => screen.getByDisplayValue('SSH');
  const jumpboxSelect = () => screen.queryByRole('combobox', { name: 'Jumpbox (Bastion)' });

  it('offers the private key fields for an SSH host', () => {
    openAddHost();
    expect(keyPathField()).toBeTruthy();
    expect(passphraseField()).toBeTruthy();
  });

  it('hides the private key fields for a Telnet host', () => {
    openAddHost();
    fireEvent.change(protocolSelect(), { target: { value: 'telnet' } });
    expect(screen.queryByPlaceholderText('~/.ssh/id_rsa')).toBeNull();
  });

  it('saves the key path and passphrase onto the new host', () => {
    const p = openAddHost();
    fireEvent.change(keyPathField(), { target: { value: 'C:/keys/id_ed25519' } });
    fireEvent.change(passphraseField(), { target: { value: 'secret' } });
    fireEvent.click(screen.getByText('Save'));
    expect(p.onAddHost).toHaveBeenCalledWith(
      null,
      'new-host',
      expect.objectContaining({
        privateKeyPath: 'C:/keys/id_ed25519',
        privateKeyPassphrase: 'secret',
      }),
    );
  });

  it('drops the key fields when the protocol is switched to Telnet', () => {
    // A Telnet entry carrying a private key would misdescribe how it connects.
    const p = openAddHost();
    fireEvent.change(keyPathField(), { target: { value: 'C:/keys/id_ed25519' } });
    fireEvent.change(protocolSelect(), { target: { value: 'telnet' } });
    fireEvent.click(screen.getByText('Save'));
    const entry = p.onAddHost.mock.calls[0][2];
    expect(entry.privateKeyPath).toBeUndefined();
    expect(entry.privateKeyPassphrase).toBeUndefined();
  });

  it('forgets the passphrase when the form is opened again', () => {
    openAddHost();
    fireEvent.change(passphraseField(), { target: { value: 'secret' } });
    fireEvent.click(screen.getByText('Cancel'));
    fireEvent.click(screen.getByTitle('Add Host'));
    expect(passphraseField().value).toBe('');
  });

  it('offers the jumpbox picker only when the tree holds a jumpbox', () => {
    openAddHost({ tree: jumpTree });
    expect(jumpboxSelect()).toBeTruthy();
  });

  it('hides the jumpbox picker when no host is marked as one', () => {
    openAddHost();
    expect(jumpboxSelect()).toBeNull();
  });

  it('saves the chosen jumpbox onto the new host', () => {
    const p = openAddHost({ tree: jumpTree });
    fireEvent.change(jumpboxSelect()!, { target: { value: 'bastion' } });
    fireEvent.click(screen.getByText('Save'));
    expect(p.onAddHost).toHaveBeenCalledWith(
      null,
      'new-host',
      expect.objectContaining({ jumpboxId: 'bastion' }),
    );
  });
});
