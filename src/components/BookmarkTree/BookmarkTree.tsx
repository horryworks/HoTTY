import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { BookmarkNode } from '../../types/appTypes';
import { useBookmarkStore } from '../../stores/bookmarkStore';
import { useModalState } from '../../hooks/useModalState';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { ConfirmModal } from '../ConfirmModal/ConfirmModal';
import { findNode, flattenBookmarks } from './bookmarkTreeHelpers';
// Reuse the host-tree visual styles (tree rows, chevron, context menu, modal).
import '../HostTree/HostTree.css';

/** "Open All" asks for confirmation once a folder holds at least this many
 *  bookmarks, guarding against accidentally opening a large batch of tabs. */
const OPEN_ALL_CONFIRM_THRESHOLD = 5;

interface ContextMenuState {
  x: number;
  y: number;
  node: BookmarkNode | null;
}

interface EditModalState {
  mode: 'folder' | 'bookmark';
  parentId: string | null;
  existingNode?: BookmarkNode;
}

interface BookmarkTreeProps {
  /** Called when a bookmark is activated (double-click / Enter) to open it. */
  onOpenBookmark: (url: string) => void;
  /** Called by the "New Web Browser" entry to open a blank browser tab. */
  onNewBlank?: () => void;
  /** Called from a folder's "Open All" to open every bookmark beneath it. */
  onOpenAll?: (folder: BookmarkNode) => void;
}

type DropPos = 'before' | 'after' | 'inside';

export const BookmarkTree: React.FC<BookmarkTreeProps> = ({ onOpenBookmark, onNewBlank, onOpenAll }) => {
  const { t } = useTranslation();
  const tree = useBookmarkStore((s) => s.tree);
  const addFolder = useBookmarkStore((s) => s.addFolder);
  const addBookmark = useBookmarkStore((s) => s.addBookmark);
  const editNode = useBookmarkStore((s) => s.editNode);
  const deleteNode = useBookmarkStore((s) => s.deleteNode);
  const moveNode = useBookmarkStore((s) => s.moveNode);
  const sortFolder = useBookmarkStore((s) => s.sortFolder);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editModalOpen, openEditModal, closeEditModal, editModal] = useModalState<EditModalState>();
  const [nodeToDeleteOpen, openNodeToDelete, closeNodeToDelete, nodeToDelete] =
    useModalState<BookmarkNode>();
  const [openAllConfirmOpen, openOpenAllConfirm, closeOpenAllConfirm, openAllNode] =
    useModalState<BookmarkNode>();

  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ nodeId: string; position: DropPos } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const editModalRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const modalInputRef = useRef<HTMLInputElement>(null);

  useFocusTrap(editModalRef, editModalOpen);

  useEffect(() => {
    const handler = () => setContextMenu(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  useEffect(() => {
    if (editModalOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEditingNodeId(null);
      setTimeout(() => modalInputRef.current?.focus(), 50);
    }
  }, [editModalOpen]);

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

  const toggle = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  // Resolve the folder a new node should go into based on the current selection
  // (selected folder → into it; selected bookmark → its parent; nothing → root).
  const getTargetParentId = useCallback((): string | null => {
    if (!selectedId) return null;
    let result: string | null = null;
    const walk = (nodes: BookmarkNode[], parentId: string | null): boolean => {
      for (const n of nodes) {
        if (n.id === selectedId) {
          result = n.type === 'folder' ? n.id : parentId;
          return true;
        }
        if (n.children && walk(n.children, n.id)) return true;
      }
      return false;
    };
    walk(tree, null);
    return result;
  }, [selectedId, tree]);

  const openAddFolder = useCallback(
    (parentId: string | null) => {
      setFormName('');
      openEditModal({ mode: 'folder', parentId });
      setContextMenu(null);
    },
    [openEditModal],
  );

  const openAddBookmark = useCallback(
    (parentId: string | null) => {
      setFormName('');
      setFormUrl('');
      openEditModal({ mode: 'bookmark', parentId });
      setContextMenu(null);
    },
    [openEditModal],
  );

  // "Open All" on a folder: open every bookmark beneath it (recursively). Confirm
  // first when the batch is large; otherwise open straight away.
  const handleOpenAllClick = useCallback(
    (node: BookmarkNode) => {
      setContextMenu(null);
      if (flattenBookmarks(node.children ?? []).length >= OPEN_ALL_CONFIRM_THRESHOLD) {
        openOpenAllConfirm(node);
      } else {
        onOpenAll?.(node);
      }
    },
    [onOpenAll, openOpenAllConfirm],
  );

  const handleModalSubmit = () => {
    if (!editModal) return;
    const { mode, parentId, existingNode } = editModal;
    const name = formName.trim();
    if (!name) return;
    if (mode === 'bookmark') {
      const url = formUrl.trim();
      if (!url) return;
      if (existingNode) editNode(existingNode.id, { name, url });
      else addBookmark(parentId, name, url);
    } else {
      if (existingNode) editNode(existingNode.id, { name });
      else addFolder(parentId, name);
    }
    closeEditModal();
  };

  const computeDropPosition = (node: BookmarkNode, e: React.DragEvent): DropPos => {
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

  const renderNode = (node: BookmarkNode, depth: number): React.ReactNode => {
    const isExpanded = expanded[node.id] ?? true;
    const isSelected = selectedId === node.id;
    const isDragging = draggedNodeId === node.id;
    const isDropTarget = dropTarget?.nodeId === node.id;
    const dropPosition = isDropTarget ? dropTarget.position : null;
    const dragClasses = [
      isDragging ? 'dragging' : '',
      dropPosition === 'before' ? 'drag-over-before' : '',
      dropPosition === 'after' ? 'drag-over-after' : '',
      dropPosition === 'inside' ? 'drag-over-inside' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div key={node.id} className="host-tree-node">
        <div
          className={`host-tree-row ${isSelected ? 'selected' : ''} ${dragClasses}`}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
          tabIndex={0}
          draggable
          onDragStart={(e) => {
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
            const related = e.relatedTarget as HTMLElement;
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
          onClick={() => {
            setSelectedId(node.id);
            if (node.type === 'folder') toggle(node.id);
          }}
          onDoubleClick={() => {
            if (node.type === 'bookmark' && node.url) onOpenBookmark(node.url);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setContextMenu({ x: e.clientX, y: e.clientY, node });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && node.type === 'bookmark' && node.url) {
              e.preventDefault();
              onOpenBookmark(node.url);
            } else if (e.key === 'F2') {
              e.preventDefault();
              e.stopPropagation();
              setEditingNodeId(node.id);
              setEditingName(node.name);
            }
          }}
        >
          {node.type === 'folder' ? (
            <>
              <span
                className="tree-icon"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(node.id);
                }}
                style={{
                  opacity: !node.children || node.children.length === 0 ? 0 : 1,
                  cursor: !node.children || node.children.length === 0 ? 'default' : 'pointer',
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
              <span className="tree-icon">{'\u{1F4C1}'}</span>
            </>
          ) : (
            <>
              <span className="tree-icon" style={{ opacity: 0 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" />
              </span>
              <span className="tree-icon">{'\u{1F310}'}</span>
            </>
          )}
          <span className="tree-label">
            {editingNodeId === node.id ? (
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
                  if (e.key === 'Enter') {
                    if (editingName.trim() && editingName !== node.name) {
                      editNode(node.id, { name: editingName.trim() });
                    }
                    setEditingNodeId(null);
                  } else if (e.key === 'Escape') {
                    setEditingNodeId(null);
                  }
                }}
                onBlur={() => {
                  if (editingName.trim() && editingName !== node.name) {
                    editNode(node.id, { name: editingName.trim() });
                  }
                  setEditingNodeId(null);
                }}
              />
            ) : (
              <>
                {node.name}
                {node.type === 'bookmark' && node.url && (
                  <span className="tree-meta"> {node.url}</span>
                )}
              </>
            )}
          </span>
        </div>
        {node.type === 'folder' && isExpanded && node.children && (
          <div className="host-tree-children">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="host-tree-container"
      ref={containerRef}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, node: null });
      }}
    >
      {/* Toolbar */}
      <div className="host-tree-toolbar">
        <div
          className="tree-toolbar-btn"
          role="button"
          title={t('sessionDialog.bookmarks.addFolder')}
          onClick={() => openAddFolder(getTargetParentId())}
          style={{ cursor: 'pointer' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--icon-folder)' }}>
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            <line x1="12" y1="11" x2="12" y2="17" />
            <line x1="9" y1="14" x2="15" y2="14" />
          </svg>
        </div>
        <div
          className="tree-toolbar-btn"
          role="button"
          title={t('sessionDialog.bookmarks.addBookmark')}
          onClick={() => openAddBookmark(getTargetParentId())}
          style={{ cursor: 'pointer' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--icon-host)' }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
        </div>
        <div style={{ flex: 1 }} />
      </div>

      {/* Tree */}
      <div className="host-tree-body">
        {onNewBlank && (
          <div
            className="host-tree-row new-connection"
            style={{ paddingLeft: '8px' }}
            role="button"
            tabIndex={0}
            title={t('sessionDialog.bookmarks.newBlank')}
            onClick={onNewBlank}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onNewBlank();
              }
            }}
          >
            <span className="tree-icon" style={{ opacity: 0 }} aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" />
            </span>
            <span className="tree-icon" aria-hidden="true">{'\u{1F195}'}</span>
            <span className="tree-label">{t('sessionDialog.bookmarks.newBlank')}</span>
          </div>
        )}
        {tree.length === 0 && <div className="host-tree-empty">{t('sessionDialog.bookmarks.empty')}</div>}
        {tree.map((node) => renderNode(node, 0))}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.node?.type === 'folder' &&
            onOpenAll &&
            flattenBookmarks(contextMenu.node.children ?? []).length > 0 && (
              <>
                <button onClick={() => handleOpenAllClick(contextMenu.node!)}>
                  <span className="menu-icon-wrapper">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-color)' }}>
                      <polyline points="13 17 18 12 13 7"></polyline>
                      <polyline points="6 17 11 12 6 7"></polyline>
                    </svg>
                  </span>
                  {t('sessionDialog.bookmarks.openAll')}
                </button>
                <div className="context-menu-separator" />
              </>
            )}
          {contextMenu.node?.type !== 'bookmark' && (
            <>
              <button onClick={() => openAddFolder(contextMenu.node?.id ?? null)}>
                <span className="menu-icon-wrapper">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--icon-folder)' }}>
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                    <line x1="12" y1="11" x2="12" y2="17"></line>
                    <line x1="9" y1="14" x2="15" y2="14"></line>
                  </svg>
                </span>
                {t('sessionDialog.bookmarks.addFolder')}
              </button>
              <button onClick={() => openAddBookmark(contextMenu.node?.id ?? null)}>
                <span className="menu-icon-wrapper">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--icon-host)' }}>
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                </span>
                {t('sessionDialog.bookmarks.addBookmark')}
              </button>
            </>
          )}
          {contextMenu.node && (
            <>
              {contextMenu.node.type === 'folder' && <div className="context-menu-separator" />}
              <button
                onClick={() => {
                  setEditingNodeId(contextMenu.node!.id);
                  setEditingName(contextMenu.node!.name);
                  setContextMenu(null);
                }}
              >
                <span className="menu-icon-wrapper">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-warning)' }}>
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                  </svg>
                </span>
                {t('sessionDialog.bookmarks.rename')}
              </button>
              {contextMenu.node.type === 'bookmark' && (
                <button
                  onClick={() => {
                    const n = contextMenu.node!;
                    setFormName(n.name);
                    setFormUrl(n.url ?? '');
                    openEditModal({ mode: 'bookmark', parentId: null, existingNode: n });
                    setContextMenu(null);
                  }}
                >
                  <span className="menu-icon-wrapper">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--icon-host)' }}>
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                  </span>
                  {t('sessionDialog.bookmarks.edit')}
                </button>
              )}
              {contextMenu.node.type === 'folder' && (
                <>
                  <button
                    onClick={() => {
                      sortFolder(contextMenu.node?.id ?? null);
                      setContextMenu(null);
                    }}
                  >
                    <span className="menu-icon-wrapper">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--icon-host)' }}>
                        <path d="M18 15l-6-6-6 6"></path>
                      </svg>
                    </span>
                    {t('sessionDialog.bookmarks.sortAscending')}
                  </button>
                  <button
                    onClick={() => {
                      sortFolder(contextMenu.node?.id ?? null, 'desc');
                      setContextMenu(null);
                    }}
                  >
                    <span className="menu-icon-wrapper">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--icon-host)' }}>
                        <path d="M6 9l6 6 6-6"></path>
                      </svg>
                    </span>
                    {t('sessionDialog.bookmarks.sortDescending')}
                  </button>
                </>
              )}
              <button
                className="danger"
                onClick={() => {
                  openNodeToDelete(contextMenu.node!);
                  setContextMenu(null);
                }}
              >
                <span className="menu-icon-wrapper">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-danger)' }}>
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                  </svg>
                </span>
                {t('common.delete')}
              </button>
            </>
          )}
        </div>
      )}

      {/* Add / Edit modal */}
      {editModalOpen && editModal && (
        <div className="host-edit-modal-overlay" onClick={closeEditModal} tabIndex={-1}>
          <div
            className="host-edit-modal"
            ref={editModalRef}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') {
                e.preventDefault();
                closeEditModal();
              }
            }}
          >
            <h3>
              {editModal.mode === 'folder'
                ? editModal.existingNode
                  ? t('sessionDialog.bookmarks.renameFolderTitle')
                  : t('sessionDialog.bookmarks.addFolderTitle')
                : editModal.existingNode
                  ? t('sessionDialog.bookmarks.editBookmarkTitle')
                  : t('sessionDialog.bookmarks.addBookmarkTitle')}
            </h3>
            <div className="modal-form-group">
              <label>{t('sessionDialog.bookmarks.nameLabel')}</label>
              <input
                ref={modalInputRef}
                autoFocus
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && editModal.mode === 'folder' && handleModalSubmit()}
              />
            </div>
            {editModal.mode === 'bookmark' && (
              <div className="modal-form-group">
                <label>{t('sessionDialog.bookmarks.urlLabel')}</label>
                <input
                  type="text"
                  value={formUrl}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={t('sessionDialog.bookmarks.urlPlaceholder')}
                  onChange={(e) => setFormUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleModalSubmit()}
                />
              </div>
            )}
            <div className="modal-actions">
              <button className="btn-secondary" onClick={closeEditModal}>
                {t('common.cancel')}
              </button>
              <button className="btn-primary" onClick={handleModalSubmit}>
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
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

      {/* Open-all confirm (large folders) */}
      {openAllConfirmOpen && openAllNode && (
        <ConfirmModal
          title={t('sessionDialog.bookmarks.openAllConfirmTitle')}
          message={t('sessionDialog.bookmarks.openAllConfirmMessage', {
            count: flattenBookmarks(openAllNode.children ?? []).length,
            name: openAllNode.name,
          })}
          confirmLabel={t('sessionDialog.bookmarks.openAll')}
          onConfirm={() => {
            onOpenAll?.(openAllNode);
            closeOpenAllConfirm();
          }}
          onCancel={closeOpenAllConfirm}
        />
      )}
    </div>
  );
};
