import { create } from 'zustand';

export interface ErrorNotification {
  id: string;
  category: string;
  message: string;
  timestamp: number;
}

interface ErrorNotificationState {
  notifications: ErrorNotification[];
  push: (category: string, message: string) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

const MAX_NOTIFICATIONS = 5;
// Backend session failures often arrive twice in quick succession (one via
// emit_session_error, one via the invoke's Err return). Suppress an exact
// duplicate that lands inside this window so the user sees one toast, not two.
const DUPLICATE_WINDOW_MS = 500;

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useErrorNotificationStore = create<ErrorNotificationState>((set) => ({
  notifications: [],
  push: (category, message) => set((s) => {
    const now = Date.now();
    const last = s.notifications[s.notifications.length - 1];
    if (
      last &&
      last.category === category &&
      last.message === message &&
      now - last.timestamp < DUPLICATE_WINDOW_MS
    ) {
      return s;
    }
    const next = [
      ...s.notifications,
      { id: makeId(), category, message, timestamp: now },
    ];
    return {
      notifications: next.length > MAX_NOTIFICATIONS
        ? next.slice(next.length - MAX_NOTIFICATIONS)
        : next,
    };
  }),
  dismiss: (id) => set((s) => ({
    notifications: s.notifications.filter((n) => n.id !== id),
  })),
  clear: () => set({ notifications: [] }),
}));
