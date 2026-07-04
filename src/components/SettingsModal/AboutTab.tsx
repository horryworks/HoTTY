import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tauriService } from '../../services/tauriService';
import { ThirdPartyLicensesModal } from '../ThirdPartyLicensesModal/ThirdPartyLicensesModal';

// Logo is fully baked into a single PNG: white background, rounded corners,
// and inner padding are all part of the pixel data. No CSS is required to
// make it render correctly on dark themes. DO NOT replace this with a
// transparent source PNG or strip out the baked-in styling.
const HOTTY_LOGO_DATA_URL =
  'data:image/png;base64,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';


export function AboutTab() {
  const [version, setVersion] = useState('');
  const [licensesOpen, setLicensesOpen] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    tauriService.getAppVersion().then(setVersion);
  }, []);

  const handleLink = (e: React.MouseEvent, url: string) => {
    e.preventDefault();
    tauriService.openExternal(url);
  };

  return (
    <div className="about-content">
      <img
        src={HOTTY_LOGO_DATA_URL}
        alt={t('settings.about.logoAlt')}
        width="64"
        height="64"
        style={{ marginBottom: '16px' }}
      />
      <h2 style={{ margin: '0 0 8px 0' }}>HoTTY</h2>
      <p style={{ color: 'var(--text-secondary)', margin: '0 0 16px 0' }}>
        {t('settings.about.version', { version })}
      </p>

      <p style={{ fontWeight: 'bold', margin: '0 0 8px 0' }}>
        {t('settings.about.author')}
      </p>

      <p style={{ margin: '0 0 16px 0' }}>
        <a
          href="https://hotty.pages.dev/"
          className="about-link"
          onClick={(e) =>
            handleLink(e, 'https://hotty.pages.dev/')
          }
        >
          https://hotty.pages.dev/
        </a>
      </p>

      <p style={{ color: 'var(--text-secondary)', margin: '0 0 24px 0' }}>
        {t('settings.about.descriptionLine1')}
        <br />
        {t('settings.about.descriptionLine2')}
      </p>

      <p
        style={{
          color: 'var(--text-tertiary)',
          margin: '0 0 8px 0',
          lineHeight: '1.4',
        }}
      >
        {t('settings.about.licenseLine1')}
        <br />
        {t('settings.about.licenseLine2')}
      </p>

      <p style={{ margin: '16px 0 0 0' }}>
        <a
          href="https://www.gnu.org/licenses/gpl-3.0.html"
          className="about-link"
          onClick={(e) =>
            handleLink(e, 'https://www.gnu.org/licenses/gpl-3.0.html')
          }
        >
          {t('settings.about.viewLicense')}
        </a>
      </p>

      <p style={{ margin: '8px 0 0 0' }}>
        <a
          href="#"
          className="about-link"
          onClick={(e) => {
            e.preventDefault();
            setLicensesOpen(true);
          }}
        >
          {t('settings.about.thirdPartyLicenses')}
        </a>
      </p>

      {licensesOpen && (
        <ThirdPartyLicensesModal onClose={() => setLicensesOpen(false)} />
      )}
    </div>
  );
}
