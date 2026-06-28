import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBookmarkStore } from '../../stores/bookmarkStore';
import { BookmarkFolderPicker } from './BookmarkFolderPicker';
import { useFocusTrap } from '../../hooks/useFocusTrap';
// Reuse host-edit modal styles (form group, actions, buttons, container).
import '../HostTree/HostTree.css';
import './AddBookmarkModal.css';

interface AddBookmarkModalProps {
  /** URL of the currently loaded page to bookmark. */
  url: string;
  onClose: () => void;
}

/** Default bookmark name = the page host (user can edit). */
function defaultName(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

/**
 * Small modal (opened by the ★ toolbar button) to save the current page as a
 * bookmark into a chosen folder. Uses the `.add-bookmark-modal-overlay` class so
 * `uiOverlayStore` hides the native webview while it is open.
 */
export function AddBookmarkModal({ url, onClose }: AddBookmarkModalProps) {
  const { t } = useTranslation();
  const tree = useBookmarkStore((s) => s.tree);
  const addBookmark = useBookmarkStore((s) => s.addBookmark);

  const [name, setName] = useState(() => defaultName(url));
  const [folderId, setFolderId] = useState<string | null>(null); // null = root
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, true);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    addBookmark(folderId, trimmed, url);
    onClose();
  };

  return (
    <div className="add-bookmark-modal-overlay" onClick={onClose} tabIndex={-1}>
      <div
        className="host-edit-modal"
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
      >
        <h3>{t('panes.webBrowser.bookmarkModalTitle')}</h3>
        <div className="modal-form-group">
          <label>{t('panes.webBrowser.bookmarkNameLabel')}</label>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>
        <div className="modal-form-group">
          <label>{t('panes.webBrowser.bookmarkFolderLabel')}</label>
          <BookmarkFolderPicker tree={tree} selectedId={folderId} onSelect={setFolderId} />
        </div>
        <div className="modal-form-group">
          <label>URL</label>
          <input type="text" value={url} readOnly tabIndex={-1} />
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn-primary" onClick={submit}>
            {t('panes.webBrowser.bookmarkAdd')}
          </button>
        </div>
      </div>
    </div>
  );
}
