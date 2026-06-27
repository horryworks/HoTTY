import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BookmarkNode } from '../types/appTypes';
import {
  insertNode,
  removeNode,
  patchNode,
  moveNode as moveNodeOp,
  sortFolder as sortFolderOp,
  makeBookmarkId,
  type DropPosition,
} from '../components/BookmarkTree/bookmarkTreeHelpers';

/**
 * Web bookmarks (SessionDialog "Web" tab). A folder/bookmark tree of plain
 * name + URL entries — NO secrets, so this is a plain `persist` store
 * (localStorage), unlike the host tree which needs DPAPI. All tree mutations
 * delegate to the pure helpers in `bookmarkTreeHelpers.ts`.
 */
interface BookmarkState {
  tree: BookmarkNode[];
  addFolder: (parentId: string | null, name: string) => string;
  addBookmark: (parentId: string | null, name: string, url: string) => string;
  editNode: (id: string, patch: Partial<BookmarkNode>) => void;
  deleteNode: (id: string) => void;
  moveNode: (nodeId: string, targetId: string, position: DropPosition) => void;
  sortFolder: (folderId: string | null) => void;
}

export const useBookmarkStore = create<BookmarkState>()(
  persist(
    (set) => ({
      tree: [],
      addFolder: (parentId, name) => {
        const id = makeBookmarkId();
        const node: BookmarkNode = { id, type: 'folder', name, children: [] };
        set((s) => ({ tree: insertNode(s.tree, parentId, node) }));
        return id;
      },
      addBookmark: (parentId, name, url) => {
        const id = makeBookmarkId();
        const node: BookmarkNode = { id, type: 'bookmark', name, url };
        set((s) => ({ tree: insertNode(s.tree, parentId, node) }));
        return id;
      },
      editNode: (id, patch) => set((s) => ({ tree: patchNode(s.tree, id, patch) })),
      deleteNode: (id) => set((s) => ({ tree: removeNode(s.tree, id).tree })),
      moveNode: (nodeId, targetId, position) =>
        set((s) => ({ tree: moveNodeOp(s.tree, nodeId, targetId, position) })),
      sortFolder: (folderId) => set((s) => ({ tree: sortFolderOp(s.tree, folderId) })),
    }),
    {
      name: 'hotty-bookmarks',
      version: 1,
    },
  ),
);
