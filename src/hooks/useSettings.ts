import { useState, useCallback } from 'react';
import type { PromptPattern, PersonaDefinition, AskGeminiCommand } from '../App';
import { STORAGE_KEYS } from '../constants/storage';
import * as electronService from '../services/electronService';

// -- Types --

export interface SettingsState {
  // Encoding / Font
  globalEncoding: string;
  fontSize: number;
  fontFamily: string;

  // Theme
  theme: 'dark' | 'light' | 'medium' | 'custom';

  // Terminal Colors
  terminalForeground: string;
  terminalBackground: string;
  terminalBackgroundInactive: string;
  paneBackground: string;
  paneBackgroundMode: 'color' | 'image';
  paneBackgroundImage: string;

  // Custom colors cache
  customColors: {
    foreground: string;
    background: string;
    backgroundInactive: string;
    paneBackground: string;
  };

  // SSH KeepAlive
  sshKeepAliveEnabled: boolean;
  sshKeepAliveInterval: number;

  // Telnet KeepAlive
  telnetKeepAliveEnabled: boolean;
  telnetKeepAliveInterval: number;

  // Logging
  loggingEnabled: boolean;
  loggingPath: string;

  // Line Wrap
  lineWrapEnabled: boolean;

  // Scrollback
  scrollback: number;

  // Watch Buffer
  watchBufferLimit: number;

  // Backspace
  backspaceSendsDel: boolean;

  // Right-Click Paste
  rightClickPaste: boolean;

  // System Prompt
  showSystemPrompt: boolean;

  // Prompt Highlight
  enablePromptHighlight: boolean;
  promptHighlightColor: string;
  promptPatterns: PromptPattern[];

  // AI Personas
  aiPersonas: PersonaDefinition[];

  // Ask Gemini Commands
  askGeminiCommands: AskGeminiCommand[];

  // Sidebar Position
  sidebarPosition: 'left' | 'right';

  // Proactive Instruction
  proactiveInstruction: string;

  // Interactive Stabilization Timeout
  interactiveStabilizationTimeout: number;
}

// -- Default values --

const DEFAULT_PROMPT_PATTERNS: PromptPattern[] = [
  { id: 'cisco', name: 'Cisco / Allied Telesis', pattern: '^([a-zA-Z0-9_\\-\\./]+(?:\\([a-zA-Z0-9_\\-\\./]+\\))?[>#])\\s*', enabled: true },
  { id: 'fortigate', name: 'Fortigate', pattern: '^([a-zA-Z0-9_\\-\\.]+(?:\\s\\([a-zA-Z0-9_\\-\\.]+\\))?[#$])\\s*', enabled: true },
  { id: 'huawei', name: 'Huawei / Yamaha', pattern: '^([<\\[][a-zA-Z0-9_\\-\\./]+[>\\]])\\s*', enabled: true },
  { id: 'juniper', name: 'Juniper', pattern: '^([-_\\w]+@[-_\\w]+[>#])\\s*', enabled: true },
  { id: 'paloalto', name: 'Palo Alto / Arista', pattern: '^([-_\\w.]+@[-_\\w.]+[>#])\\s*', enabled: true },
  { id: 'linux', name: 'Linux', pattern: '^([-_\\w]+@[-_\\w]+:[^$# ]*[$#])\\s*', enabled: true },
  { id: 'cmd', name: 'Command Prompt', pattern: '^([A-Za-z]:.*>)\\s*', enabled: true },
  { id: 'powershell', name: 'PowerShell', pattern: '^(PS\\s+.*>)\\s*', enabled: true }
];

const DEFAULT_PERSONAS: PersonaDefinition[] = [
  { id: 'general-helper', label: 'General Helper', systemPrompt: 'You are a helpful technical assistant. Provide clear, concise, and accurate answers. When explaining concepts, use analogies where appropriate.' },
  { id: 'network-expert', label: 'Network Expert', systemPrompt: 'You are a Senior Network Engineer. Analyze network issues with a focus on OSI layers, routing protocols (BGP, OSPF), and switching. Use industry-standard terminology (Cisco/Juniper syntax) and formatting. When you need more information about a device, propose investigation commands (e.g., "show version", "show inventory"). HoTTY will automatically execute these and send back the results if the user clicks "Run in Terminal".' },
  { id: 'server-expert', label: 'Server Expert', systemPrompt: 'You are a Systems Administrator specializing in Linux and Windows servers. Focus on OS internals, kernel parameters, performance tuning, and security best practices. Provide specific commands for troubleshooting. When you need to identify the OS or hardware, propose investigation commands (e.g., "uname -a", "cat /etc/os-release"). HoTTY will automatically provide the output back to you after execution.' },
  { id: 'cloud-expert', label: 'Cloud Expert', systemPrompt: 'You are a Cloud Architect (AWS/Azure/GCP). Advise on cloud-native patterns, microservices, and infrastructure-as-code (Terraform/K8s). Prioritize scalability, cost-efficiency, and security in your recommendations.' },
  { id: 'coding-expert', label: 'Coding Expert', systemPrompt: 'You are a Senior Software Engineer. Provide idiomatic, clean, and performant code solutions. Explain time/space complexity (Big O) where relevant. Prefer modern syntax and safety.' },
  { id: 'security-analyst', label: 'Security Analyst', systemPrompt: 'You are a Cybersecurity Analyst. Analyze logs and configurations for potential vulnerabilities, threats, and indicators of compromise (IoCs). Recommend mitigation strategies based on industry standards (NIST/CIS).' }
];

const DEFAULT_GEMINI_COMMANDS: AskGeminiCommand[] = [
  { id: 'what-is-this', label: 'What is this?', promptTemplate: 'Explain the following text or code snippet concisely:\n\n{selection}' },
  { id: 'what-does-it-mean', label: 'What does it mean?', promptTemplate: 'Interpret the meaning of this log entry or message and its implications:\n\n{selection}' },
  { id: 'root-cause', label: 'Research root cause', promptTemplate: 'Analyze the following error or issue, identify 3 potential root causes, and suggest verification steps for each:\n\n{selection}' },
  { id: 'fix-this', label: 'Fix this', promptTemplate: 'Suggest a fix or improvement for the selected code or configuration:\n\n{selection}' },
];

// -- Helper: get from localStorage with default --

function lsGet(key: string, defaultValue: string): string {
  return localStorage.getItem(key) || defaultValue;
}

function lsBool(key: string, defaultValue: boolean): boolean {
  const val = localStorage.getItem(key);
  if (val === null) return defaultValue;
  return val === 'true';
}

function lsInt(key: string, defaultValue: number): number {
  const val = localStorage.getItem(key);
  return val ? parseInt(val, 10) : defaultValue;
}


function lsJSON<T>(key: string, defaultValue: T): T {
  const val = localStorage.getItem(key);
  if (val) {
    try { return JSON.parse(val); } catch { /* fall through */ }
  }
  return defaultValue;
}

// -- Hook --

export function useSettings() {
  // Initialize all settings from localStorage
  const [settings, setSettings] = useState<SettingsState>(() => ({
    globalEncoding: lsGet(STORAGE_KEYS.GLOBAL_ENCODING, 'utf8'),
    fontSize: lsInt(STORAGE_KEYS.FONT_SIZE, 14),
    fontFamily: lsGet(STORAGE_KEYS.FONT_FAMILY, 'Consolas, "Courier New", monospace'),
    theme: (lsGet(STORAGE_KEYS.THEME, 'dark') as SettingsState['theme']),
    terminalForeground: lsGet(STORAGE_KEYS.TERMINAL_FOREGROUND, '#ffffff'),
    terminalBackground: lsGet(STORAGE_KEYS.TERMINAL_BACKGROUND, '#1e1e1e'),
    terminalBackgroundInactive: lsGet(STORAGE_KEYS.TERMINAL_BG_INACTIVE, '#121212'),
    paneBackground: lsGet(STORAGE_KEYS.PANE_BACKGROUND, '#000200'),
    paneBackgroundMode: (() => {
      const saved = localStorage.getItem(STORAGE_KEYS.PANE_BACKGROUND_MODE);
      if (saved === 'default') return 'color' as const;
      return (saved as 'color' | 'image') || 'color';
    })(),
    paneBackgroundImage: lsGet(STORAGE_KEYS.PANE_BACKGROUND_IMAGE, 'HoTTY_background.svg'),
    customColors: {
      foreground: lsGet(STORAGE_KEYS.CUSTOM_FOREGROUND, '#ffffff'),
      background: lsGet(STORAGE_KEYS.CUSTOM_BACKGROUND, '#1e1e1e'),
      backgroundInactive: lsGet(STORAGE_KEYS.CUSTOM_BG_INACTIVE, '#121212'),
      paneBackground: lsGet(STORAGE_KEYS.CUSTOM_PANE_BG, '#000200'),
    },
    sshKeepAliveEnabled: lsBool(STORAGE_KEYS.SSH_KEEPALIVE_ENABLED, true),
    sshKeepAliveInterval: lsInt(STORAGE_KEYS.SSH_KEEPALIVE_INTERVAL, 10),
    telnetKeepAliveEnabled: lsBool(STORAGE_KEYS.TELNET_KEEPALIVE_ENABLED, true),
    telnetKeepAliveInterval: lsInt(STORAGE_KEYS.TELNET_KEEPALIVE_INTERVAL, 30),
    loggingEnabled: lsBool(STORAGE_KEYS.LOGGING_ENABLED, false),
    loggingPath: lsGet(STORAGE_KEYS.LOGGING_PATH, ''),
    lineWrapEnabled: lsBool(STORAGE_KEYS.LINE_WRAP_ENABLED, true),
    scrollback: lsInt(STORAGE_KEYS.SCROLLBACK, 10000),
    watchBufferLimit: lsInt(STORAGE_KEYS.WATCH_BUFFER_LIMIT, 500000),
    backspaceSendsDel: lsBool(STORAGE_KEYS.BACKSPACE_SENDS_DEL, false),
    rightClickPaste: lsBool(STORAGE_KEYS.RIGHT_CLICK_PASTE, true),
    showSystemPrompt: lsBool(STORAGE_KEYS.SHOW_SYSTEM_PROMPT, false),
    enablePromptHighlight: lsBool(STORAGE_KEYS.ENABLE_PROMPT_HIGHLIGHT, true),
    promptHighlightColor: lsGet(STORAGE_KEYS.PROMPT_HIGHLIGHT_COLOR, 'rgba(255, 255, 255, 0.15)'),
    promptPatterns: lsJSON(STORAGE_KEYS.PROMPT_PATTERNS, DEFAULT_PROMPT_PATTERNS),
    aiPersonas: lsJSON(STORAGE_KEYS.AI_PERSONAS, DEFAULT_PERSONAS),
    askGeminiCommands: lsJSON(STORAGE_KEYS.ASK_GEMINI_COMMANDS, DEFAULT_GEMINI_COMMANDS),
    sidebarPosition: (lsGet(STORAGE_KEYS.SIDEBAR_POSITION, 'left') as 'left' | 'right'),
    proactiveInstruction: lsGet(STORAGE_KEYS.PROACTIVE_INSTRUCTION,
      'If you need more information to fulfill the user\'s request, proactively suggest terminal commands using code blocks with the "execute" language tag, like this: ```execute\\n[command]\\n```. Do not just wait for user input if the information can be gathered via the terminal.'),
    interactiveStabilizationTimeout: lsInt(STORAGE_KEYS.INTERACTIVE_STABILIZATION_TIMEOUT, 10000),
  }));

  // -- Generic updater with localStorage persistence --
  const update = useCallback(<K extends keyof SettingsState>(key: K, value: SettingsState[K], lsKey?: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    if (lsKey) {
      if (typeof value === 'object') {
        localStorage.setItem(lsKey, JSON.stringify(value));
      } else {
        localStorage.setItem(lsKey, String(value));
      }
    }
  }, []);

  // -- Specific updaters (preserving the same API as before) --

  const updateGlobalEncoding = useCallback((v: string) => {
    update('globalEncoding', v, STORAGE_KEYS.GLOBAL_ENCODING);
  }, [update]);

  const updateFontSize = useCallback((v: number) => {
    update('fontSize', v, STORAGE_KEYS.FONT_SIZE);
  }, [update]);

  const updateFontFamily = useCallback((v: string) => {
    update('fontFamily', v, STORAGE_KEYS.FONT_FAMILY);
  }, [update]);

  const updateSshKeepAliveEnabled = useCallback((v: boolean) => {
    update('sshKeepAliveEnabled', v, STORAGE_KEYS.SSH_KEEPALIVE_ENABLED);
  }, [update]);

  const updateSshKeepAliveInterval = useCallback((v: number) => {
    update('sshKeepAliveInterval', v, STORAGE_KEYS.SSH_KEEPALIVE_INTERVAL);
  }, [update]);

  const updateTelnetKeepAliveEnabled = useCallback((v: boolean) => {
    update('telnetKeepAliveEnabled', v, STORAGE_KEYS.TELNET_KEEPALIVE_ENABLED);
  }, [update]);

  const updateTelnetKeepAliveInterval = useCallback((v: number) => {
    update('telnetKeepAliveInterval', v, STORAGE_KEYS.TELNET_KEEPALIVE_INTERVAL);
  }, [update]);

  const updateLoggingEnabled = useCallback((v: boolean) => {
    update('loggingEnabled', v, STORAGE_KEYS.LOGGING_ENABLED);
    electronService.updateLogging(v, settings.loggingPath);
  }, [update, settings.loggingPath]);

  const updateLoggingPath = useCallback((v: string) => {
    update('loggingPath', v, STORAGE_KEYS.LOGGING_PATH);
    if (settings.loggingEnabled && v) {
      electronService.updateLogging(settings.loggingEnabled, v);
    }
  }, [update, settings.loggingEnabled]);

  const updateScrollback = useCallback((v: number) => {
    update('scrollback', v, STORAGE_KEYS.SCROLLBACK);
  }, [update]);

  const updateWatchBufferLimit = useCallback((v: number) => {
    update('watchBufferLimit', v, STORAGE_KEYS.WATCH_BUFFER_LIMIT);
  }, [update]);

  const updateBackspaceSendsDel = useCallback((v: boolean) => {
    update('backspaceSendsDel', v, STORAGE_KEYS.BACKSPACE_SENDS_DEL);
  }, [update]);

  const updateRightClickPaste = useCallback((v: boolean) => {
    update('rightClickPaste', v, STORAGE_KEYS.RIGHT_CLICK_PASTE);
  }, [update]);

  const updateShowSystemPrompt = useCallback((v: boolean) => {
    update('showSystemPrompt', v, STORAGE_KEYS.SHOW_SYSTEM_PROMPT);
  }, [update]);

  const updateEnablePromptHighlight = useCallback((v: boolean) => {
    update('enablePromptHighlight', v, STORAGE_KEYS.ENABLE_PROMPT_HIGHLIGHT);
  }, [update]);

  const updatePromptHighlightColor = useCallback((v: string) => {
    update('promptHighlightColor', v, STORAGE_KEYS.PROMPT_HIGHLIGHT_COLOR);
  }, [update]);

  const updatePromptPatterns = useCallback((v: PromptPattern[]) => {
    update('promptPatterns', v, STORAGE_KEYS.PROMPT_PATTERNS);
  }, [update]);

  const updateAiPersonas = useCallback((v: PersonaDefinition[]) => {
    update('aiPersonas', v, STORAGE_KEYS.AI_PERSONAS);
  }, [update]);

  const updateAskGeminiCommands = useCallback((v: AskGeminiCommand[]) => {
    update('askGeminiCommands', v, STORAGE_KEYS.ASK_GEMINI_COMMANDS);
  }, [update]);

  const updateSidebarPosition = useCallback((v: 'left' | 'right') => {
    update('sidebarPosition', v, STORAGE_KEYS.SIDEBAR_POSITION);
  }, [update]);

  const updateProactiveInstruction = useCallback((v: string) => {
    update('proactiveInstruction', v, STORAGE_KEYS.PROACTIVE_INSTRUCTION);
  }, [update]);

  const updateInteractiveStabilizationTimeout = useCallback((v: number) => {
    update('interactiveStabilizationTimeout', v, STORAGE_KEYS.INTERACTIVE_STABILIZATION_TIMEOUT);
  }, [update]);

  // -- Terminal color updaters (with custom color cache) --

  const updateTerminalForeground = useCallback((color: string) => {
    setSettings(prev => {
      const next = { ...prev, terminalForeground: color };
      localStorage.setItem(STORAGE_KEYS.TERMINAL_FOREGROUND, color);
      if (prev.theme === 'custom') {
        localStorage.setItem(STORAGE_KEYS.CUSTOM_FOREGROUND, color);
        next.customColors = { ...prev.customColors, foreground: color };
      }
      return next;
    });
  }, []);

  const updateTerminalBackground = useCallback((color: string) => {
    setSettings(prev => {
      const next = { ...prev, terminalBackground: color };
      localStorage.setItem(STORAGE_KEYS.TERMINAL_BACKGROUND, color);
      if (prev.theme === 'custom') {
        localStorage.setItem(STORAGE_KEYS.CUSTOM_BACKGROUND, color);
        next.customColors = { ...prev.customColors, background: color };
      }
      return next;
    });
  }, []);

  const updateTerminalBackgroundInactive = useCallback((color: string) => {
    setSettings(prev => {
      const next = { ...prev, terminalBackgroundInactive: color };
      localStorage.setItem(STORAGE_KEYS.TERMINAL_BG_INACTIVE, color);
      if (prev.theme === 'custom') {
        localStorage.setItem(STORAGE_KEYS.CUSTOM_BG_INACTIVE, color);
        next.customColors = { ...prev.customColors, backgroundInactive: color };
      }
      return next;
    });
  }, []);

  const updatePaneBackground = useCallback((color: string) => {
    setSettings(prev => {
      const next = { ...prev, paneBackground: color };
      localStorage.setItem(STORAGE_KEYS.PANE_BACKGROUND, color);
      if (prev.theme === 'custom') {
        localStorage.setItem(STORAGE_KEYS.CUSTOM_PANE_BG, color);
        next.customColors = { ...prev.customColors, paneBackground: color };
      }
      return next;
    });
  }, []);

  const updatePaneBackgroundMode = useCallback((mode: 'color' | 'image') => {
    update('paneBackgroundMode', mode, STORAGE_KEYS.PANE_BACKGROUND_MODE);
  }, [update]);

  const updatePaneBackgroundImage = useCallback((url: string) => {
    update('paneBackgroundImage', url, STORAGE_KEYS.PANE_BACKGROUND_IMAGE);
  }, [update]);

  const toggleLineWrap = useCallback(() => {
    setSettings(prev => {
      const newValue = !prev.lineWrapEnabled;
      localStorage.setItem(STORAGE_KEYS.LINE_WRAP_ENABLED, newValue.toString());
      return { ...prev, lineWrapEnabled: newValue };
    });
  }, []);

  const updateTheme = useCallback((v: 'dark' | 'light' | 'medium' | 'custom') => {
    update('theme', v, STORAGE_KEYS.THEME);
  }, [update]);

  return {
    settings,
    // Individual updaters
    updateTheme,
    updateGlobalEncoding,
    updateFontSize,
    updateFontFamily,
    updateSshKeepAliveEnabled,
    updateSshKeepAliveInterval,
    updateTelnetKeepAliveEnabled,
    updateTelnetKeepAliveInterval,
    updateLoggingEnabled,
    updateLoggingPath,
    updateScrollback,
    updateWatchBufferLimit,
    updateBackspaceSendsDel,
    updateRightClickPaste,
    updateShowSystemPrompt,
    updateEnablePromptHighlight,
    updatePromptHighlightColor,
    updatePromptPatterns,
    updateAiPersonas,
    updateAskGeminiCommands,
    updateSidebarPosition,
    updateProactiveInstruction,
    updateInteractiveStabilizationTimeout,
    updateTerminalForeground,
    updateTerminalBackground,
    updateTerminalBackgroundInactive,
    updatePaneBackground,
    updatePaneBackgroundMode,
    updatePaneBackgroundImage,
    toggleLineWrap,
  };
}
