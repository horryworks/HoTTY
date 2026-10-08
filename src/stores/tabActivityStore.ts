import { create } from 'zustand';

/** Output a session produced while it was off screen. */
export interface TabActivity {
  /** Lines received since the tab was last on screen (at least 1 per burst). */
  lines: number;
  /** The last non-blank line on its screen, for the tab's second line. */
  lastLine: string;
}

interface TabActivityState {
  activity: Record<string, TabActivity>;
  /** Fold a batch of counts in. `lastLine` replaces; `lines` adds. */
  record: (batch: Record<string, TabActivity>) => void;
  /** Forget sessions that are on screen again or gone. */
  clear: (ids: readonly string[]) => void;
}

/**
 * Unread output per hidden tab. Not persisted: it describes this run's
 * terminals, which do not survive a restart. Written in batches by
 * `useTabActivity` — never once per output chunk.
 */
export const useTabActivityStore = create<TabActivityState>()((set) => ({
  activity: {},
  record: (batch) =>
    set((s) => {
      const ids = Object.keys(batch);
      if (ids.length === 0) return s;
      const activity = { ...s.activity };
      for (const id of ids) {
        const prev = activity[id];
        activity[id] = {
          lines: (prev?.lines ?? 0) + batch[id].lines,
          lastLine: batch[id].lastLine || prev?.lastLine || '',
        };
      }
      return { activity };
    }),
  clear: (ids) =>
    set((s) => {
      if (!ids.some((id) => id in s.activity)) return s;
      const activity = { ...s.activity };
      for (const id of ids) delete activity[id];
      return { activity };
    }),
}));
