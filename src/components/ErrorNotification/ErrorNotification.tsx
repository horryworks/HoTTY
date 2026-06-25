import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useErrorNotificationStore,
  type ErrorNotification as ErrorNotificationItem,
} from '../../stores/errorNotificationStore';
import './ErrorNotification.css';

const AUTO_DISMISS_MS = 8000;

interface ItemProps {
  item: ErrorNotificationItem;
  onDismiss: (id: string) => void;
}

function Item({ item, onDismiss }: ItemProps): React.JSX.Element {
  const { t } = useTranslation();
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(item.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [item.id, onDismiss]);

  return (
    <div className="error-notification" role="alert">
      <div className="error-notification-body">
        <span className="error-notification-category">{item.category}</span>
        <span className="error-notification-message">{item.message}</span>
      </div>
      <button
        type="button"
        className="error-notification-close"
        onClick={() => onDismiss(item.id)}
        aria-label={t('notifications.error.dismiss')}
      >
        ✕
      </button>
    </div>
  );
}

export function ErrorNotification(): React.JSX.Element | null {
  const notifications = useErrorNotificationStore((s) => s.notifications);
  const dismiss = useErrorNotificationStore((s) => s.dismiss);

  if (notifications.length === 0) return null;

  return (
    <div className="error-notification-stack">
      {notifications.map((n) => (
        <Item key={n.id} item={n} onDismiss={dismiss} />
      ))}
    </div>
  );
}
