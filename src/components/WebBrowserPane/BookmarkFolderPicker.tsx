import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { BookmarkNode } from '../../types/appTypes';
// Reuse the host/bookmark tree visual styles (rows, chevron, icons, labels).
import '../HostTree/HostTree.css';
import './BookmarkFolderPicker.css';

interface BookmarkFolderPickerProps {
  /** Full bookmark tree; only folders are shown (bookmarks are omitted). */
  tree: BookmarkNode[];
  /** Currently selected destination folder id; `null` = root (top level). */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

/**
 * Folder-only tree picker used by {@link AddBookmarkModal} to choose the
 * destination folder when saving a bookmark — replacing the old `<select>`
 * dropdown. Renders the bookmark tree's folders with expand/collapse and a
 * synthetic "Root" row at the top for the top level. Rows are selectable
 * (click / Enter / Space); the chevron toggles a folder's children.
 */
export function BookmarkFolderPicker({ tree, selectedId, onSelect }: BookmarkFolderPickerProps) {
  const { t } = useTranslation();
  // Folders default to expanded so the whole tree is visible on open.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }));

  const renderFolder = (node: BookmarkNode, depth: number): ReactNode => {
    if (node.type !== 'folder') return null;
    const childFolders = (node.children ?? []).filter((c) => c.type === 'folder');
    const hasChildren = childFolders.length > 0;
    const isExpanded = expanded[node.id] ?? true;
    const isSelected = selectedId === node.id;

    return (
      <div key={node.id} className="host-tree-node">
        <div
          className={`host-tree-row ${isSelected ? 'selected' : ''}`}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
          role="option"
          aria-selected={isSelected}
          tabIndex={0}
          onClick={() => onSelect(node.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect(node.id);
            }
          }}
        >
          <span
            className="tree-icon"
            onClick={(e) => {
              e.stopPropagation();
              if (hasChildren) toggle(node.id);
            }}
            style={{
              opacity: hasChildren ? 1 : 0,
              cursor: hasChildren ? 'pointer' : 'default',
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
          <span className="tree-label">{node.name}</span>
        </div>
        {hasChildren && isExpanded && (
          <div className="host-tree-children">
            {childFolders.map((child) => renderFolder(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const rootFolders = tree.filter((n) => n.type === 'folder');

  return (
    <div className="bookmark-folder-picker" role="listbox">
      {/* Synthetic root row — saving here drops the bookmark at the top level. */}
      <div
        className={`host-tree-row ${selectedId === null ? 'selected' : ''}`}
        style={{ paddingLeft: '8px' }}
        role="option"
        aria-selected={selectedId === null}
        tabIndex={0}
        onClick={() => onSelect(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(null);
          }
        }}
      >
        <span className="tree-icon" style={{ opacity: 0 }} aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" />
        </span>
        <span className="tree-icon" aria-hidden="true">{'\u{1F4C1}'}</span>
        <span className="tree-label">{t('panes.webBrowser.bookmarkFolderRoot')}</span>
      </div>
      {/* Top-level folders nest one level under the root row. */}
      {rootFolders.map((node) => renderFolder(node, 1))}
    </div>
  );
}
