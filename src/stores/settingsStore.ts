import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Encoding, FeatureId, FileServerConfig, PromptPattern, ThemeId, LanguageId, CommandExecutionMode, ClassifierStrategy, PersonaDefinition, AskAiCommand } from '../types/appTypes';
import { DEFAULT_THEMES } from '../themes/defaults';
import { DEFAULT_WHITELIST, DEFAULT_BLACKLIST } from '../utils/commandLists';

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

export const DEFAULT_AI_COMMANDS: AskAiCommand[] = [
  { id: 'what-is-this', label: 'What is this?', promptTemplate: 'Explain the following text or code snippet concisely:\n\n{selection}' },
  { id: 'what-does-it-mean', label: 'What does it mean?', promptTemplate: 'Interpret the meaning of this log entry or message and its implications:\n\n{selection}' },
  { id: 'root-cause', label: 'Research root cause', promptTemplate: 'Analyze the following error or issue, identify 3 potential root causes, and suggest verification steps for each:\n\n{selection}' },
  { id: 'fix-this', label: 'Fix this', promptTemplate: 'Suggest a fix or improvement for the selected code or configuration:\n\n{selection}' },
];

const NETWORK_EXPERT_COMMANDS: AskAiCommand[] = [
  { id: 'explain-output', label: 'Explain this output', promptTemplate: 'Explain the following network command output. Highlight key information such as interface status, routing entries, errors, or protocol states:\n\n{selection}' },
  { id: 'troubleshoot', label: 'Troubleshoot this', promptTemplate: 'Analyze the following network issue or error output. Identify the likely cause, suggest diagnostic commands to verify, and recommend a resolution:\n\n{selection}' },
  { id: 'suggest-commands', label: 'What commands should I run?', promptTemplate: 'Based on the following situation or symptom, suggest the most relevant network diagnostic commands to run (e.g., show, debug, traceroute) and explain what each will reveal:\n\n{selection}' },
  { id: 'optimize-config', label: 'Optimize this config', promptTemplate: 'Review the following network device configuration and suggest optimizations for performance, security, and best practices:\n\n{selection}' },
  { id: 'what-does-it-mean', label: 'What does it mean?', promptTemplate: 'Interpret the meaning of this network log entry or message and its implications:\n\n{selection}' },
  { id: 'compare-configs', label: 'Compare configs', promptTemplate: 'Analyze the following two configurations. Identify the differences and explain the impact of each change:\n\n{selection}' },
];

const GENERAL_HELPER_COMMANDS: AskAiCommand[] = [
  { id: 'what-is-this', label: 'What is this?', promptTemplate: 'Explain the following text or code snippet concisely:\n\n{selection}' },
  { id: 'what-does-it-mean', label: 'What does it mean?', promptTemplate: 'Interpret the meaning of this log entry or message and its implications:\n\n{selection}' },
  { id: 'summarize', label: 'Summarize this', promptTemplate: 'Provide a concise summary of the following output, highlighting the most important points:\n\n{selection}' },
  { id: 'root-cause', label: 'Research root cause', promptTemplate: 'Analyze the following error or issue, identify 3 potential root causes, and suggest verification steps for each:\n\n{selection}' },
  { id: 'fix-this', label: 'Fix this', promptTemplate: 'Suggest a fix or improvement for the selected text, code, or configuration:\n\n{selection}' },
  { id: 'rewrite', label: 'Rewrite this', promptTemplate: 'Rewrite the following for clarity, correctness, and better structure while preserving the original intent:\n\n{selection}' },
];

const SERVER_EXPERT_COMMANDS: AskAiCommand[] = [
  { id: 'explain-output', label: 'Explain this output', promptTemplate: 'Explain the following server command output. Highlight key metrics, status indicators, and anything that requires attention:\n\n{selection}' },
  { id: 'troubleshoot', label: 'Troubleshoot this', promptTemplate: 'Analyze the following server issue or error. Identify the likely cause, suggest diagnostic commands, and recommend a resolution:\n\n{selection}' },
  { id: 'suggest-commands', label: 'What commands should I run?', promptTemplate: 'Based on the following situation or symptom, suggest the most relevant system diagnostic commands to run and explain what each will reveal:\n\n{selection}' },
  { id: 'check-issues', label: 'Check for issues', promptTemplate: 'Review the following configuration or log output for potential issues, misconfigurations, or warnings that need attention:\n\n{selection}' },
  { id: 'optimize-performance', label: 'Optimize performance', promptTemplate: 'Analyze the following system configuration or metrics and suggest performance tuning recommendations (kernel parameters, service settings, resource allocation):\n\n{selection}' },
  { id: 'root-cause', label: 'Research root cause', promptTemplate: 'Analyze the following server error or issue, identify 3 potential root causes, and suggest verification steps for each:\n\n{selection}' },
];

const CLOUD_EXPERT_COMMANDS: AskAiCommand[] = [
  { id: 'explain-resource', label: 'Explain this resource', promptTemplate: 'Explain the following cloud resource definition or configuration. Describe its purpose, key settings, and how it fits into a typical architecture:\n\n{selection}' },
  { id: 'estimate-cost', label: 'Estimate cost', promptTemplate: 'Based on the following cloud resource configuration, provide a rough monthly cost estimate and suggest cost optimization strategies:\n\n{selection}' },
  { id: 'review-architecture', label: 'Review architecture', promptTemplate: 'Review the following cloud architecture or infrastructure configuration. Identify potential improvements for scalability, reliability, security, and cost:\n\n{selection}' },
  { id: 'convert-to-iac', label: 'Convert to IaC', promptTemplate: 'Convert the following manual cloud resource configuration into Infrastructure-as-Code (Terraform HCL). Include comments explaining each resource and parameter:\n\n{selection}' },
  { id: 'troubleshoot', label: 'Troubleshoot this', promptTemplate: 'Analyze the following cloud service error or issue. Identify the likely cause, suggest diagnostic steps using the cloud provider CLI, and recommend a resolution:\n\n{selection}' },
  { id: 'what-does-it-mean', label: 'What does it mean?', promptTemplate: 'Interpret the meaning of this cloud service error message or log entry and its implications:\n\n{selection}' },
];

const CODING_EXPERT_COMMANDS: AskAiCommand[] = [
  { id: 'explain-code', label: 'Explain this code', promptTemplate: 'Explain the following code. Describe what it does, its key logic, and any notable patterns or techniques used:\n\n{selection}' },
  { id: 'fix-this', label: 'Fix this', promptTemplate: 'Identify the bug or issue in the following code and suggest a fix with explanation:\n\n{selection}' },
  { id: 'refactor', label: 'Refactor this', promptTemplate: 'Refactor the following code for better readability, maintainability, and adherence to best practices while preserving its behavior:\n\n{selection}' },
  { id: 'write-tests', label: 'Write tests for this', promptTemplate: 'Write unit tests for the following code. Cover the main functionality, edge cases, and error scenarios:\n\n{selection}' },
  { id: 'optimize', label: 'Optimize this', promptTemplate: 'Optimize the following code for better performance. Explain the improvements and any trade-offs:\n\n{selection}' },
  { id: 'complexity', label: "What's the complexity?", promptTemplate: 'Analyze the time and space complexity (Big O) of the following code. Identify bottlenecks and suggest improvements if applicable:\n\n{selection}' },
];

const SECURITY_ANALYST_COMMANDS: AskAiCommand[] = [
  { id: 'analyze-threats', label: 'Analyze for threats', promptTemplate: 'Analyze the following log entries or output for potential security threats, suspicious activity, or indicators of compromise (IoCs):\n\n{selection}' },
  { id: 'check-vulnerabilities', label: 'Check vulnerabilities', promptTemplate: 'Review the following configuration or code for security vulnerabilities. Classify each finding by severity (Critical/High/Medium/Low) and suggest remediation:\n\n{selection}' },
  { id: 'explain-alert', label: 'Explain this alert', promptTemplate: 'Explain the following security alert or event. Describe its severity, potential impact, and recommended immediate response actions:\n\n{selection}' },
  { id: 'suggest-hardening', label: 'Suggest hardening', promptTemplate: 'Review the following system or service configuration and suggest security hardening measures based on industry best practices (CIS Benchmarks, NIST):\n\n{selection}' },
  { id: 'root-cause', label: 'Research root cause', promptTemplate: 'Analyze the following security incident or anomaly, identify 3 potential root causes, and suggest investigation steps for each:\n\n{selection}' },
  { id: 'explain-ioc', label: 'What does this IoC mean?', promptTemplate: 'Explain the following Indicator of Compromise (IoC). Describe what it indicates, its typical association with known threat actors or campaigns, and recommended response:\n\n{selection}' },
];

export const DEFAULT_PERSONAS: PersonaDefinition[] = [
  { id: 'network-expert', label: 'Network Expert', systemPrompt: '[ABSOLUTE MANDATORY START-OF-SESSION PROTOCOL — NO EXCEPTIONS]\nEVERY new conversation MUST start with these two replies, in order, BEFORE addressing the user\'s question.\n\nREPLY 1: A short one-line acknowledgement (e.g. "Identifying the device first.") + exactly one ```execute``` block running the equivalent of `show version` (a vendor-identification command). Nothing else. Do NOT answer the user\'s question yet.\n\nREPLY 2: A short one-line acknowledgement of the identified vendor/OS (e.g. "Cisco IOS detected. Disabling paging.") + exactly one ```execute``` block running the paging-disable command for that vendor (the equivalent of Cisco\'s `terminal length 0`). Nothing else. Do NOT answer the user\'s question yet.\n\nREPLY 3 and onward: Address the user\'s actual request.\n\nThis protocol is non-negotiable. Skipping it causes `--More--` style pagination to stall the response loop. The ONLY exception is if the user\'s first message contains the literal phrase "skip prep".\n\n[ROLE] You are a Senior Network Engineer. Analyze network issues with a focus on OSI layers, routing protocols (BGP, OSPF), and switching. Use industry-standard terminology (Cisco/Juniper syntax) and formatting. When you need more information about a device, propose investigation commands. HoTTY will automatically execute these and send back the results.\n\nREMINDER: REPLY 1 and REPLY 2 above are MANDATORY before answering ANY user question.', askAiCommands: NETWORK_EXPERT_COMMANDS },
  { id: 'general-helper', label: 'General Helper', systemPrompt: 'You are a helpful technical assistant. Provide clear, concise, and accurate answers. When explaining concepts, use analogies where appropriate.', askAiCommands: GENERAL_HELPER_COMMANDS },
  { id: 'server-expert', label: 'Server Expert', systemPrompt: 'You are a Systems Administrator specializing in Linux and Windows servers. Focus on OS internals, kernel parameters, performance tuning, and security best practices. Provide specific commands for troubleshooting. When you need to identify the OS or hardware, propose investigation commands (e.g., "uname -a", "cat /etc/os-release"). HoTTY will automatically provide the output back to you after execution.', askAiCommands: SERVER_EXPERT_COMMANDS },
  { id: 'cloud-expert', label: 'Cloud Expert', systemPrompt: 'You are a Cloud Architect (AWS/Azure/GCP). Advise on cloud-native patterns, microservices, and infrastructure-as-code (Terraform/K8s). Prioritize scalability, cost-efficiency, and security in your recommendations.', askAiCommands: CLOUD_EXPERT_COMMANDS },
  { id: 'coding-expert', label: 'Coding Expert', systemPrompt: 'You are a Senior Software Engineer. Provide idiomatic, clean, and performant code solutions. Explain time/space complexity (Big O) where relevant. Prefer modern syntax and safety.', askAiCommands: CODING_EXPERT_COMMANDS },
  { id: 'security-analyst', label: 'Security Analyst', systemPrompt: 'You are a Cybersecurity Analyst. Analyze logs and configurations for potential vulnerabilities, threats, and indicators of compromise (IoCs). Recommend mitigation strategies based on industry standards (NIST/CIS).', askAiCommands: SECURITY_ANALYST_COMMANDS },
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

  // Prompt highlighting
  enablePromptHighlight: boolean;
  promptHighlightColor: string;
  promptPatterns: PromptPattern[];

  // Logging
  loggingEnabled: boolean;
  loggingPath: string;

  // Features
  enabledFeatures: Record<FeatureId, boolean>;

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
  enablePromptHighlight: true,
  promptHighlightColor: '',
  promptPatterns: DEFAULT_PROMPT_PATTERNS,
  loggingEnabled: false,
  loggingPath: '',
  enabledFeatures: {
    'ai-chat': true,
    'log-viewer': true,
    'ping-monitor': true,
    'text-editor': true,
    'file-explorer': true,
    'file-server': true,
    'web-browser': true,
  },
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
  // Hybrid (managed whitelist/blacklist + AI for the gray zone) is the default
  // for all users; the v15 migration switches existing users to it too.
  classifierStrategy: 'hybrid',
  aiClassifyConfidenceThreshold: 0.7,
  aiPersonas: DEFAULT_PERSONAS,
  watchBufferLimit: 500000,
  aiCommandIdleTimeoutSecs: 10,
  aiSleepAsClientDelay: true,
  aiSleepMaxDelaySecs: 900,
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
      version: 19,
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
