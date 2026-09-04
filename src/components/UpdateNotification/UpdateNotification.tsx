import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tauriService } from '../../services/tauriService';
import type { UpdateInfo } from '../../types/appTypes';
import './UpdateNotification.css';

const DISMISSED_KEY = 'hotty:update-dismissed-version';

interface UpdateNotificationProps {
  /** Opens Settings → Versions, where the switch is actually performed. */
  onOpenVersions: () => void;
}

export function UpdateNotification({
  onOpenVersions,
}: UpdateNotificationProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const [info, setInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    tauriService
      .checkForUpdates()
      .then((result) => {
        if (cancelled || !result) return;
        const dismissed = localStorage.getItem(DISMISSED_KEY);
        if (dismissed === result.latestVersion) return;
        setInfo(result);
      })
      .catch(() => {
        /* silent — update check must never break the app */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!info) return null;

  // Goes to Settings → Versions rather than out to the GitHub release page: the
  // update is applied there and the notes are readable there, so there is
  // nothing left to open a browser for. The toast steps aside (without being
  // recorded as dismissed, so it returns next launch if nothing was installed).
  const handleOpen = (): void => {
    setInfo(null);
    onOpenVersions();
  };

  const handleDismiss = (): void => {
    localStorage.setItem(DISMISSED_KEY, info.latestVersion);
    setInfo(null);
  };

  return (
    <div className="update-notification" role="status">
      <div className="update-notification-body">
        <span className="update-notification-title">
          {t('notifications.update.titleAvailable', { version: info.latestVersion })}
          {info.prerelease ? t('notifications.update.prereleaseSuffix') : ''}
        </span>
        <span className="update-notification-sub">
          {t('notifications.update.running', { version: info.currentVersion })}
        </span>
      </div>
      <div className="update-notification-actions">
        <button
          type="button"
          className="update-notification-btn update-notification-btn-primary"
          onClick={handleOpen}
        >
          {t('notifications.update.viewRelease')}
        </button>
        <button
          type="button"
          className="update-notification-btn"
          onClick={handleDismiss}
          aria-label={t('notifications.update.dismissAria')}
        >
          {t('notifications.update.dismiss')}
        </button>
      </div>
    </div>
  );
}
