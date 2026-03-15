import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PromptPattern, PersonaDefinition, AskGeminiCommand } from '../types/appTypes';
import * as electronService from '../services/electronService';

// ── State shape ──────────────────────────────────────────────────────────────

export interface SettingsState {
    // Encoding / Font
    globalEncoding: string;
    fontSize: number;
    fontFamily: string;

    // Theme
    theme: string;

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

    // Ask AI Commands
    askGeminiCommands: AskGeminiCommand[];

    // Sidebar Position
    sidebarPosition: 'left' | 'right';

    // Proactive Instruction
    proactiveInstruction: string;

    // Interactive Stabilization Timeout
    interactiveStabilizationTimeout: number;
}

// ── Actions ───────────────────────────────────────────────────────────────────

export interface SettingsActions {
    updateGlobalEncoding: (v: string) => void;
    updateFontSize: (v: number) => void;
    updateFontFamily: (v: string) => void;
    updateTheme: (v: string) => void;
    updateTerminalForeground: (color: string) => void;
    updateTerminalBackground: (color: string) => void;
    updateTerminalBackgroundInactive: (color: string) => void;
    updatePaneBackground: (color: string) => void;
    updatePaneBackgroundMode: (mode: 'color' | 'image') => void;
    updatePaneBackgroundImage: (url: string) => void;
    updateSshKeepAliveEnabled: (v: boolean) => void;
    updateSshKeepAliveInterval: (v: number) => void;
    updateTelnetKeepAliveEnabled: (v: boolean) => void;
    updateTelnetKeepAliveInterval: (v: number) => void;
    updateLoggingEnabled: (v: boolean) => void;
    updateLoggingPath: (v: string) => void;
    toggleLineWrap: () => void;
    updateScrollback: (v: number) => void;
    updateWatchBufferLimit: (v: number) => void;
    updateBackspaceSendsDel: (v: boolean) => void;
    updateRightClickPaste: (v: boolean) => void;
    updateShowSystemPrompt: (v: boolean) => void;
    updateEnablePromptHighlight: (v: boolean) => void;
    updatePromptHighlightColor: (v: string) => void;
    updatePromptPatterns: (v: PromptPattern[]) => void;
    updateAiPersonas: (v: PersonaDefinition[]) => void;
    updateAskGeminiCommands: (v: AskGeminiCommand[]) => void;
    updateSidebarPosition: (v: 'left' | 'right') => void;
    updateProactiveInstruction: (v: string) => void;
    updateInteractiveStabilizationTimeout: (v: number) => void;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_PROMPT_PATTERNS: PromptPattern[] = [
    { id: 'cisco', name: 'Cisco / Allied Telesis', pattern: '^([a-zA-Z0-9_\\-\\./]+(?:\\([a-zA-Z0-9_\\-\\./]+\\))?[>#])\\s*', enabled: true },
    { id: 'fortigate', name: 'Fortigate', pattern: '^([a-zA-Z0-9_\\-\\.]+(?:\\s\\([a-zA-Z0-9_\\-\\.]+\\))?[#$])\\s*', enabled: true },
    { id: 'huawei', name: 'Huawei / Yamaha', pattern: '^([<\\[][a-zA-Z0-9_\\-\\./]+[>\\]])\\s*', enabled: true },
    { id: 'juniper', name: 'Juniper', pattern: '^([-_\\w]+@[-_\\w]+[>#])\\s*', enabled: true },
    { id: 'paloalto', name: 'Palo Alto / Arista', pattern: '^([-_\\w.]+@[-_\\w.]+[>#])\\s*', enabled: true },
    { id: 'linux', name: 'Linux', pattern: '^([-_\\w]+@[-_\\w]+:[^$# ]*[$#])\\s*', enabled: true },
    { id: 'cmd', name: 'Command Prompt', pattern: '^([A-Za-z]:.*>)\\s*', enabled: true },
    { id: 'powershell', name: 'PowerShell', pattern: '^(PS\\s+.*>)\\s*', enabled: true },
];

const DEFAULT_PERSONAS: PersonaDefinition[] = [
    { id: 'general-helper', label: 'General Helper', systemPrompt: 'You are a helpful technical assistant. Provide clear, concise, and accurate answers. When explaining concepts, use analogies where appropriate.' },
    { id: 'network-expert', label: 'Network Expert', systemPrompt: 'You are a Senior Network Engineer. Analyze network issues with a focus on OSI layers, routing protocols (BGP, OSPF), and switching. Use industry-standard terminology (Cisco/Juniper syntax) and formatting. When you need more information about a device, propose investigation commands (e.g., "show version", "show inventory"). HoTTY will automatically execute these and send back the results if the user clicks "Run in Terminal".' },
    { id: 'server-expert', label: 'Server Expert', systemPrompt: 'You are a Systems Administrator specializing in Linux and Windows servers. Focus on OS internals, kernel parameters, performance tuning, and security best practices. Provide specific commands for troubleshooting. When you need to identify the OS or hardware, propose investigation commands (e.g., "uname -a", "cat /etc/os-release"). HoTTY will automatically provide the output back to you after execution.' },
    { id: 'cloud-expert', label: 'Cloud Expert', systemPrompt: 'You are a Cloud Architect (AWS/Azure/GCP). Advise on cloud-native patterns, microservices, and infrastructure-as-code (Terraform/K8s). Prioritize scalability, cost-efficiency, and security in your recommendations.' },
    { id: 'coding-expert', label: 'Coding Expert', systemPrompt: 'You are a Senior Software Engineer. Provide idiomatic, clean, and performant code solutions. Explain time/space complexity (Big O) where relevant. Prefer modern syntax and safety.' },
    { id: 'security-analyst', label: 'Security Analyst', systemPrompt: 'You are a Cybersecurity Analyst. Analyze logs and configurations for potential vulnerabilities, threats, and indicators of compromise (IoCs). Recommend mitigation strategies based on industry standards (NIST/CIS).' },
];

const DEFAULT_GEMINI_COMMANDS: AskGeminiCommand[] = [
    { id: 'what-is-this', label: 'What is this?', promptTemplate: 'Explain the following text or code snippet concisely:\n\n{selection}' },
    { id: 'what-does-it-mean', label: 'What does it mean?', promptTemplate: 'Interpret the meaning of this log entry or message and its implications:\n\n{selection}' },
    { id: 'root-cause', label: 'Research root cause', promptTemplate: 'Analyze the following error or issue, identify 3 potential root causes, and suggest verification steps for each:\n\n{selection}' },
    { id: 'fix-this', label: 'Fix this', promptTemplate: 'Suggest a fix or improvement for the selected code or configuration:\n\n{selection}' },
];

const INITIAL_STATE: SettingsState = {
    globalEncoding: 'utf8',
    fontSize: 14,
    fontFamily: 'Consolas, "Courier New", monospace',
    theme: 'dark',
    terminalForeground: '#ffffff',
    terminalBackground: '#1e1e1e',
    terminalBackgroundInactive: '#121212',
    paneBackground: '#000200',
    paneBackgroundMode: 'color',
    paneBackgroundImage: '',
    customColors: {
        foreground: '#ffffff',
        background: '#1e1e1e',
        backgroundInactive: '#121212',
        paneBackground: '#000200',
    },
    sshKeepAliveEnabled: true,
    sshKeepAliveInterval: 10,
    telnetKeepAliveEnabled: true,
    telnetKeepAliveInterval: 30,
    loggingEnabled: false,
    loggingPath: '',
    lineWrapEnabled: true,
    scrollback: 10000,
    watchBufferLimit: 500000,
    backspaceSendsDel: false,
    rightClickPaste: true,
    showSystemPrompt: false,
    enablePromptHighlight: true,
    promptHighlightColor: 'rgba(255, 255, 255, 0.15)',
    promptPatterns: DEFAULT_PROMPT_PATTERNS,
    aiPersonas: DEFAULT_PERSONAS,
    askGeminiCommands: DEFAULT_GEMINI_COMMANDS,
    sidebarPosition: 'left',
    proactiveInstruction: 'If you need more information to fulfill the user\'s request, proactively suggest terminal commands using code blocks with the "execute" language tag, like this: ```execute\\n[command]\\n```. Do not just wait for user input if the information can be gathered via the terminal.',
    interactiveStabilizationTimeout: 10000,
};

// ── Store ─────────────────────────────────────────────────────────────────────

export const useSettingsStore = create<SettingsState & SettingsActions>()(
    persist(
        (set, get) => ({
            ...INITIAL_STATE,

            updateGlobalEncoding: (v) => set({ globalEncoding: v }),
            updateFontSize: (v) => set({ fontSize: v }),
            updateFontFamily: (v) => set({ fontFamily: v }),
            updateTheme: (v) => set({ theme: v }),

            updateTerminalForeground: (color) => set({ terminalForeground: color }),
            updateTerminalBackground: (color) => set({ terminalBackground: color }),
            updateTerminalBackgroundInactive: (color) => set({ terminalBackgroundInactive: color }),
            updatePaneBackground: (color) => set({ paneBackground: color }),

            updatePaneBackgroundMode: (mode) => set({ paneBackgroundMode: mode }),
            updatePaneBackgroundImage: (url) => set({ paneBackgroundImage: url }),

            updateSshKeepAliveEnabled: (v) => set({ sshKeepAliveEnabled: v }),
            updateSshKeepAliveInterval: (v) => set({ sshKeepAliveInterval: v }),
            updateTelnetKeepAliveEnabled: (v) => set({ telnetKeepAliveEnabled: v }),
            updateTelnetKeepAliveInterval: (v) => set({ telnetKeepAliveInterval: v }),

            updateLoggingEnabled: (v) => {
                set({ loggingEnabled: v });
                electronService.updateLogging(v, get().loggingPath);
            },

            updateLoggingPath: (v) => {
                set({ loggingPath: v });
                const { loggingEnabled } = get();
                if (loggingEnabled && v) {
                    electronService.updateLogging(loggingEnabled, v);
                }
            },

            toggleLineWrap: () => set((prev) => ({ lineWrapEnabled: !prev.lineWrapEnabled })),
            updateScrollback: (v) => set({ scrollback: v }),
            updateWatchBufferLimit: (v) => set({ watchBufferLimit: v }),
            updateBackspaceSendsDel: (v) => set({ backspaceSendsDel: v }),
            updateRightClickPaste: (v) => set({ rightClickPaste: v }),
            updateShowSystemPrompt: (v) => set({ showSystemPrompt: v }),
            updateEnablePromptHighlight: (v) => set({ enablePromptHighlight: v }),
            updatePromptHighlightColor: (v) => set({ promptHighlightColor: v }),
            updatePromptPatterns: (v) => set({ promptPatterns: v }),
            updateAiPersonas: (v) => set({ aiPersonas: v }),
            updateAskGeminiCommands: (v) => set({ askGeminiCommands: v }),
            updateSidebarPosition: (v) => set({ sidebarPosition: v }),
            updateProactiveInstruction: (v) => set({ proactiveInstruction: v }),
            updateInteractiveStabilizationTimeout: (v) => set({ interactiveStabilizationTimeout: v }),
        }),
        {
            name: 'hotty-settings',
            // Persist only state fields, not action functions
            partialize: (state) =>
                Object.fromEntries(
                    Object.entries(state).filter(([, v]) => typeof v !== 'function')
                ) as SettingsState,
        }
    )
);
