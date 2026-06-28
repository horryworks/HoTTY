import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BookmarkMenu } from './BookmarkMenu';
import { useBookmarkStore } from '../../stores/bookmarkStore';
import { tauriService } from '../../services/tauriService';
import type { BookmarkNode } from '../../types/appTypes';

vi.mock('../../services/tauriService', () => ({
  tauriService: {
    webBrowserExportBookmarks: vi.fn().mockResolvedValue(true),
    webBrowserImportBookmarks: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock('../../utils/logger', () => ({ logError: vi.fn() }));

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

// --- Editing: rename / delete / sort / drag-and-drop reorder & move ---
// These exercise the store-backed mutations, so they render through a wrapper that
// feeds the live store tree into BookmarkMenu (mirroring WebBrowserPane's usage).

function Harness({ onSelect = () => {} }: { onSelect?: (url: string) => void }) {
  const liveTree = useBookmarkStore((s) => s.tree);
  return <BookmarkMenu tree={liveTree} onSelect={onSelect} />;
}

/** A drag event needs a dataTransfer; jsdom does not supply one, so fake it. */
function fakeDataTransfer() {
  return { setData: vi.fn(), getData: vi.fn(), effectAllowed: '', dropEffect: '' };
}

const ids = () => useBookmarkStore.getState().tree.map((n) => n.id);

describe('BookmarkMenu editing', () => {
  beforeEach(() => {
    useBookmarkStore.setState({ tree: [] });
  });

  it('renames a bookmark via the right-click menu (inline edit)', () => {
    useBookmarkStore.setState({
      tree: [{ id: 'b1', type: 'bookmark', name: 'Old Name', url: 'http://a.test/' }],
    });
    render(<Harness />);

    fireEvent.contextMenu(screen.getByText('Old Name'));
    fireEvent.click(screen.getByText('Rename'));

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('Old Name');
    fireEvent.change(input, { target: { value: 'New Name' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(useBookmarkStore.getState().tree[0].name).toBe('New Name');
    expect(screen.getByText('New Name')).toBeTruthy();
  });

  it('cancels an inline rename on Escape (no change)', () => {
    useBookmarkStore.setState({
      tree: [{ id: 'b1', type: 'bookmark', name: 'Keep Me', url: 'http://a.test/' }],
    });
    render(<Harness />);
    fireEvent.contextMenu(screen.getByText('Keep Me'));
    fireEvent.click(screen.getByText('Rename'));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Discarded' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(useBookmarkStore.getState().tree[0].name).toBe('Keep Me');
  });

  it('deletes a bookmark via the right-click menu after confirmation', () => {
    useBookmarkStore.setState({
      tree: [
        { id: 'b1', type: 'bookmark', name: 'Alpha', url: 'http://a.test/' },
        { id: 'b2', type: 'bookmark', name: 'Beta', url: 'http://b.test/' },
      ],
    });
    const { container } = render(<Harness />);

    fireEvent.contextMenu(screen.getByText('Alpha'));
    // The context menu's danger button (disambiguated from the confirm dialog's).
    const menuDelete = container.querySelector('.context-menu button.danger') as HTMLButtonElement;
    fireEvent.click(menuDelete);

    // Confirm in the modal.
    const confirmBtn = container.querySelector('.confirm-btn.danger') as HTMLButtonElement;
    expect(confirmBtn).toBeTruthy();
    fireEvent.click(confirmBtn);

    expect(ids()).toEqual(['b2']);
  });

  it('sorts a folder ascending via the right-click menu', () => {
    useBookmarkStore.setState({
      tree: [
        {
          id: 'f1',
          type: 'folder',
          name: 'Folder',
          children: [
            { id: 'z', type: 'bookmark', name: 'Zeta', url: 'http://z.test/' },
            { id: 'a', type: 'bookmark', name: 'Alpha', url: 'http://a.test/' },
          ],
        },
      ],
    });
    render(<Harness />);

    fireEvent.contextMenu(screen.getByText('Folder'));
    fireEvent.click(screen.getByText('Sort Ascending'));

    const children = useBookmarkStore.getState().tree[0].children as BookmarkNode[];
    expect(children.map((c) => c.id)).toEqual(['a', 'z']);
  });

  it('reorders root bookmarks by drag and drop', () => {
    useBookmarkStore.setState({
      tree: [
        { id: 'a', type: 'bookmark', name: 'Alpha', url: 'http://a.test/' },
        { id: 'b', type: 'bookmark', name: 'Beta', url: 'http://b.test/' },
      ],
    });
    render(<Harness />);

    const alpha = screen.getByText('Alpha').closest('.host-tree-row') as HTMLElement;
    const beta = screen.getByText('Beta').closest('.host-tree-row') as HTMLElement;
    const dt = fakeDataTransfer();

    fireEvent.dragStart(alpha, { dataTransfer: dt });
    fireEvent.dragOver(beta, { dataTransfer: dt });
    fireEvent.drop(beta, { dataTransfer: dt });

    // jsdom rows have zero height → a bookmark drop lands "after" the target.
    expect(ids()).toEqual(['b', 'a']);
  });

  it('moves a bookmark into a folder by dropping onto it', () => {
    useBookmarkStore.setState({
      tree: [
        { id: 'f1', type: 'folder', name: 'Folder', children: [] },
        { id: 'b1', type: 'bookmark', name: 'Loose', url: 'http://loose.test/' },
      ],
    });
    render(<Harness />);

    const folder = screen.getByText('Folder').closest('.host-tree-row') as HTMLElement;
    const loose = screen.getByText('Loose').closest('.host-tree-row') as HTMLElement;
    const dt = fakeDataTransfer();

    fireEvent.dragStart(loose, { dataTransfer: dt });
    fireEvent.dragOver(folder, { dataTransfer: dt });
    fireEvent.drop(folder, { dataTransfer: dt });

    // An empty folder with zero height → drop lands "inside" it.
    const next = useBookmarkStore.getState().tree;
    expect(next.map((n) => n.id)).toEqual(['f1']);
    expect(next[0].children?.map((c) => c.id)).toEqual(['b1']);
  });
});

describe('BookmarkMenu export / import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tauriService.webBrowserExportBookmarks).mockResolvedValue(true);
    vi.mocked(tauriService.webBrowserImportBookmarks).mockResolvedValue(null);
    useBookmarkStore.setState({ tree: [] });
  });

  it('disables Export when there are no bookmarks', () => {
    render(<BookmarkMenu tree={[]} onSelect={vi.fn()} />);
    expect(screen.getByText('Export')).toHaveProperty('disabled', true);
  });

  it('exports the serialized tree via the backend save dialog', async () => {
    render(<BookmarkMenu tree={tree} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByText('Export'));
    await waitFor(() =>
      expect(tauriService.webBrowserExportBookmarks).toHaveBeenCalledWith(JSON.stringify(tree)),
    );
  });

  it('imports a valid file and replaces the tree after confirmation', async () => {
    const imported: BookmarkNode[] = [
      { id: 'n1', type: 'bookmark', name: 'Imported', url: 'http://imported.test/' },
    ];
    vi.mocked(tauriService.webBrowserImportBookmarks).mockResolvedValue(JSON.stringify(imported));
    useBookmarkStore.setState({ tree });
    const { container } = render(<BookmarkMenu tree={tree} onSelect={vi.fn()} />);

    fireEvent.click(screen.getByText('Import'));
    // Confirmation modal appears before anything is replaced.
    await screen.findByText('Replace bookmarks?');
    expect(useBookmarkStore.getState().tree).toEqual(tree); // not yet replaced

    fireEvent.click(container.querySelector('.confirm-btn.danger') as HTMLButtonElement);
    expect(useBookmarkStore.getState().tree).toEqual(imported);
  });

  it('rejects an invalid import without touching the tree (no confirm modal)', async () => {
    vi.mocked(tauriService.webBrowserImportBookmarks).mockResolvedValue('{"not":"an array"}');
    useBookmarkStore.setState({ tree });
    render(<BookmarkMenu tree={tree} onSelect={vi.fn()} />);

    fireEvent.click(screen.getByText('Import'));
    await waitFor(() => expect(tauriService.webBrowserImportBookmarks).toHaveBeenCalled());
    expect(screen.queryByText('Replace bookmarks?')).toBeNull();
    expect(useBookmarkStore.getState().tree).toEqual(tree);
  });

  it('does nothing when the import dialog is cancelled', async () => {
    vi.mocked(tauriService.webBrowserImportBookmarks).mockResolvedValue(null);
    useBookmarkStore.setState({ tree });
    render(<BookmarkMenu tree={tree} onSelect={vi.fn()} />);

    fireEvent.click(screen.getByText('Import'));
    await waitFor(() => expect(tauriService.webBrowserImportBookmarks).toHaveBeenCalled());
    expect(screen.queryByText('Replace bookmarks?')).toBeNull();
    expect(useBookmarkStore.getState().tree).toEqual(tree);
  });
});
