import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useModalEscape } from '../../hooks/useModalEscape';
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
export function ThirdPartyLicensesModal({ onClose }: ThirdPartyLicensesModalProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<ThirdPartyLicenses | null>(null);
  const [error, setError] = useState(false);

  useModalEscape(onClose);

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
    <div className="tpl-overlay">
      <div className="tpl-modal" role="dialog" aria-modal="true" aria-labelledby="tpl-title">
        <div className="tpl-header">
          <span id="tpl-title">{t('settings.about.thirdPartyLicensesTitle')}</span>
          <button
            className="tpl-close"
            onClick={onClose}
            aria-label={t('settings.about.thirdPartyLicensesClose')}
          >
            &#10005;
          </button>
        </div>
        <div className="tpl-body">
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
        </div>
        <div className="tpl-footer">
          <button className="tpl-btn tpl-btn-secondary" onClick={onClose}>
            {t('settings.about.thirdPartyLicensesClose')}
          </button>
        </div>
      </div>
    </div>
  );
}
