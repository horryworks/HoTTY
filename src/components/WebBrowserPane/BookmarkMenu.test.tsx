import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BookmarkMenu } from './BookmarkMenu';
import type { BookmarkNode } from '../../types/appTypes';

const tree: BookmarkNode[] = [
  {
    id: 'f-net',
    type: 'folder',
    name: 'Network',
    children: [{ id: 'b-router', type: 'bookmark', name: 'Router', url: 'http://192.168.1.1/' }],
  },
  { id: 'b-top', type: 'bookmark', name: 'Example', url: 'https://example.com' },
];

describe('BookmarkMenu', () => {
  it('shows the empty state when there are no bookmarks', () => {
    render(<BookmarkMenu tree={[]} onSelect={vi.fn()} />);
    expect(screen.getByText('No bookmarks yet')).toBeTruthy();
  });

  it('renders folders and bookmarks (folders expanded by default)', () => {
    render(<BookmarkMenu tree={tree} onSelect={vi.fn()} />);
    expect(screen.getByText('Network')).toBeTruthy();
    expect(screen.getByText('Router')).toBeTruthy(); // nested, visible because expanded
    expect(screen.getByText('Example')).toBeTruthy();
  });

  it('navigates with the bookmark URL when a top-level bookmark is clicked', () => {
    const onSelect = vi.fn();
    render(<BookmarkMenu tree={tree} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Example'));
    expect(onSelect).toHaveBeenCalledWith('https://example.com');
  });

  it('navigates with the bookmark URL when a nested bookmark is activated by Enter', () => {
    const onSelect = vi.fn();
    render(<BookmarkMenu tree={tree} onSelect={onSelect} />);
    fireEvent.keyDown(screen.getByText('Router').closest('.host-tree-row')!, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('http://192.168.1.1/');
  });

  it('collapses a folder, hiding its children; clicking a folder does not navigate', () => {
    const onSelect = vi.fn();
    render(<BookmarkMenu tree={tree} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Network'));
    expect(screen.queryByText('Router')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
