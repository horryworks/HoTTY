import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WebBrowserClearDataOptions } from '../../types/appTypes';
import './ClearBrowsingDataSection.css';

interface ClearBrowsingDataSectionProps {
  /** Called with the selected categories when the user clicks Clear. */
  onClear: (options: WebBrowserClearDataOptions) => void;
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
 * Clear-browsing-data section card shown inline in the ⋯ More panel — the
 * category choices are visible from the start instead of behind a modal, so
 * nothing pops up over (or hides) the page. Mounted with the panel, so the
 * selection resets to all-checked (full reset) each time the panel opens.
 */
export function ClearBrowsingDataSection({ onClear }: ClearBrowsingDataSectionProps) {
  const { t } = useTranslation();

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

  return (
    <div
      className="web-browser-more-section"
      role="group"
      aria-label={t('panes.webBrowser.clearDataTitle')}
    >
      <span className="web-browser-more-section-title">
        {t('panes.webBrowser.clearDataTitle')}
      </span>
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
      <button
        type="button"
        className="cbd-clear-btn"
        onClick={() => onClear(options)}
        disabled={!anySelected}
      >
        {t('panes.webBrowser.clearDataConfirm')}
      </button>
    </div>
  );
}
