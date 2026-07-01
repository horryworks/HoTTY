import { describe, it, expect } from 'vitest';
import type { BookmarkNode } from '../../types/appTypes';
import {
  makeBookmarkId,
  findNode,
  findBookmarkByUrl,
  validateBookmarkTree,
  insertNode,
  removeNode,
  patchNode,
  isSelfOrDescendant,
  moveNode,
  sortFolder,
  flattenFolders,
  flattenBookmarks,
} from './bookmarkTreeHelpers';

const folder = (id: string, name: string, children: BookmarkNode[] = []): BookmarkNode => ({
  id,
  type: 'folder',
  name,
  children,
});
const bm = (id: string, name: string, url: string): BookmarkNode => ({
  id,
  type: 'bookmark',
  name,
  url,
});

function sample(): BookmarkNode[] {
  return [
    folder('f1', 'Tools', [bm('b1', 'Grafana', 'http://graf'), bm('b2', 'Jenkins', 'http://jen')]),
    bm('b3', 'Docs', 'http://docs'),
  ];
}

describe('bookmarkTreeHelpers', () => {
  it('makeBookmarkId is prefixed and unique', () => {
    const ids = new Set(Array.from({ length: 20 }, () => makeBookmarkId()));
    expect(ids.size).toBe(20);
    expect([...ids][0].startsWith('bm-')).toBe(true);
  });

  it('findNode locates nodes at any depth', () => {
    const tree = sample();
    expect(findNode(tree, 'b2')?.name).toBe('Jenkins');
    expect(findNode(tree, 'f1')?.type).toBe('folder');
    expect(findNode(tree, 'nope')).toBeNull();
  });

  it('insertNode appends at root and into folders (immutably)', () => {
    const tree = sample();
    const atRoot = insertNode(tree, null, bm('b4', 'New', 'http://new'));
    expect(atRoot).not.toBe(tree);
    expect(atRoot.map((n) => n.id)).toContain('b4');

    const inFolder = insertNode(tree, 'f1', bm('b5', 'X', 'http://x'));
    expect(findNode(inFolder, 'f1')?.children?.map((c) => c.id)).toEqual(['b1', 'b2', 'b5']);
  });

  it('removeNode returns the new tree and the removed node', () => {
    const { tree, removed } = removeNode(sample(), 'b1');
    expect(removed?.name).toBe('Grafana');
    expect(findNode(tree, 'b1')).toBeNull();
    expect(findNode(tree, 'b2')).not.toBeNull();
  });

  it('patchNode shallow-merges fields', () => {
    const tree = patchNode(sample(), 'b3', { name: 'Documentation', url: 'http://d2' });
    const n = findNode(tree, 'b3');
    expect(n?.name).toBe('Documentation');
    expect(n?.url).toBe('http://d2');
  });

  it('isSelfOrDescendant guards folder-into-own-subtree', () => {
    const tree = sample();
    expect(isSelfOrDescendant(tree, 'f1', 'f1')).toBe(true);
    expect(isSelfOrDescendant(tree, 'f1', 'b1')).toBe(true);
    expect(isSelfOrDescendant(tree, 'f1', 'b3')).toBe(false);
  });

  it('moveNode reorders siblings (before/after)', () => {
    const moved = moveNode(sample(), 'b3', 'f1', 'before');
    expect(moved.map((n) => n.id)).toEqual(['b3', 'f1']);
  });

  it('moveNode inside a folder', () => {
    const moved = moveNode(sample(), 'b3', 'f1', 'inside');
    expect(findNode(moved, 'f1')?.children?.map((c) => c.id)).toEqual(['b1', 'b2', 'b3']);
    expect(moved.find((n) => n.id === 'b3')).toBeUndefined();
  });

  it('moveNode refuses dropping a folder into its own descendant', () => {
    const tree = sample();
    const moved = moveNode(tree, 'f1', 'b1', 'after');
    expect(moved).toBe(tree); // no-op
  });

  it('moveNode refuses inside a non-folder', () => {
    const tree = sample();
    expect(moveNode(tree, 'b3', 'b1', 'inside')).toBe(tree);
  });

  it('sortFolder sorts a level, folders first then by name', () => {
    const tree: BookmarkNode[] = [
      bm('z', 'Zebra', 'http://z'),
      folder('m', 'Mango'),
      bm('a', 'Apple', 'http://a'),
      folder('b', 'Banana'),
    ];
    const sorted = sortFolder(tree, null);
    expect(sorted.map((n) => n.name)).toEqual(['Banana', 'Mango', 'Apple', 'Zebra']);
  });

  it('flattenFolders returns only folders with depth', () => {
    const tree = [folder('f1', 'A', [folder('f2', 'B'), bm('b1', 'x', 'http://x')])];
    expect(flattenFolders(tree)).toEqual([
      { id: 'f1', name: 'A', depth: 0 },
      { id: 'f2', name: 'B', depth: 1 },
    ]);
  });

  describe('flattenBookmarks', () => {
    it('collects all bookmarks depth-first, including nested subfolders, in order', () => {
      const tree = [
        folder('f1', 'A', [
          bm('b1', 'one', 'http://1'),
          folder('f2', 'B', [bm('b2', 'two', 'http://2')]),
        ]),
        bm('b3', 'three', 'http://3'),
      ];
      expect(flattenBookmarks(tree).map((b) => b.id)).toEqual(['b1', 'b2', 'b3']);
    });

    it('returns an empty array for an empty tree or a folder with no bookmarks', () => {
      expect(flattenBookmarks([])).toEqual([]);
      expect(flattenBookmarks([folder('f', 'Empty', [folder('g', 'Nested')])])).toEqual([]);
    });
  });

  it('findBookmarkByUrl matches a bookmark at any depth, ignoring folders', () => {
    const tree = sample();
    expect(findBookmarkByUrl(tree, 'http://jen')?.id).toBe('b2');
    expect(findBookmarkByUrl(tree, 'http://docs')?.id).toBe('b3');
    expect(findBookmarkByUrl(tree, 'http://missing')).toBeNull();
  });

  describe('validateBookmarkTree', () => {
    it('accepts a well-formed tree (folders + bookmarks, nested)', () => {
      const tree = sample();
      expect(validateBookmarkTree(tree)).toBe(tree);
      expect(validateBookmarkTree([])).toEqual([]);
    });

    it('rejects non-arrays', () => {
      expect(validateBookmarkTree(null)).toBeNull();
      expect(validateBookmarkTree({})).toBeNull();
      expect(validateBookmarkTree('[]')).toBeNull();
    });

    it('rejects malformed nodes (bad type, missing fields, bad children)', () => {
      expect(validateBookmarkTree([{ id: 'x', name: 'X', type: 'link' }])).toBeNull();
      expect(validateBookmarkTree([{ id: 'x', type: 'bookmark' }])).toBeNull(); // no name
      expect(validateBookmarkTree([{ id: 'x', name: 'X', type: 'bookmark' }])).toBeNull(); // no url
      expect(
        validateBookmarkTree([{ id: 'f', name: 'F', type: 'folder', children: [{ bad: true }] }]),
      ).toBeNull();
      expect(
        validateBookmarkTree([{ id: 'f', name: 'F', type: 'folder', children: 'nope' }]),
      ).toBeNull();
    });
  });
});
