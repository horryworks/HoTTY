import { tauriService } from '../services/tauriService';
import { useErrorNotificationStore } from '../stores/errorNotificationStore';

export function logError(category: string, message: string, err?: unknown): void {
  const errStr = err instanceof Error
    ? err.message
    : err !== undefined
      ? String(err)
      : '';
  const fullMsg = errStr ? `${message}: ${errStr}` : message;

  console.error(`[${category}] ${message}`, err);

  tauriService.logDebug('error', category, fullMsg).catch(() => { /* swallow */ });

  useErrorNotificationStore.getState().push(category, fullMsg);
}
