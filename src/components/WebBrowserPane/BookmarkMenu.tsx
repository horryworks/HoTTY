import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { BookmarkNode } from '../../types/appTypes';
// Reuse the host/bookmark tree visual styles (rows, chevron, icons, labels).
import '../HostTree/HostTree.css';
import './BookmarkMenu.css';

interface BookmarkMenuProps {
  /** Full bookmark tree (folders + bookmarks). */
  tree: BookmarkNode[];
  /** Called with a bookmark's URL when its row is activated (click / Enter). */
  onSelect: (url: string) => void;
}

/**
 * Read-only dropdown listing of the bookmark tree, opened from the Web Browser
 * toolbar's bookmarks button. Folders expand/collapse; clicking a bookmark
 * navigates the current pane (via {@link onSelect}). Row rendering reuses the
 * host-tree styles. The root `.web-browser-bookmark-menu` class is registered in
 * `uiOverlayStore`'s OVERLAY_SELECTOR so the native webview hides while it is open
 * (otherwise the OS-composited webview would paint over this HTML dropdown).
 */
export function BookmarkMenu({ tree, onSelect }: BookmarkMenuProps) {
  const { t } = useTranslation();
  // Folders default to expanded so the whole tree is visible on open.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }));

  const renderNode = (node: BookmarkNode, depth: number): ReactNode => {
    const pad = { paddingLeft: `${depth * 14 + 8}px` };

    if (node.type === 'folder') {
      const children = node.children ?? [];
      const hasChildren = children.length > 0;
      const isExpanded = expanded[node.id] ?? true;
      return (
        <div key={node.id} className="host-tree-node">
          <div
            className="host-tree-row"
            style={pad}
            role="treeitem"
            aria-expanded={isExpanded}
            tabIndex={0}
            onClick={() => hasChildren && toggle(node.id)}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && hasChildren) {
                e.preventDefault();
                toggle(node.id);
              }
            }}
          >
            <span
              className="tree-icon"
              style={{ opacity: hasChildren ? 1 : 0, cursor: hasChildren ? 'pointer' : 'default' }}
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
              {children.map((child) => renderNode(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    // Bookmark leaf — clicking navigates the current pane.
    return (
      <div key={node.id} className="host-tree-node">
        <div
          className="host-tree-row"
          style={pad}
          role="treeitem"
          tabIndex={0}
          title={node.url}
          onClick={() => node.url && onSelect(node.url)}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && node.url) {
              e.preventDefault();
              onSelect(node.url);
            }
          }}
        >
          <span className="tree-icon" style={{ opacity: 0 }} aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" />
          </span>
          <span className="tree-icon" aria-hidden="true">{'\u{1F310}'}</span>
          <span className="tree-label">{node.name}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="web-browser-bookmark-menu" role="tree">
      {tree.length === 0 ? (
        <div className="web-browser-bookmark-empty">{t('panes.webBrowser.bookmarksEmpty')}</div>
      ) : (
        tree.map((node) => renderNode(node, 0))
      )}
    </div>
  );
}
