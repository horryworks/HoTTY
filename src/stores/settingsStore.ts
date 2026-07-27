import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Encoding, FeatureId, FileServerConfig, PromptPattern, ThemeId, LanguageId, CommandExecutionMode, ClassifierStrategy, PersonaDefinition } from '../types/appTypes';
import { DEFAULT_THEMES } from '../themes/defaults';
import { DEFAULT_WHITELIST, DEFAULT_BLACKLIST } from '../utils/commandLists';
import type { FixedSizeMode } from '../utils/fixedTerminalSize';

const DEFAULT_PROMPT_HIGHLIGHT_COLOR = 'rgba(255, 255, 255, 0.15)';

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

export const DEFAULT_PERSONAS: PersonaDefinition[] = [
  { id: 'network-expert', label: 'Network Expert', systemPrompt: '[ABSOLUTE MANDATORY START-OF-SESSION PROTOCOL — NO EXCEPTIONS]\nEVERY new conversation MUST start with these two replies, in order, BEFORE addressing the user\'s question.\n\nREPLY 1: A short one-line acknowledgement (e.g. "Identifying the device first.") + exactly one ```execute``` block running the equivalent of `show version` (a vendor-identification command). Nothing else. Do NOT answer the user\'s question yet.\n\nREPLY 2: A short one-line acknowledgement of the identified vendor/OS (e.g. "Cisco IOS detected. Disabling paging.") + exactly one ```execute``` block running the paging-disable command for that vendor (the equivalent of Cisco\'s `terminal length 0`). Nothing else. Do NOT answer the user\'s question yet.\n\nREPLY 3 and onward: Address the user\'s actual request.\n\nThis protocol is non-negotiable. Skipping it causes `--More--` style pagination to stall the response loop. The ONLY exception is if the user\'s first message contains the literal phrase "skip prep".\n\n[ROLE] You are a Senior Network Engineer. Analyze network issues with a focus on OSI layers, routing protocols (BGP, OSPF), and switching. Use industry-standard terminology (Cisco/Juniper syntax) and formatting. When you need more information about a device, propose investigation commands. HoTTY will automatically execute these and send back the results.\n\nREMINDER: REPLY 1 and REPLY 2 above are MANDATORY before answering ANY user question.' },
  { id: 'general-helper', label: 'General Helper', systemPrompt: 'You are a helpful technical assistant. Provide clear, concise, and accurate answers. When explaining concepts, use analogies where appropriate.' },
  { id: 'server-expert', label: 'Server Expert', systemPrompt: 'You are a Systems Administrator specializing in Linux and Windows servers. Focus on OS internals, kernel parameters, performance tuning, and security best practices. Provide specific commands for troubleshooting. When you need to identify the OS or hardware, propose investigation commands (e.g., "uname -a", "cat /etc/os-release"). HoTTY will automatically provide the output back to you after execution.' },
  { id: 'cloud-expert', label: 'Cloud Expert', systemPrompt: 'You are a Cloud Architect (AWS/Azure/GCP). Advise on cloud-native patterns, microservices, and infrastructure-as-code (Terraform/K8s). Prioritize scalability, cost-efficiency, and security in your recommendations.' },
  { id: 'coding-expert', label: 'Coding Expert', systemPrompt: 'You are a Senior Software Engineer. Provide idiomatic, clean, and performant code solutions. Explain time/space complexity (Big O) where relevant. Prefer modern syntax and safety.' },
  { id: 'security-analyst', label: 'Security Analyst', systemPrompt: 'You are a Cybersecurity Analyst. Analyze logs and configurations for potential vulnerabilities, threats, and indicators of compromise (IoCs). Recommend mitigation strategies based on industry standards (NIST/CIS).' },
];

/**
 * Merge default personas into the user's saved list without losing user data.
 *
 * Behavior:
 * - User personas (matched by id) are kept as-is — preserves both edits to
 *   stock prompts and user-added custom personas.
 * - Any default persona missing from the user's list is appended.
 *
 * Migrations from older versions that used to overwrite `aiPersonas` outright
 * delegate to this helper, so customized personas survive upgrades. Users who
 * want the latest stock prompts can use "Reset All Personas" in Settings.
 */
function mergeDefaultPersonas(
  userPersonas: PersonaDefinition[] | undefined,
): PersonaDefinition[] {
  const userArr = Array.isArray(userPersonas) ? userPersonas : [];
  const userIds = new Set(userArr.map((p) => p.id));
  const additions = DEFAULT_PERSONAS.filter((d) => !userIds.has(d.id));
  return [...userArr, ...additions];
}

interface SettingsState {
  // UI language (i18n) — distinct from the AI response language.
  language: LanguageId;

  // Appearance
  theme: ThemeId;
  fontSize: number;
  fontFamily: string;
  sidebarPosition: 'left' | 'right';

  // Encoding
  globalEncoding: Encoding;

  /** Explicit SSH login name for GCP IAP connections. Blank = let the backend
   *  auto-detect. The right granularity is per-machine, not per-VM: which
   *  account a VM accepts depends on the signed-in gcloud account and the local
   *  Windows user, both of which are constant across a machine's VMs. */
  gcpIapUsername: string;

  // Terminal colors (driven by the selected theme, not user-editable)
  terminalForeground: string;
  terminalBackground: string;
  terminalBackgroundInactive: string;
  paneBackground: string;
  paneBackgroundMode: 'color' | 'image';
  paneBackgroundImage: string;

  // SSH keepalive
  sshKeepAliveEnabled: boolean;
  sshKeepAliveInterval: number; // seconds
  sshConnectTimeoutSecs: number; // seconds; how long to wait for the initial TCP/SSH handshake before failing

  // Telnet keepalive
  telnetKeepAliveEnabled: boolean;
  telnetKeepAliveInterval: number; // seconds
  telnetConnectTimeoutSecs: number; // seconds; how long to wait for the initial TCP connection before failing

  // Terminal behaviour
  scrollback: number;
  lineWrapEnabled: boolean;
  backspaceSendsDel: boolean;
  rightClickPaste: boolean;
  /** Global policy for pinning the terminal grid to the connect-time width (for
   *  width-latching devices like Huawei USG/VRP). 'auto' pins only when the SSH
   *  ident fingerprints such a device. A per-connection setting overrides this;
   *  see `fixedTerminalSize` on the connection config. */
  fixedTerminalSizeMode: FixedSizeMode;

  // Prompt highlighting
  enablePromptHighlight: boolean;
  promptHighlightColor: string;
  promptPatterns: PromptPattern[];

  // Logging
  loggingEnabled: boolean;
  loggingPath: string;

  // Features
  enabledFeatures: Record<FeatureId, boolean>;

  // Web Browser — default zoom (percent) applied to each newly opened Web
  // Browser pane. Each pane keeps its own zoom after that (session-scoped).
  webBrowserDefaultZoom: number;

  // File Server (TFTP / SFTP) — persisted config (password excluded)
  fileServerConfig: FileServerConfig;

  // AI
  activeAiProvider: string;
  commandExecutionMode: CommandExecutionMode;
  /** User-managed whitelist (auto-execute). Seeded from DEFAULT_WHITELIST. */
  whitelistCommands: string[];
  /** User-managed blacklist (ask before execute). Seeded from DEFAULT_BLACKLIST. */
  blacklistCommands: string[];
  maxConsecutiveAutoExecutions: number;
  /** Grace-period (seconds) before an auto-execute-safe command actually runs, so
   *  the user can cancel it. 0 = run immediately (no countdown). Clamped to 0–10. */
  aiAutoExecCountdownSecs: number;
  /** How many AI Chat conversation tabs may stream a response at the SAME time
   *  within one pane. Extra sends queue and dispatch as slots free up. 1 = the old
   *  strictly-serial behaviour (one stream at a time). Kept modest by default to
   *  avoid provider rate-limit (429) pressure and simultaneous token cost. Clamped
   *  to 1–8. */
  maxConcurrentStreams: number;
  /** How auto-execution safety is decided (whitelist vs AI vs hybrid). */
  classifierStrategy: ClassifierStrategy;
  /** Minimum AI confidence required to auto-execute a command judged read-only. */
  aiClassifyConfidenceThreshold: number;
  aiPersonas: PersonaDefinition[];
  watchBufferLimit: number;
  aiCommandIdleTimeoutSecs: number;
  /** When true, a leading `sleep N` on an AI-issued command runs as a client-side
   *  delay instead of being sent to the device (so the idle timeout doesn't mis-fire). */
  aiSleepAsClientDelay: boolean;
  /** Cap (seconds) for a client-side sleep delay; over-cap waits are clamped. 0 = no cap. */
  aiSleepMaxDelaySecs: number;
  /** Whether the user has accepted the one-time disclosure that AI features send
   *  terminal data to the configured third-party provider. Gates all AI sends. */
  aiDataConsentAccepted: boolean;
}

interface SettingsActions {
  update: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
  reset: () => void;
}

const DEFAULTS: SettingsState = {
  language: 'en',
  theme: 'dark',
  fontSize: 14,
  fontFamily: 'Consolas, "Courier New", monospace',
  sidebarPosition: 'left',
  globalEncoding: 'utf8',
  gcpIapUsername: '',
  terminalForeground: DEFAULT_THEMES.dark.terminal.foreground,
  terminalBackground: DEFAULT_THEMES.dark.terminal.background,
  terminalBackgroundInactive: DEFAULT_THEMES.dark.terminal.backgroundInactive,
  paneBackground: DEFAULT_THEMES.dark.terminal.paneBackground,
  paneBackgroundMode: 'color',
  paneBackgroundImage: '',
  sshKeepAliveEnabled: true,
  sshKeepAliveInterval: 10,
  sshConnectTimeoutSecs: 5,
  telnetKeepAliveEnabled: true,
  telnetKeepAliveInterval: 30,
  telnetConnectTimeoutSecs: 5,
  scrollback: 10000,
  lineWrapEnabled: true,
  backspaceSendsDel: false,
  rightClickPaste: true,
  fixedTerminalSizeMode: 'auto',
  enablePromptHighlight: true,
  promptHighlightColor: '',
  promptPatterns: DEFAULT_PROMPT_PATTERNS,
  loggingEnabled: false,
  loggingPath: '',
  enabledFeatures: {
    'ai-chat': true,
    'log-viewer': true,
    'ping-monitor': true,
    'file-server': true,
    'web-browser': true,
  },
  webBrowserDefaultZoom: 100,
  fileServerConfig: {
    rootDir: '',
    bindAddr: '0.0.0.0',
    tftpPort: 69,
    tftpAllowWrite: false,
    sftpPort: 2222,
    sftpUsername: 'hotty',
    sftpAllowWrite: false,
  },
  activeAiProvider: 'gemini',
  commandExecutionMode: 'ask-before-execute',
  whitelistCommands: [...DEFAULT_WHITELIST],
  blacklistCommands: [...DEFAULT_BLACKLIST],
  maxConsecutiveAutoExecutions: 5,
  aiAutoExecCountdownSecs: 3,
  maxConcurrentStreams: 3,
  // Hybrid (managed whitelist/blacklist + AI for the gray zone) is the default
  // for all users; the v15 migration switches existing users to it too.
  classifierStrategy: 'hybrid',
  aiClassifyConfidenceThreshold: 0.7,
  aiPersonas: DEFAULT_PERSONAS,
  watchBufferLimit: 500000,
  aiCommandIdleTimeoutSecs: 10,
  aiSleepAsClientDelay: true,
  aiSleepMaxDelaySecs: 900,
  aiDataConsentAccepted: false,
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
      version: 27,
      migrate: (persistedState, version) => {
        const state = (persistedState ?? {}) as Partial<SettingsState>;
        if (version < 2 && state.theme === undefined) {
          state.theme = 'dark';
        }
        if (version < 3) {
          state.enablePromptHighlight ??= true;
          state.promptHighlightColor ??= DEFAULT_PROMPT_HIGHLIGHT_COLOR;
          state.promptPatterns ??= DEFAULT_PROMPT_PATTERNS;
        }
        if (version < 4) {
          state.loggingEnabled ??= false;
          state.loggingPath ??= '';
        }
        if (version < 5) {
          state.activeAiProvider ??= DEFAULTS.activeAiProvider;
          state.commandExecutionMode ??= DEFAULTS.commandExecutionMode;
          // `customSafeCommands` (legacy) is migrated into `whitelistCommands` in v15.
          state.maxConsecutiveAutoExecutions ??= DEFAULTS.maxConsecutiveAutoExecutions;
          state.aiPersonas ??= DEFAULTS.aiPersonas;
        }
        if (version < 6) {
          state.watchBufferLimit ??= DEFAULTS.watchBufferLimit;
        }
        if (version < 7) {
          state.aiPersonas = mergeDefaultPersonas(state.aiPersonas);
        }
        if (version < 8) {
          state.enabledFeatures ??= DEFAULTS.enabledFeatures;
        }
        if (version < 9) {
          state.paneBackgroundMode ??= DEFAULTS.paneBackgroundMode;
          state.paneBackgroundImage ??= DEFAULTS.paneBackgroundImage;
        }
        if (version < 10) {
          // Empty string is the new "use theme default" sentinel: TerminalMarkerRail
          // falls back to `var(--terminal-prompt-default)` when the value is empty,
          // so existing users who never customised the colour migrate to the
          // theme-driven default instead of being pinned to the old hardcoded value.
          if (state.promptHighlightColor === DEFAULT_PROMPT_HIGHLIGHT_COLOR) {
            state.promptHighlightColor = '';
          }
        }
        if (version < 11) {
          state.aiCommandIdleTimeoutSecs ??= DEFAULTS.aiCommandIdleTimeoutSecs;
        }
        if (version < 12) {
          state.aiPersonas = mergeDefaultPersonas(state.aiPersonas);
        }
        if (version < 13) {
          state.aiPersonas = mergeDefaultPersonas(state.aiPersonas);
        }
        if (version < 14) {
          state.classifierStrategy ??= 'static';
          state.aiClassifyConfidenceThreshold ??= DEFAULTS.aiClassifyConfidenceThreshold;
        }
        if (version < 15) {
          // Seed the now user-managed lists. Fold any legacy customSafeCommands
          // into the whitelist; switch everyone (incl. static users) to hybrid.
          const legacy = (state as Record<string, unknown>).customSafeCommands;
          const legacyCustom = Array.isArray(legacy) ? (legacy as string[]) : [];
          state.whitelistCommands ??= [...DEFAULT_WHITELIST, ...legacyCustom];
          state.blacklistCommands ??= [...DEFAULT_BLACKLIST];
          state.classifierStrategy = 'hybrid';
          delete (state as Record<string, unknown>).customSafeCommands;
        }
        if (version < 16) {
          state.aiSleepAsClientDelay ??= DEFAULTS.aiSleepAsClientDelay;
          state.aiSleepMaxDelaySecs ??= DEFAULTS.aiSleepMaxDelaySecs;
        }
        if (version < 17) {
          state.language ??= DEFAULTS.language;
        }
        if (version < 18) {
          // New File Server feature — enable it for existing users by merging
          // the key into their persisted feature map (don't clobber other flags).
          state.enabledFeatures = {
            ...DEFAULTS.enabledFeatures,
            ...(state.enabledFeatures ?? {}),
            'file-server': state.enabledFeatures?.['file-server'] ?? true,
          };
          state.fileServerConfig ??= DEFAULTS.fileServerConfig;
        }
        if (version < 19) {
          // New Web Browser feature — enable it for existing users by merging
          // the key into their persisted feature map (don't clobber other flags).
          state.enabledFeatures = {
            ...DEFAULTS.enabledFeatures,
            ...(state.enabledFeatures ?? {}),
            'web-browser': state.enabledFeatures?.['web-browser'] ?? true,
          };
        }
        if (version < 20) {
          // New AI data-disclosure consent gate — existing users have not yet
          // seen the disclosure, so default to false to prompt on next AI use.
          state.aiDataConsentAccepted ??= false;
        }
        if (version < 21) {
          // New Web Browser default-zoom setting — 100% for existing users.
          state.webBrowserDefaultZoom ??= DEFAULTS.webBrowserDefaultZoom;
        }
        if (version < 22) {
          // v22 shipped a boolean `fixedTerminalSizeDefault`; v23 replaces it
          // with the tri-state mode below, so nothing to seed here.
        }
        if (version < 23) {
          // boolean → 'off' | 'auto' | 'on'. Anyone who had explicitly forced the
          // old flag on keeps that ('on'); everyone else moves to 'auto', which
          // pins only the device families that actually latch their width.
          const legacy = (state as Record<string, unknown>).fixedTerminalSizeDefault;
          state.fixedTerminalSizeMode ??= legacy === true ? 'on' : DEFAULTS.fixedTerminalSizeMode;
          delete (state as Record<string, unknown>).fixedTerminalSizeDefault;
        }
        if (version < 24) {
          // New auto-execute pre-run countdown — default to a 3s grace period.
          state.aiAutoExecCountdownSecs ??= DEFAULTS.aiAutoExecCountdownSecs;
        }
        if (version < 25) {
          // New AI Chat concurrent-stream cap — default 3 parallel streams/pane.
          state.maxConcurrentStreams ??= DEFAULTS.maxConcurrentStreams;
        }
        if (version < 26) {
          // New GCP IAP SSH username override — blank keeps auto-detection.
          state.gcpIapUsername ??= DEFAULTS.gcpIapUsername;
        }
        if (version < 27) {
          // Text Editor and File Explorer were removed. Drop their now-unknown
          // flags so the persisted feature map matches the shipped feature set.
          const features = state.enabledFeatures as Record<string, boolean> | undefined;
          if (features) {
            delete features['text-editor'];
            delete features['file-explorer'];
          }
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
