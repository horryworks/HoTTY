import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Encoding, PromptPattern, ThemeId, CommandExecutionMode, PersonaDefinition } from '../types/appTypes';
import { DEFAULT_THEMES } from '../themes/defaults';

export const DEFAULT_PROMPT_PATTERNS: PromptPattern[] = [
  { id: 'cisco', name: 'Cisco / Allied Telesis', pattern: '^([a-zA-Z0-9_\\-\\./]+(?:\\([a-zA-Z0-9_\\-\\./]+\\))?[>#])\\s*' },
  { id: 'fortigate', name: 'Fortigate', pattern: '^([a-zA-Z0-9_\\-\\.]+(?:\\s\\([a-zA-Z0-9_\\-\\.]+\\))?[#$])\\s*' },
  { id: 'huawei', name: 'Huawei / Yamaha', pattern: '^((?:HRP_[AMSB])?[<\\[][a-zA-Z0-9_\\-\\./]+[>\\]])\\s*' },
  { id: 'juniper', name: 'Juniper', pattern: '^([-_\\w]+@[-_\\w]+[>#])\\s*' },
  { id: 'paloalto', name: 'Palo Alto / Arista', pattern: '^([-_\\w.]+@[-_\\w.]+[>#])\\s*' },
  { id: 'linux', name: 'Linux', pattern: '^([-_\\w]+@[-_\\w]+:[^$# ]*[$#])\\s*' },
  { id: 'cmd', name: 'Command Prompt', pattern: '^([A-Za-z]:.*>)\\s*' },
  { id: 'powershell', name: 'PowerShell', pattern: '^(PS\\s+.*>)\\s*' },
];

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

  // Prompt highlighting
  enablePromptHighlight: boolean;
  promptHighlightColor: string;
  promptPatterns: PromptPattern[];

  // Logging
  loggingEnabled: boolean;
  loggingPath: string;

  // AI
  activeAiProvider: string;
  commandExecutionMode: CommandExecutionMode;
  customSafeCommands: string[];
  maxConsecutiveAutoExecutions: number;
  aiPersonas: PersonaDefinition[];
  watchBufferLimit: number;
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
  enablePromptHighlight: true,
  promptHighlightColor: 'rgba(255, 255, 255, 0.15)',
  promptPatterns: DEFAULT_PROMPT_PATTERNS,
  loggingEnabled: false,
  loggingPath: '',
  activeAiProvider: 'gemini',
  commandExecutionMode: 'ask-before-execute',
  customSafeCommands: [],
  maxConsecutiveAutoExecutions: 5,
  aiPersonas: [
    {
      id: 'default',
      label: 'General Assistant',
      systemPrompt: 'You are a helpful assistant.',
      askAiCommands: [
        { id: 'explain', label: 'Explain', promptTemplate: 'Please explain the following text:\n\n{selection}' },
        { id: 'root-cause', label: 'Root Cause Analysis', promptTemplate: 'Please analyze the root cause of the following issue:\n\n{selection}' },
      ],
    },
  ],
  watchBufferLimit: 500000,
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
      version: 6,
      migrate: (persistedState, version) => {
        const state = (persistedState ?? {}) as Partial<SettingsState>;
        if (version < 2 && state.theme === undefined) {
          state.theme = 'dark';
        }
        if (version < 3) {
          state.enablePromptHighlight ??= true;
          state.promptHighlightColor ??= 'rgba(255, 255, 255, 0.15)';
          state.promptPatterns ??= DEFAULT_PROMPT_PATTERNS;
        }
        if (version < 4) {
          state.loggingEnabled ??= false;
          state.loggingPath ??= '';
        }
        if (version < 5) {
          state.activeAiProvider ??= DEFAULTS.activeAiProvider;
          state.commandExecutionMode ??= DEFAULTS.commandExecutionMode;
          state.customSafeCommands ??= DEFAULTS.customSafeCommands;
          state.maxConsecutiveAutoExecutions ??= DEFAULTS.maxConsecutiveAutoExecutions;
          state.aiPersonas ??= DEFAULTS.aiPersonas;
        }
        if (version < 6) {
          state.watchBufferLimit ??= DEFAULTS.watchBufferLimit;
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
