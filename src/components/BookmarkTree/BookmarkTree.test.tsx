import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BookmarkTree } from './BookmarkTree';
import { useBookmarkStore } from '../../stores/bookmarkStore';
import type { BookmarkNode } from '../../types/appTypes';

beforeEach(() => {
  useBookmarkStore.setState({ tree: [] });
});

describe('BookmarkTree', () => {
  it('renders folders and bookmarks from the store', () => {
    const fid = useBookmarkStore.getState().addFolder(null, 'Tools');
    useBookmarkStore.getState().addBookmark(fid, 'Grafana', 'http://graf');
    render(<BookmarkTree onOpenBookmark={() => {}} />);
    expect(screen.getByText('Tools')).toBeTruthy();
    expect(screen.getByText('Grafana')).toBeTruthy();
  });

  it('shows the empty hint when there are no bookmarks', () => {
    render(<BookmarkTree onOpenBookmark={() => {}} />);
    expect(screen.getByText(/No bookmarks yet/)).toBeTruthy();
  });

  it('double-clicking a bookmark calls onOpenBookmark with its URL', () => {
    useBookmarkStore.getState().addBookmark(null, 'Docs', 'http://docs.test');
    const onOpen = vi.fn();
    render(<BookmarkTree onOpenBookmark={onOpen} />);
    fireEvent.doubleClick(screen.getByText('Docs'));
    expect(onOpen).toHaveBeenCalledWith('http://docs.test');
  });

  it('renders the "New Web Browser" entry and invokes onNewBlank', () => {
    const onNewBlank = vi.fn();
    render(<BookmarkTree onOpenBookmark={() => {}} onNewBlank={onNewBlank} />);
    fireEvent.click(screen.getByText('New Web Browser'));
    expect(onNewBlank).toHaveBeenCalledTimes(1);
  });

  it('omits the "New Web Browser" entry when onNewBlank is not provided', () => {
    render(<BookmarkTree onOpenBookmark={() => {}} />);
    expect(screen.queryByText('New Web Browser')).toBeNull();
  });

  it('adds a folder via the toolbar + modal', () => {
    render(<BookmarkTree onOpenBookmark={() => {}} />);
    fireEvent.click(screen.getByTitle('Add Folder'));
    const nameInput = document.querySelector('.host-edit-modal input[type="text"]') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'New Folder' } });
    fireEvent.click(screen.getByText('Save'));
    expect(useBookmarkStore.getState().tree.some((n) => n.name === 'New Folder' && n.type === 'folder')).toBe(true);
  });

  it('adds a bookmark via the toolbar + modal (name + url)', () => {
    render(<BookmarkTree onOpenBookmark={() => {}} />);
    fireEvent.click(screen.getByTitle('Add Bookmark'));
    const inputs = document.querySelectorAll('.host-edit-modal input[type="text"]');
    fireEvent.change(inputs[0], { target: { value: 'Router' } });
    fireEvent.change(inputs[1], { target: { value: 'http://192.168.1.1' } });
    fireEvent.click(screen.getByText('Save'));
    const added = useBookmarkStore.getState().tree.find((n) => n.name === 'Router');
    expect(added?.url).toBe('http://192.168.1.1');
  });

  it('shows "Open All" for a non-empty folder and calls onOpenAll (small folder: no confirm)', () => {
    useBookmarkStore.setState({
      tree: [
        { id: 'f1', type: 'folder', name: 'Tools', children: [
          { id: 'b1', type: 'bookmark', name: 'Grafana', url: 'http://graf' },
        ] },
      ],
    });
    const onOpenAll = vi.fn();
    render(<BookmarkTree onOpenBookmark={() => {}} onOpenAll={onOpenAll} />);
    fireEvent.contextMenu(screen.getByText('Tools'));
    fireEvent.click(screen.getByText('Open All'));
    expect(onOpenAll).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' }));
  });

  it('shows "Open All" as the first item of the folder context menu', () => {
    useBookmarkStore.setState({
      tree: [
        { id: 'f1', type: 'folder', name: 'Tools', children: [
          { id: 'b1', type: 'bookmark', name: 'Grafana', url: 'http://graf' },
        ] },
      ],
    });
    const { container } = render(<BookmarkTree onOpenBookmark={() => {}} onOpenAll={vi.fn()} />);
    fireEvent.contextMenu(screen.getByText('Tools'));
    const buttons = container.querySelectorAll('.context-menu button');
    expect(buttons[0].textContent).toBe('Open All');
  });

  it('sorts a folder descending via the right-click menu', () => {
    useBookmarkStore.setState({
      tree: [
        { id: 'f1', type: 'folder', name: 'Tools', children: [
          { id: 'a', type: 'bookmark', name: 'Alpha', url: 'http://a' },
          { id: 'z', type: 'bookmark', name: 'Zeta', url: 'http://z' },
        ] },
      ],
    });
    render(<BookmarkTree onOpenBookmark={() => {}} />);
    fireEvent.contextMenu(screen.getByText('Tools'));
    fireEvent.click(screen.getByText('Sort Descending'));
    const children = useBookmarkStore.getState().tree[0].children!;
    expect(children.map((c) => c.id)).toEqual(['z', 'a']);
  });

  it('does not show "Open All" for an empty folder', () => {
    useBookmarkStore.setState({ tree: [{ id: 'f1', type: 'folder', name: 'Empty', children: [] }] });
    render(<BookmarkTree onOpenBookmark={() => {}} onOpenAll={vi.fn()} />);
    fireEvent.contextMenu(screen.getByText('Empty'));
    expect(screen.queryByText('Open All')).toBeNull();
  });

  it('confirms before opening when a folder holds 5+ bookmarks', () => {
    const children: BookmarkNode[] = Array.from({ length: 5 }, (_, i) => ({
      id: `b${i}`,
      type: 'bookmark',
      name: `B${i}`,
      url: `http://b${i}.test/`,
    }));
    useBookmarkStore.setState({ tree: [{ id: 'f-big', type: 'folder', name: 'Many', children }] });
    const onOpenAll = vi.fn();
    render(<BookmarkTree onOpenBookmark={() => {}} onOpenAll={onOpenAll} />);
    fireEvent.contextMenu(screen.getByText('Many'));
    fireEvent.click(screen.getByText('Open All'));
    expect(onOpenAll).not.toHaveBeenCalled();
    expect(screen.getByText('Open all bookmarks')).toBeTruthy();
    fireEvent.click(screen.getByText('Open All')); // confirm button
    expect(onOpenAll).toHaveBeenCalledWith(expect.objectContaining({ id: 'f-big' }));
  });
});
