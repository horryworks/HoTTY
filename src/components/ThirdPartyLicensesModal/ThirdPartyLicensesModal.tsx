import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../Dialog/Dialog';
import { tauriService } from '../../services/tauriService';
import type { ThirdPartyLicenses } from '../../types/appTypes';
import './ThirdPartyLicensesModal.css';

interface ThirdPartyLicensesModalProps {
  onClose: () => void;
}

/**
 * Nested modal (opened from Settings → About) listing the bundled third-party
 * dependencies and their licenses. The manifest is loaded on demand from the
 * backend (`get_third_party_licenses`) so the full license texts never enter
 * the JS bundle.
 */
/**
 * Long licence texts, so it opens tall and can be pulled taller. The geometry
 * hook owns the bounds; the stylesheet sets no size.
 */
const DEFAULT_SIZE = { width: 680, height: 640 };
const MIN_SIZE = { width: 420, height: 300 };

export function ThirdPartyLicensesModal({ onClose }: ThirdPartyLicensesModalProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<ThirdPartyLicenses | null>(null);
  const [error, setError] = useState(false);



  useEffect(() => {
    let cancelled = false;
    tauriService
      .getThirdPartyLicenses()
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, []);

  const loading = !data && !error;
  const packages = data?.packages ?? [];

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('settings.about.thirdPartyLicensesTitle')}
      geometry={{ persistKey: 'thirdPartyLicenses', defaultSize: DEFAULT_SIZE, minSize: MIN_SIZE }}
      // A reference sheet: opened to be read, nothing entered, nothing lost by
      // clicking away. It opens over Settings, and the dialog stack means the
      // backdrop click reaches this one alone.
      dismissOnOutsideClick
      footer={
        <button className="tpl-btn tpl-btn-secondary" onClick={onClose}>
          {t('settings.about.thirdPartyLicensesClose')}
        </button>
      }
    >
          {loading && <p className="tpl-status">{t('settings.about.thirdPartyLicensesLoading')}</p>}
          {error && (
            <p className="tpl-status tpl-error">{t('settings.about.thirdPartyLicensesError')}</p>
          )}
          {!loading && !error && packages.length === 0 && (
            <p className="tpl-status">{t('settings.about.thirdPartyLicensesEmpty')}</p>
          )}
          {!loading && !error && packages.length > 0 && (
            <>
              <p className="tpl-intro">{t('settings.about.thirdPartyLicensesIntro')}</p>
              <ul className="tpl-list">
                {packages.map((p) => (
                  <li key={`${p.ecosystem}:${p.name}@${p.version}`} className="tpl-item">
                    <div className="tpl-item-head">
                      <span className="tpl-name">{p.name}</span>
                      <span className="tpl-version">{p.version}</span>
                      <span className="tpl-eco">{p.ecosystem}</span>
                      <span className="tpl-spdx">{p.license}</span>
                    </div>
                    {p.repository && (
                      // Plain selectable text rather than a link: repository URLs
                      // are arbitrary third-party domains not covered by the
                      // opener capability allowlist, so openExternal would fail.
                      <span className="tpl-repo">{p.repository}</span>
                    )}
                    {p.licenseText && (
                      <details className="tpl-details">
                        <summary>{p.license}</summary>
                        <pre className="tpl-text">{p.licenseText}</pre>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
    </Dialog>
  );
}
