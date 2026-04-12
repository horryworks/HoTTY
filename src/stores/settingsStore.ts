import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Encoding, ThemeId } from '../types/appTypes';
import { DEFAULT_THEMES } from '../themes/defaults';

export interface SettingsState {
  // Appearance
  theme: ThemeId;
  fontSize: number;
  fontFamily: string;
  sidebarPosition: 'left' | 'right';

  // Encoding
  globalEncoding: Encoding;

  // Terminal colors (driven by the selected theme, not user-editable)
  terminalForeground: string;
  terminalBackground: string;
  terminalBackgroundInactive: string;
  paneBackground: string;

  // SSH keepalive
  sshKeepAliveEnabled: boolean;
  sshKeepAliveInterval: number; // seconds

  // Telnet keepalive
  telnetKeepAliveEnabled: boolean;
  telnetKeepAliveInterval: number; // seconds

  // Terminal behaviour
  scrollback: number;
  lineWrapEnabled: boolean;
  backspaceSendsDel: boolean;
  rightClickPaste: boolean;
}

export interface SettingsActions {
  update: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
  reset: () => void;
}

const DEFAULTS: SettingsState = {
  theme: 'dark',
  fontSize: 14,
  fontFamily: 'Consolas, "Courier New", monospace',
  sidebarPosition: 'left',
  globalEncoding: 'utf8',
  terminalForeground: DEFAULT_THEMES.dark.terminal.foreground,
  terminalBackground: DEFAULT_THEMES.dark.terminal.background,
  terminalBackgroundInactive: DEFAULT_THEMES.dark.terminal.backgroundInactive,
  paneBackground: DEFAULT_THEMES.dark.terminal.paneBackground,
  sshKeepAliveEnabled: true,
  sshKeepAliveInterval: 10,
  telnetKeepAliveEnabled: true,
  telnetKeepAliveInterval: 30,
  scrollback: 10000,
  lineWrapEnabled: true,
  backspaceSendsDel: false,
  rightClickPaste: true,
};

export const useSettingsStore = create<SettingsState & SettingsActions>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      update: (key, value) => set({ [key]: value } as Partial<SettingsState>),
      reset: () => set({ ...DEFAULTS }),
    }),
    {
      name: 'hotty-settings',
      version: 2,
      migrate: (persistedState, version) => {
        const state = (persistedState ?? {}) as Partial<SettingsState>;
        if (version < 2 && state.theme === undefined) {
          state.theme = 'dark';
        }
        return state as SettingsState;
      },
      partialize: (state): SettingsState => {
        const { update, reset, ...persisted } = state as SettingsState & SettingsActions;
        void update;
        void reset;
        return persisted;
      },
    }
  )
);

export { DEFAULTS as SETTINGS_DEFAULTS };
