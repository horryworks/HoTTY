import type { BookmarkNode } from '../../types/appTypes';

/** Generate a unique bookmark-tree node id. */
export function makeBookmarkId(): string {
  return `bm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Find a node by id anywhere in the tree (depth-first). */
export function findNode(tree: BookmarkNode[], id: string): BookmarkNode | null {
  for (const n of tree) {
    if (n.id === id) return n;
    if (n.children) {
      const found = findNode(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

/** Find the first bookmark whose URL exactly matches `url` (depth-first), or
 *  null. Used by the Web Browser ★ button to reflect/toggle bookmarked state. */
export function findBookmarkByUrl(tree: BookmarkNode[], url: string): BookmarkNode | null {
  for (const n of tree) {
    if (n.type === 'bookmark' && n.url === url) return n;
    if (n.children) {
      const found = findBookmarkByUrl(n.children, url);
      if (found) return found;
    }
  }
  return null;
}

/** Validate that untrusted data (e.g. an imported JSON file or rehydrated
 *  localStorage) is a well-formed bookmark tree. Returns the typed tree on
 *  success or null if any node is malformed. */
export function validateBookmarkTree(data: unknown): BookmarkNode[] | null {
  if (!Array.isArray(data)) return null;
  return data.every(isValidBookmarkNode) ? (data as BookmarkNode[]) : null;
}

function isValidBookmarkNode(node: unknown): node is BookmarkNode {
  if (typeof node !== 'object' || node === null) return false;
  const o = node as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.name !== 'string') return false;
  if (o.type !== 'folder' && o.type !== 'bookmark') return false;
  if (o.type === 'bookmark' && typeof o.url !== 'string') return false;
  if (o.children !== undefined) {
    if (!Array.isArray(o.children)) return false;
    if (!o.children.every(isValidBookmarkNode)) return false;
  }
  return true;
}

/** Insert `node` under `parentId` (null = root), appended to the end.
 *  Returns a new tree (immutable). */
export function insertNode(
  tree: BookmarkNode[],
  parentId: string | null,
  node: BookmarkNode,
): BookmarkNode[] {
  if (parentId === null) return [...tree, node];
  return tree.map((n) => {
    if (n.id === parentId && n.type === 'folder') {
      return { ...n, children: [...(n.children ?? []), node] };
    }
    if (n.children) return { ...n, children: insertNode(n.children, parentId, node) };
    return n;
  });
}

/** Remove the node with `id`, returning the new tree and the removed node. */
export function removeNode(
  tree: BookmarkNode[],
  id: string,
): { tree: BookmarkNode[]; removed: BookmarkNode | null } {
  let removed: BookmarkNode | null = null;
  const walk = (nodes: BookmarkNode[]): BookmarkNode[] => {
    const out: BookmarkNode[] = [];
    for (const n of nodes) {
      if (n.id === id) {
        removed = n;
        continue;
      }
      out.push(n.children ? { ...n, children: walk(n.children) } : n);
    }
    return out;
  };
  const next = walk(tree);
  return { tree: next, removed };
}

/** Shallow-patch a node's fields (name/url). Returns a new tree. */
export function patchNode(
  tree: BookmarkNode[],
  id: string,
  patch: Partial<BookmarkNode>,
): BookmarkNode[] {
  return tree.map((n) => {
    if (n.id === id) return { ...n, ...patch };
    if (n.children) return { ...n, children: patchNode(n.children, id, patch) };
    return n;
  });
}

/** True if `ancestorId` is `id` or contains `id` in its subtree — used to block
 *  dropping a folder into its own descendant. (Exported for unit tests.) */
export function isSelfOrDescendant(
  tree: BookmarkNode[],
  ancestorId: string,
  id: string,
): boolean {
  if (ancestorId === id) return true;
  const node = findNode(tree, ancestorId);
  if (!node?.children) return false;
  return findNode(node.children, id) !== null;
}

export type DropPosition = 'before' | 'after' | 'inside';

/** Move `nodeId` relative to `targetId`. `inside` only applies to folder
 *  targets. No-ops (returns the original tree) on invalid moves: missing nodes,
 *  dropping a folder into its own subtree, or `inside` a non-folder. */
export function moveNode(
  tree: BookmarkNode[],
  nodeId: string,
  targetId: string,
  position: DropPosition,
): BookmarkNode[] {
  if (nodeId === targetId) return tree;
  if (isSelfOrDescendant(tree, nodeId, targetId)) return tree;
  const target = findNode(tree, targetId);
  if (!target) return tree;
  if (position === 'inside' && target.type !== 'folder') return tree;

  const { tree: without, removed } = removeNode(tree, nodeId);
  if (!removed) return tree;

  if (position === 'inside') {
    return insertNode(without, targetId, removed);
  }

  // before/after: insert as sibling of target at target's location.
  const insertSibling = (nodes: BookmarkNode[]): BookmarkNode[] => {
    const idx = nodes.findIndex((n) => n.id === targetId);
    if (idx !== -1) {
      const at = position === 'before' ? idx : idx + 1;
      const out = [...nodes];
      out.splice(at, 0, removed!);
      return out;
    }
    return nodes.map((n) => (n.children ? { ...n, children: insertSibling(n.children) } : n));
  };
  return insertSibling(without);
}

/** Sort the children of `folderId` (null = root) alphabetically, folders first
 *  (case-insensitive). Non-recursive — sorts one level, like the host tree. */
export function sortFolder(tree: BookmarkNode[], folderId: string | null): BookmarkNode[] {
  const cmp = (a: BookmarkNode, b: BookmarkNode) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  };
  if (folderId === null) return [...tree].sort(cmp);
  return tree.map((n) => {
    if (n.id === folderId && n.type === 'folder' && n.children) {
      return { ...n, children: [...n.children].sort(cmp) };
    }
    if (n.children) return { ...n, children: sortFolder(n.children, folderId) };
    return n;
  });
}

/** Flatten all folders (for the "choose a folder" dropdown), with indented
 *  labels reflecting depth. Root is represented separately by the caller. */
export function flattenFolders(
  tree: BookmarkNode[],
  depth = 0,
): { id: string; name: string; depth: number }[] {
  const out: { id: string; name: string; depth: number }[] = [];
  for (const n of tree) {
    if (n.type === 'folder') {
      out.push({ id: n.id, name: n.name, depth });
      if (n.children) out.push(...flattenFolders(n.children, depth + 1));
    }
  }
  return out;
}
