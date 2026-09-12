import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBookmarkStore } from '../../stores/bookmarkStore';
import { BookmarkFolderPicker } from './BookmarkFolderPicker';
import { Dialog } from '../Dialog/Dialog';
// The shell is <Dialog>; this brings the shared form-group and button styles.
import '../HostTree/HostTree.css';

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
 * Small dialog (opened by the ★ toolbar button) to save the current page as a
 * bookmark into a chosen folder. `<Dialog>` supplies the overlay, whose class
 * is what `uiOverlayStore` watches to hide the native webview underneath —
 * this modal used to need a bespoke class of its own for that.
 */
export function AddBookmarkModal({ url, onClose }: AddBookmarkModalProps) {
  const { t } = useTranslation();
  const tree = useBookmarkStore((s) => s.tree);
  const addBookmark = useBookmarkStore((s) => s.addBookmark);

  const [name, setName] = useState(() => defaultName(url));
  const [folderId, setFolderId] = useState<string | null>(null); // null = root

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    addBookmark(folderId, trimmed, url);
    onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('panes.webBrowser.bookmarkModalTitle')}
      className="host-edit-modal"
      width={{ width: '90%', minWidth: 320, maxWidth: 460 }}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn-primary" onClick={submit}>
            {t('panes.webBrowser.bookmarkAdd')}
          </button>
        </>
      }
    >
      <div
        // Keys stay inside the form: the browser pane behind it has its own
        // shortcuts. Escape is the exception, owned by the dialog stack.
        onKeyDown={(e) => {
          if (e.key !== 'Escape') e.stopPropagation();
        }}
      >
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
      </div>
    </Dialog>
  );
}
