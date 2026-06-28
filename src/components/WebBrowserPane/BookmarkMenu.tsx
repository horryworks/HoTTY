import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { BookmarkNode } from '../../types/appTypes';
import { useBookmarkStore } from '../../stores/bookmarkStore';
import { useModalState } from '../../hooks/useModalState';
import { ConfirmModal } from '../ConfirmModal/ConfirmModal';
import { findNode, validateBookmarkTree } from '../BookmarkTree/bookmarkTreeHelpers';
import { tauriService } from '../../services/tauriService';
import { logError } from '../../utils/logger';
// Reuse the host/bookmark tree visual styles (rows, chevron, icons, labels,
// drag affordances, context menu, inline-rename input).
import '../HostTree/HostTree.css';
import './BookmarkMenu.css';

interface BookmarkMenuProps {
  /** Full bookmark tree (folders + bookmarks). */
  tree: BookmarkNode[];
  /** Called with a bookmark's URL when its row is activated (click / Enter). */
  onSelect: (url: string) => void;
}

type DropPos = 'before' | 'after' | 'inside';

interface ContextMenuState {
  x: number;
  y: number;
  node: BookmarkNode;
}

/**
 * Editable listing of the bookmark tree, opened from the Web Browser toolbar's
 * bookmarks button. Folders expand/collapse; clicking a bookmark navigates the
 * current pane (via {@link onSelect}). Rows can be dragged to reorder/move
 * (into folders), right-clicked to rename/sort/delete, and renamed inline.
 * Mutations delegate to the shared {@link useBookmarkStore}; row rendering and
 * drag/context-menu affordances reuse the host-tree styles.
 *
 * It renders inside `.web-browser-bookmark-panel`, a side panel that docks to the
 * right of the page: because the OS-composited native webview cannot be painted
 * over by HTML, the webview slot shrinks and this list sits beside the page
 * (keeping it visible) rather than floating above it. Drag/drop stays entirely
 * within this HTML panel (the drop targets are rows, not the webview region), so
 * the native webview never swallows the drag events.
 */
export function BookmarkMenu({ tree, onSelect }: BookmarkMenuProps) {
  const { t } = useTranslation();
  const editNode = useBookmarkStore((s) => s.editNode);
  const deleteNode = useBookmarkStore((s) => s.deleteNode);
  const moveNode = useBookmarkStore((s) => s.moveNode);
  const sortFolder = useBookmarkStore((s) => s.sortFolder);
  const replaceTree = useBookmarkStore((s) => s.replaceTree);

  // Folders default to expanded so the whole tree is visible on open.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ nodeId: string; position: DropPos } | null>(null);
  const [nodeToDeleteOpen, openNodeToDelete, closeNodeToDelete, nodeToDelete] =
    useModalState<BookmarkNode>();
  // Validated tree awaiting the user's confirmation to replace the current one.
  const [importOpen, openImport, closeImport, importTree] = useModalState<BookmarkNode[]>();

  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Export the whole tree to a JSON file (native save dialog on the backend).
  const handleExport = async () => {
    try {
      await tauriService.webBrowserExportBookmarks(JSON.stringify(tree));
    } catch (err) {
      logError('web-browser', t('panes.webBrowser.bookmarksExportError'), err);
    }
  };

  // Pick a JSON file, validate its shape, then confirm before replacing the tree.
  const handleImport = async () => {
    try {
      const raw = await tauriService.webBrowserImportBookmarks();
      if (raw == null) return; // cancelled
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        logError('web-browser', t('panes.webBrowser.bookmarksImportInvalid'));
        return;
      }
      const validated = validateBookmarkTree(parsed);
      if (!validated) {
        logError('web-browser', t('panes.webBrowser.bookmarksImportInvalid'));
        return;
      }
      openImport(validated);
    } catch (err) {
      logError('web-browser', t('panes.webBrowser.bookmarksImportError'), err);
    }
  };

  const toggle = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }));

  // Close the context menu on any (left-click) selection elsewhere. A right-click
  // fires no 'click' event, so opening the menu does not immediately dismiss it.
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [contextMenu]);

  // Keep the context menu within the viewport (it is position:fixed at the cursor).
  useLayoutEffect(() => {
    if (contextMenu && contextMenuRef.current) {
      const menu = contextMenuRef.current;
      const rect = menu.getBoundingClientRect();
      let x = contextMenu.x;
      let y = contextMenu.y;
      if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 5;
      if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 5;
      if (x !== contextMenu.x || y !== contextMenu.y) {
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
      }
    }
  }, [contextMenu]);

  const startRename = (node: BookmarkNode) => {
    setEditingNodeId(node.id);
    setEditingName(node.name);
    setContextMenu(null);
  };

  const commitRename = (node: BookmarkNode) => {
    const name = editingName.trim();
    if (name && name !== node.name) editNode(node.id, { name });
    setEditingNodeId(null);
  };

  // Drop zone within a row: top quarter → before, bottom quarter → after,
  // middle of a folder → inside (drop into it). A bookmark splits before/after.
  const computeDropPosition = (node: BookmarkNode, e: DragEvent): DropPos => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    const isNodeExpanded = expanded[node.id] ?? true;
    if (node.type === 'folder') {
      if (isNodeExpanded && node.children && node.children.length > 0) {
        return y < h * 0.25 ? 'before' : 'inside';
      }
      if (y < h * 0.25) return 'before';
      if (y > h * 0.75) return 'after';
      return 'inside';
    }
    return y < h * 0.5 ? 'before' : 'after';
  };

  const renderNode = (node: BookmarkNode, depth: number): ReactNode => {
    const pad = { paddingLeft: `${depth * 14 + 8}px` };
    const isFolder = node.type === 'folder';
    const children = node.children ?? [];
    const hasChildren = children.length > 0;
    const isExpanded = expanded[node.id] ?? true;
    const isEditing = editingNodeId === node.id;

    const isDropTarget = dropTarget?.nodeId === node.id;
    const dropPosition = isDropTarget ? dropTarget.position : null;
    const dragClasses = [
      draggedNodeId === node.id ? 'dragging' : '',
      dropPosition === 'before' ? 'drag-over-before' : '',
      dropPosition === 'after' ? 'drag-over-after' : '',
      dropPosition === 'inside' ? 'drag-over-inside' : '',
    ]
      .filter(Boolean)
      .join(' ');

    const activate = () => {
      if (isEditing) return;
      if (isFolder) {
        if (hasChildren) toggle(node.id);
      } else if (node.url) {
        onSelect(node.url);
      }
    };

    return (
      <div key={node.id} className="host-tree-node">
        <div
          className={`host-tree-row ${dragClasses}`}
          style={pad}
          role="treeitem"
          aria-expanded={isFolder ? isExpanded : undefined}
          tabIndex={0}
          title={isFolder ? undefined : node.url}
          draggable={!isEditing}
          onDragStart={(e) => {
            if (isEditing) return;
            setDraggedNodeId(node.id);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', node.id);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!draggedNodeId || draggedNodeId === node.id) return;
            e.dataTransfer.dropEffect = 'move';
            setDropTarget({ nodeId: node.id, position: computeDropPosition(node, e) });
          }}
          onDragLeave={(e) => {
            const related = e.relatedTarget as HTMLElement | null;
            if (!e.currentTarget.contains(related) && dropTarget?.nodeId === node.id) {
              setDropTarget(null);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (draggedNodeId && draggedNodeId !== node.id) {
              moveNode(draggedNodeId, node.id, computeDropPosition(node, e));
            }
            setDraggedNodeId(null);
            setDropTarget(null);
          }}
          onDragEnd={() => {
            setDraggedNodeId(null);
            setDropTarget(null);
          }}
          onClick={activate}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setContextMenu({ x: e.clientX, y: e.clientY, node });
          }}
          onKeyDown={(e) => {
            if (isEditing) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              activate();
            } else if (e.key === 'F2') {
              e.preventDefault();
              e.stopPropagation();
              startRename(node);
            }
          }}
        >
          {isFolder ? (
            <span
              className="tree-icon"
              style={{ opacity: hasChildren ? 1 : 0, cursor: hasChildren ? 'pointer' : 'default' }}
              onClick={(e) => {
                e.stopPropagation();
                if (hasChildren) toggle(node.id);
              }}
            >
              <svg
                className={`tree-chevron ${isExpanded ? 'expanded' : ''}`}
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </span>
          ) : (
            <span className="tree-icon" style={{ opacity: 0 }} aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" />
            </span>
          )}
          <span className="tree-icon" aria-hidden="true">{isFolder ? '\u{1F4C1}' : '\u{1F310}'}</span>
          <span className="tree-label">
            {isEditing ? (
              <input
                autoFocus
                type="text"
                className="tree-label-edit-input"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') commitRename(node);
                  else if (e.key === 'Escape') setEditingNodeId(null);
                }}
                onBlur={() => commitRename(node)}
              />
            ) : (
              node.name
            )}
          </span>
        </div>
        {isFolder && hasChildren && isExpanded && (
          <div className="host-tree-children">
            {children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="web-browser-bookmark-menu" role="tree">
      <div className="web-browser-bookmark-toolbar">
        <button
          type="button"
          className="web-browser-bookmark-tool-btn"
          onClick={handleImport}
          title={t('panes.webBrowser.bookmarksImport')}
        >
          {t('panes.webBrowser.bookmarksImport')}
        </button>
        <button
          type="button"
          className="web-browser-bookmark-tool-btn"
          onClick={handleExport}
          disabled={tree.length === 0}
          title={t('panes.webBrowser.bookmarksExport')}
        >
          {t('panes.webBrowser.bookmarksExport')}
        </button>
      </div>
      {tree.length === 0 ? (
        <div className="web-browser-bookmark-empty">{t('panes.webBrowser.bookmarksEmpty')}</div>
      ) : (
        tree.map((node) => renderNode(node, 0))
      )}

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => startRename(contextMenu.node)}>
            {t('sessionDialog.bookmarks.rename')}
          </button>
          {contextMenu.node.type === 'folder' && (
            <button
              onClick={() => {
                sortFolder(contextMenu.node.id);
                setContextMenu(null);
              }}
            >
              {t('sessionDialog.bookmarks.sortAscending')}
            </button>
          )}
          <div className="context-menu-separator" />
          <button
            className="danger"
            onClick={() => {
              openNodeToDelete(contextMenu.node);
              setContextMenu(null);
            }}
          >
            {t('common.delete')}
          </button>
        </div>
      )}

      {nodeToDeleteOpen && nodeToDelete && (
        <ConfirmModal
          title={
            nodeToDelete.type === 'folder'
              ? t('sessionDialog.bookmarks.deleteFolderTitle')
              : t('sessionDialog.bookmarks.deleteBookmarkTitle')
          }
          message={t('sessionDialog.bookmarks.deleteMessage', {
            name: findNode(tree, nodeToDelete.id)?.name ?? nodeToDelete.name,
          })}
          onConfirm={() => {
            deleteNode(nodeToDelete.id);
            closeNodeToDelete();
          }}
          onCancel={closeNodeToDelete}
        />
      )}

      {importOpen && importTree && (
        <ConfirmModal
          title={t('panes.webBrowser.importReplaceTitle')}
          message={t('panes.webBrowser.importReplaceMessage')}
          onConfirm={() => {
            replaceTree(importTree);
            closeImport();
          }}
          onCancel={closeImport}
        />
      )}
    </div>
  );
}
