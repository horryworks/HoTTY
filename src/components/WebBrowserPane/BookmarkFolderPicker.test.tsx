import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BookmarkFolderPicker } from './BookmarkFolderPicker';
import type { BookmarkNode } from '../../types/appTypes';

// A small tree: two top-level folders, one nested folder, and a bookmark that
// must NOT appear in the folder picker.
const tree: BookmarkNode[] = [
  {
    id: 'f-net',
    type: 'folder',
    name: 'Network',
    children: [
      { id: 'f-routers', type: 'folder', name: 'Routers', children: [] },
      { id: 'bm-1', type: 'bookmark', name: 'Router', url: 'http://192.168.1.1' },
    ],
  },
  { id: 'f-docs', type: 'folder', name: 'Docs', children: [] },
];

describe('BookmarkFolderPicker', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the root row and every folder, but no bookmarks', () => {
    render(<BookmarkFolderPicker tree={tree} selectedId={null} onSelect={vi.fn()} />);
    expect(screen.getByText('(Top level)')).toBeTruthy();
    expect(screen.getByText('Network')).toBeTruthy();
    expect(screen.getByText('Routers')).toBeTruthy();
    expect(screen.getByText('Docs')).toBeTruthy();
    // The bookmark "Router" lives under Network but must not be a pick option.
    expect(screen.queryByText('Router')).toBeNull();
  });

  it('marks the selected folder with aria-selected', () => {
    render(<BookmarkFolderPicker tree={tree} selectedId="f-docs" onSelect={vi.fn()} />);
    const row = screen.getByText('Docs').closest('[role="option"]') as HTMLElement;
    expect(row.getAttribute('aria-selected')).toBe('true');
  });

  it('calls onSelect with a folder id when a folder row is clicked', () => {
    const onSelect = vi.fn();
    render(<BookmarkFolderPicker tree={tree} selectedId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Network'));
    expect(onSelect).toHaveBeenCalledWith('f-net');
  });

  it('calls onSelect with null when the root row is clicked', () => {
    const onSelect = vi.fn();
    render(<BookmarkFolderPicker tree={tree} selectedId="f-net" onSelect={onSelect} />);
    fireEvent.click(screen.getByText('(Top level)'));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('selects a folder via keyboard (Enter)', () => {
    const onSelect = vi.fn();
    render(<BookmarkFolderPicker tree={tree} selectedId={null} onSelect={onSelect} />);
    const row = screen.getByText('Docs').closest('[role="option"]') as HTMLElement;
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('f-docs');
  });

  it('collapses a folder when its chevron is clicked, hiding child folders', () => {
    render(<BookmarkFolderPicker tree={tree} selectedId={null} onSelect={vi.fn()} />);
    expect(screen.getByText('Routers')).toBeTruthy();
    const networkRow = screen.getByText('Network').closest('[role="option"]') as HTMLElement;
    // The chevron is the first .tree-icon span in the row.
    const chevron = networkRow.querySelector('.tree-icon') as HTMLElement;
    fireEvent.click(chevron);
    expect(screen.queryByText('Routers')).toBeNull();
  });

  it('does not toggle collapse when the row body (not chevron) is clicked', () => {
    render(<BookmarkFolderPicker tree={tree} selectedId={null} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByText('Network'));
    // Selecting the folder must keep its children visible.
    expect(screen.getByText('Routers')).toBeTruthy();
  });
});
