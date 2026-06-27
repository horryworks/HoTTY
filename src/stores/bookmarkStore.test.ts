import { describe, it, expect, beforeEach } from 'vitest';
import { useBookmarkStore } from './bookmarkStore';
import { findNode } from '../components/BookmarkTree/bookmarkTreeHelpers';

const store = () => useBookmarkStore.getState();

beforeEach(() => {
  useBookmarkStore.setState({ tree: [] });
});

describe('bookmarkStore', () => {
  it('addFolder / addBookmark insert and return ids', () => {
    const fid = store().addFolder(null, 'Tools');
    const bid = store().addBookmark(fid, 'Grafana', 'http://graf');
    const tree = store().tree;
    expect(findNode(tree, fid)?.type).toBe('folder');
    const bm = findNode(tree, bid);
    expect(bm?.url).toBe('http://graf');
    expect(findNode(tree, fid)?.children?.map((c) => c.id)).toContain(bid);
  });

  it('editNode patches name/url', () => {
    const bid = store().addBookmark(null, 'X', 'http://x');
    store().editNode(bid, { name: 'Y', url: 'http://y' });
    expect(findNode(store().tree, bid)).toMatchObject({ name: 'Y', url: 'http://y' });
  });

  it('deleteNode removes a node and its subtree', () => {
    const fid = store().addFolder(null, 'F');
    store().addBookmark(fid, 'C', 'http://c');
    store().deleteNode(fid);
    expect(findNode(store().tree, fid)).toBeNull();
    expect(store().tree).toHaveLength(0);
  });

  it('moveNode relocates a bookmark into a folder', () => {
    const fid = store().addFolder(null, 'F');
    const bid = store().addBookmark(null, 'B', 'http://b');
    store().moveNode(bid, fid, 'inside');
    expect(store().tree.map((n) => n.id)).toEqual([fid]);
    expect(findNode(store().tree, fid)?.children?.[0]?.id).toBe(bid);
  });

  it('sortFolder sorts root children', () => {
    store().addBookmark(null, 'Zebra', 'http://z');
    store().addBookmark(null, 'Apple', 'http://a');
    store().sortFolder(null);
    expect(store().tree.map((n) => n.name)).toEqual(['Apple', 'Zebra']);
  });
});
