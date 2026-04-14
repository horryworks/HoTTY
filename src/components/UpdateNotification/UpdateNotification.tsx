import React, { useEffect, useState } from 'react';
import { tauriService } from '../../services/tauriService';
import type { UpdateInfo } from '../../types/appTypes';
import './UpdateNotification.css';

const DISMISSED_KEY = 'hotty:update-dismissed-version';

export function UpdateNotification(): React.JSX.Element | null {
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

  const handleOpen = (): void => {
    tauriService.openExternal(info.releaseUrl).catch(() => {});
  };

  const handleDismiss = (): void => {
    localStorage.setItem(DISMISSED_KEY, info.latestVersion);
    setInfo(null);
  };

  return (
    <div className="update-notification" role="status">
      <div className="update-notification-body">
        <span className="update-notification-title">
          New version available: v{info.latestVersion}
          {info.prerelease ? ' (pre-release)' : ''}
        </span>
        <span className="update-notification-sub">
          You are running v{info.currentVersion}
        </span>
      </div>
      <div className="update-notification-actions">
        <button
          type="button"
          className="update-notification-btn update-notification-btn-primary"
          onClick={handleOpen}
        >
          View release
        </button>
        <button
          type="button"
          className="update-notification-btn"
          onClick={handleDismiss}
          aria-label="Dismiss update notification"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
