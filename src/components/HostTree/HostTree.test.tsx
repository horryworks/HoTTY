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

  it('shows sort option for folder context menu', () => {
    render(<HostTree {...defaultProps} />);
    fireEvent.contextMenu(screen.getByText('Production'));
    expect(screen.getByText('Sort Ascending')).toBeTruthy();
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
});
