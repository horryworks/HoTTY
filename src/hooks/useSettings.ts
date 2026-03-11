import { useState, useCallback } from 'react';
import type { PromptPattern, PersonaDefinition, AskGeminiCommand } from '../App';

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
    globalEncoding: lsGet('hterm_global_encoding', 'utf8'),
    fontSize: lsInt('hterm_font_size', 14),
    fontFamily: lsGet('hterm_font_family', 'Consolas, "Courier New", monospace'),
    theme: (lsGet('hterm_theme', 'dark') as SettingsState['theme']),
    terminalForeground: lsGet('hterm_terminal_foreground', '#ffffff'),
    terminalBackground: lsGet('hterm_terminal_background', '#1e1e1e'),
    terminalBackgroundInactive: lsGet('hterm_terminal_background_inactive', '#121212'),
    paneBackground: lsGet('hterm_pane_background', '#000200'),
    paneBackgroundMode: (() => {
      const saved = localStorage.getItem('hterm_pane_background_mode');
      if (saved === 'default') return 'color' as const;
      return (saved as 'color' | 'image') || 'color';
    })(),
    paneBackgroundImage: lsGet('hterm_pane_background_image', 'HoTTY_background.svg'),
    customColors: {
      foreground: lsGet('hterm_custom_terminal_foreground', '#ffffff'),
      background: lsGet('hterm_custom_terminal_background', '#1e1e1e'),
      backgroundInactive: lsGet('hterm_custom_terminal_background_inactive', '#121212'),
      paneBackground: lsGet('hterm_custom_pane_background', '#000200'),
    },
    sshKeepAliveEnabled: lsBool('hterm_ssh_keepalive_enabled', true),
    sshKeepAliveInterval: lsInt('hterm_ssh_keepalive_interval', 10),
    telnetKeepAliveEnabled: lsBool('hterm_telnet_keepalive_enabled', true),
    telnetKeepAliveInterval: lsInt('hterm_telnet_keepalive_interval', 30),
    loggingEnabled: lsBool('hterm_logging_enabled', false),
    loggingPath: lsGet('hterm_logging_path', ''),
    lineWrapEnabled: lsBool('hterm_line_wrap_enabled', true),
    scrollback: lsInt('hterm_scrollback', 10000),
    watchBufferLimit: lsInt('hotty_watch_buffer_limit', 500000),
    backspaceSendsDel: lsBool('hterm_backspace_sends_del', false),
    rightClickPaste: lsBool('hterm_right_click_paste', true),
    showSystemPrompt: lsBool('hotty_show_system_prompt', false),
    enablePromptHighlight: lsBool('hotty_enable_prompt_highlight', true),
    promptHighlightColor: lsGet('hotty_prompt_highlight_color', 'rgba(255, 255, 255, 0.15)'),
    promptPatterns: lsJSON('hotty_prompt_patterns', DEFAULT_PROMPT_PATTERNS),
    aiPersonas: lsJSON('hotty_ai_personas', DEFAULT_PERSONAS),
    askGeminiCommands: lsJSON('hotty_ask_gemini_commands', DEFAULT_GEMINI_COMMANDS),
    sidebarPosition: (lsGet('hterm_sidebar_position', 'left') as 'left' | 'right'),
    proactiveInstruction: lsGet('hotty_gemini_proactive_instruction',
      'If you need more information to fulfill the user\'s request, proactively suggest terminal commands using code blocks with the "execute" language tag, like this: ```execute\\n[command]\\n```. Do not just wait for user input if the information can be gathered via the terminal.'),
    interactiveStabilizationTimeout: lsInt('hotty_interactive_stabilization_timeout', 10000),
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
    update('globalEncoding', v, 'hterm_global_encoding');
  }, [update]);

  const updateFontSize = useCallback((v: number) => {
    update('fontSize', v, 'hterm_font_size');
  }, [update]);

  const updateFontFamily = useCallback((v: string) => {
    update('fontFamily', v, 'hterm_font_family');
  }, [update]);

  const updateSshKeepAliveEnabled = useCallback((v: boolean) => {
    update('sshKeepAliveEnabled', v, 'hterm_ssh_keepalive_enabled');
  }, [update]);

  const updateSshKeepAliveInterval = useCallback((v: number) => {
    update('sshKeepAliveInterval', v, 'hterm_ssh_keepalive_interval');
  }, [update]);

  const updateTelnetKeepAliveEnabled = useCallback((v: boolean) => {
    update('telnetKeepAliveEnabled', v, 'hterm_telnet_keepalive_enabled');
  }, [update]);

  const updateTelnetKeepAliveInterval = useCallback((v: number) => {
    update('telnetKeepAliveInterval', v, 'hterm_telnet_keepalive_interval');
  }, [update]);

  const updateLoggingEnabled = useCallback((v: boolean) => {
    update('loggingEnabled', v, 'hterm_logging_enabled');
    window.electronAPI.updateLogging(v, settings.loggingPath);
  }, [update, settings.loggingPath]);

  const updateLoggingPath = useCallback((v: string) => {
    update('loggingPath', v, 'hterm_logging_path');
    if (settings.loggingEnabled && v) {
      window.electronAPI.updateLogging(settings.loggingEnabled, v);
    }
  }, [update, settings.loggingEnabled]);

  const updateScrollback = useCallback((v: number) => {
    update('scrollback', v, 'hterm_scrollback');
  }, [update]);

  const updateWatchBufferLimit = useCallback((v: number) => {
    update('watchBufferLimit', v, 'hotty_watch_buffer_limit');
  }, [update]);

  const updateBackspaceSendsDel = useCallback((v: boolean) => {
    update('backspaceSendsDel', v, 'hterm_backspace_sends_del');
  }, [update]);

  const updateRightClickPaste = useCallback((v: boolean) => {
    update('rightClickPaste', v, 'hterm_right_click_paste');
  }, [update]);

  const updateShowSystemPrompt = useCallback((v: boolean) => {
    update('showSystemPrompt', v, 'hotty_show_system_prompt');
  }, [update]);

  const updateEnablePromptHighlight = useCallback((v: boolean) => {
    update('enablePromptHighlight', v, 'hotty_enable_prompt_highlight');
  }, [update]);

  const updatePromptHighlightColor = useCallback((v: string) => {
    update('promptHighlightColor', v, 'hotty_prompt_highlight_color');
  }, [update]);

  const updatePromptPatterns = useCallback((v: PromptPattern[]) => {
    update('promptPatterns', v, 'hotty_prompt_patterns');
  }, [update]);

  const updateAiPersonas = useCallback((v: PersonaDefinition[]) => {
    update('aiPersonas', v, 'hotty_ai_personas');
  }, [update]);

  const updateAskGeminiCommands = useCallback((v: AskGeminiCommand[]) => {
    update('askGeminiCommands', v, 'hotty_ask_gemini_commands');
  }, [update]);

  const updateSidebarPosition = useCallback((v: 'left' | 'right') => {
    update('sidebarPosition', v, 'hterm_sidebar_position');
  }, [update]);

  const updateProactiveInstruction = useCallback((v: string) => {
    update('proactiveInstruction', v, 'hotty_gemini_proactive_instruction');
  }, [update]);

  const updateInteractiveStabilizationTimeout = useCallback((v: number) => {
    update('interactiveStabilizationTimeout', v, 'hotty_interactive_stabilization_timeout');
  }, [update]);

  // -- Terminal color updaters (with custom color cache) --

  const updateTerminalForeground = useCallback((color: string) => {
    setSettings(prev => {
      const next = { ...prev, terminalForeground: color };
      localStorage.setItem('hterm_terminal_foreground', color);
      if (prev.theme === 'custom') {
        localStorage.setItem('hterm_custom_terminal_foreground', color);
        next.customColors = { ...prev.customColors, foreground: color };
      }
      return next;
    });
  }, []);

  const updateTerminalBackground = useCallback((color: string) => {
    setSettings(prev => {
      const next = { ...prev, terminalBackground: color };
      localStorage.setItem('hterm_terminal_background', color);
      if (prev.theme === 'custom') {
        localStorage.setItem('hterm_custom_terminal_background', color);
        next.customColors = { ...prev.customColors, background: color };
      }
      return next;
    });
  }, []);

  const updateTerminalBackgroundInactive = useCallback((color: string) => {
    setSettings(prev => {
      const next = { ...prev, terminalBackgroundInactive: color };
      localStorage.setItem('hterm_terminal_background_inactive', color);
      if (prev.theme === 'custom') {
        localStorage.setItem('hterm_custom_terminal_background_inactive', color);
        next.customColors = { ...prev.customColors, backgroundInactive: color };
      }
      return next;
    });
  }, []);

  const updatePaneBackground = useCallback((color: string) => {
    setSettings(prev => {
      const next = { ...prev, paneBackground: color };
      localStorage.setItem('hterm_pane_background', color);
      if (prev.theme === 'custom') {
        localStorage.setItem('hterm_custom_pane_background', color);
        next.customColors = { ...prev.customColors, paneBackground: color };
      }
      return next;
    });
  }, []);

  const updatePaneBackgroundMode = useCallback((mode: 'color' | 'image') => {
    update('paneBackgroundMode', mode, 'hterm_pane_background_mode');
  }, [update]);

  const updatePaneBackgroundImage = useCallback((url: string) => {
    update('paneBackgroundImage', url, 'hterm_pane_background_image');
  }, [update]);

  const toggleLineWrap = useCallback(() => {
    setSettings(prev => {
      const newValue = !prev.lineWrapEnabled;
      localStorage.setItem('hterm_line_wrap_enabled', newValue.toString());
      return { ...prev, lineWrapEnabled: newValue };
    });
  }, []);

  const updateTheme = useCallback((v: 'dark' | 'light' | 'medium' | 'custom') => {
    update('theme', v, 'hterm_theme');
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
