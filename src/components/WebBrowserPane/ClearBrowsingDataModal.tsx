import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import type { WebBrowserClearDataOptions } from '../../types/appTypes';
import './ClearBrowsingDataModal.css';

interface ClearBrowsingDataModalProps {
  /** Called with the selected categories when the user confirms. */
  onConfirm: (options: WebBrowserClearDataOptions) => void;
  onCancel: () => void;
}

/** Selectable categories, in display order. `localStorage` is intentionally not
 *  offered — the embedded browser shares its WebView2 profile with HoTTY's own
 *  UI (settings/bookmarks live in localStorage), so it is always preserved. */
const CATEGORIES: { key: keyof WebBrowserClearDataOptions; labelKey: string }[] = [
  { key: 'cookiesAndSiteData', labelKey: 'panes.webBrowser.clearDataCookies' },
  { key: 'cache', labelKey: 'panes.webBrowser.clearDataCache' },
  { key: 'history', labelKey: 'panes.webBrowser.clearDataHistory' },
  { key: 'passwords', labelKey: 'panes.webBrowser.clearDataPasswords' },
  { key: 'autofill', labelKey: 'panes.webBrowser.clearDataAutofill' },
];

/**
 * Modal (opened by the 🗑 toolbar button) to clear the embedded browser's
 * browsing data by category. Uses the `.clear-browsing-data-overlay` class so
 * `uiOverlayStore` hides the native webview while it is open (otherwise the
 * OS-composited webview would paint over this modal).
 */
export function ClearBrowsingDataModal({ onConfirm, onCancel }: ClearBrowsingDataModalProps) {
  const { t } = useTranslation();
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, true);

  // Default: everything selected (full reset); the user can uncheck categories.
  const [options, setOptions] = useState<WebBrowserClearDataOptions>({
    cookiesAndSiteData: true,
    cache: true,
    history: true,
    passwords: true,
    autofill: true,
  });

  const anySelected = useMemo(() => Object.values(options).some(Boolean), [options]);

  const toggle = (key: keyof WebBrowserClearDataOptions) =>
    setOptions((o) => ({ ...o, [key]: !o[key] }));

  const confirm = () => {
    if (anySelected) onConfirm(options);
  };

  return (
    <div className="clear-browsing-data-overlay" onClick={onCancel} tabIndex={-1}>
      <div
        className="clear-browsing-data-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
      >
        <h3 className="cbd-header">{t('panes.webBrowser.clearDataTitle')}</h3>
        <div className="cbd-body">
          <ul className="cbd-list">
            {CATEGORIES.map(({ key, labelKey }) => (
              <li key={key}>
                <label className="cbd-item">
                  <input type="checkbox" checked={options[key]} onChange={() => toggle(key)} />
                  <span>{t(labelKey)}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="cbd-note">{t('panes.webBrowser.clearDataNote')}</p>
        </div>
        <div className="cbd-footer">
          <button type="button" className="cbd-btn secondary" onClick={onCancel} autoFocus>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="cbd-btn danger"
            onClick={confirm}
            disabled={!anySelected}
          >
            {t('panes.webBrowser.clearDataConfirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
