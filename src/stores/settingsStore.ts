import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProtocolId, FeatureId, PromptPattern, PersonaDefinition, AskAiCommand } from '../types/appTypes';
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

    // AI Personas (each persona includes its own Ask AI Commands)
    aiPersonas: PersonaDefinition[];

    // Sidebar Position
    sidebarPosition: 'left' | 'right';

    // Proactive Instruction
    proactiveInstruction: string;

    // Interactive Stabilization Timeout
    interactiveStabilizationTimeout: number;

    // Active AI Provider
    activeAiProvider: 'gemini' | 'vertexai' | 'openai' | 'anthropic';

    // Active Persona (used to resolve Ask AI commands for context menus)
    activePersonaId: string;

    // Protocol & Feature Toggles
    enabledProtocols: Record<ProtocolId, boolean>;
    enabledFeatures: Record<FeatureId, boolean>;
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
    updateSidebarPosition: (v: 'left' | 'right') => void;
    updateProactiveInstruction: (v: string) => void;
    updateInteractiveStabilizationTimeout: (v: number) => void;
    updateActiveAiProvider: (v: 'gemini' | 'vertexai' | 'openai' | 'anthropic') => void;
    updateActivePersonaId: (v: string) => void;
    getActiveAskAiCommands: () => AskAiCommand[];
    updateEnabledProtocol: (protocol: ProtocolId, enabled: boolean) => void;
    updateEnabledFeature: (feature: FeatureId, enabled: boolean) => void;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

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
    { id: 'network-expert', label: 'Network Expert', systemPrompt: 'You are a Senior Network Engineer. Analyze network issues with a focus on OSI layers, routing protocols (BGP, OSPF), and switching. Use industry-standard terminology (Cisco/Juniper syntax) and formatting. When you need more information about a device, propose investigation commands (e.g., "show version", "show inventory"). HoTTY will automatically execute these and send back the results if the user clicks "Run in Terminal".', askAiCommands: NETWORK_EXPERT_COMMANDS },
    { id: 'general-helper', label: 'General Helper', systemPrompt: 'You are a helpful technical assistant. Provide clear, concise, and accurate answers. When explaining concepts, use analogies where appropriate.', askAiCommands: GENERAL_HELPER_COMMANDS },
    { id: 'server-expert', label: 'Server Expert', systemPrompt: 'You are a Systems Administrator specializing in Linux and Windows servers. Focus on OS internals, kernel parameters, performance tuning, and security best practices. Provide specific commands for troubleshooting. When you need to identify the OS or hardware, propose investigation commands (e.g., "uname -a", "cat /etc/os-release"). HoTTY will automatically provide the output back to you after execution.', askAiCommands: SERVER_EXPERT_COMMANDS },
    { id: 'cloud-expert', label: 'Cloud Expert', systemPrompt: 'You are a Cloud Architect (AWS/Azure/GCP). Advise on cloud-native patterns, microservices, and infrastructure-as-code (Terraform/K8s). Prioritize scalability, cost-efficiency, and security in your recommendations.', askAiCommands: CLOUD_EXPERT_COMMANDS },
    { id: 'coding-expert', label: 'Coding Expert', systemPrompt: 'You are a Senior Software Engineer. Provide idiomatic, clean, and performant code solutions. Explain time/space complexity (Big O) where relevant. Prefer modern syntax and safety.', askAiCommands: CODING_EXPERT_COMMANDS },
    { id: 'security-analyst', label: 'Security Analyst', systemPrompt: 'You are a Cybersecurity Analyst. Analyze logs and configurations for potential vulnerabilities, threats, and indicators of compromise (IoCs). Recommend mitigation strategies based on industry standards (NIST/CIS).', askAiCommands: SECURITY_ANALYST_COMMANDS },
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
    sidebarPosition: 'left',
    proactiveInstruction: 'If you need more information to fulfill the user\'s request, proactively suggest terminal commands using code blocks with the "execute" language tag, like this: ```execute\\n[command]\\n```. Do not just wait for user input if the information can be gathered via the terminal.',
    interactiveStabilizationTimeout: 10000,
    activeAiProvider: 'vertexai',
    activePersonaId: 'network-expert',
    enabledProtocols: {
        ssh: true, telnet: true, serial: true,
        wsl: true, cmd: true, powershell: true, 'git-bash': true,
    },
    enabledFeatures: {
        'ai-chat': true, 'log-viewer': true, 'ping-monitor': true,
        'text-editor': true, 'file-explorer': true,
    },
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
            updateSidebarPosition: (v) => set({ sidebarPosition: v }),
            updateProactiveInstruction: (v) => set({ proactiveInstruction: v }),
            updateInteractiveStabilizationTimeout: (v) => set({ interactiveStabilizationTimeout: v }),
            updateActiveAiProvider: (v) => set({ activeAiProvider: v }),
            updateActivePersonaId: (v) => set({ activePersonaId: v }),
            getActiveAskAiCommands: () => {
                const { aiPersonas, activePersonaId } = get();
                const persona = aiPersonas.find(p => p.id === activePersonaId);
                return persona?.askAiCommands ?? aiPersonas[0]?.askAiCommands ?? [];
            },
            updateEnabledProtocol: (protocol, enabled) => set((prev) => ({
                enabledProtocols: { ...prev.enabledProtocols, [protocol]: enabled },
            })),
            updateEnabledFeature: (feature, enabled) => set((prev) => ({
                enabledFeatures: { ...prev.enabledFeatures, [feature]: enabled },
            })),
        }),
        {
            name: 'hotty-settings',
            version: 2,
            // Persist only state fields, not action functions
            partialize: (state) =>
                Object.fromEntries(
                    Object.entries(state).filter(([, v]) => typeof v !== 'function')
                ) as SettingsState,
            // Migrate from v0 (global askAiCommands) to v1 (per-persona askAiCommands)
            migrate: (persisted, version) => {
                if (version === 1) {
                    const old = persisted as Record<string, unknown>;
                    return {
                        ...old,
                        enabledProtocols: INITIAL_STATE.enabledProtocols,
                        enabledFeatures: INITIAL_STATE.enabledFeatures,
                    };
                }
                if (version === 0) {
                    const old = persisted as Record<string, unknown>;
                    const globalCommands = (old.askAiCommands as AskAiCommand[] | undefined) ?? DEFAULT_AI_COMMANDS;
                    const oldPersonas = (old.aiPersonas as Array<{ id: string; label: string; systemPrompt: string; askAiCommands?: AskAiCommand[] }>) ?? DEFAULT_PERSONAS;
                    // Copy global commands into each persona that lacks its own
                    const migratedPersonas: PersonaDefinition[] = oldPersonas.map(p => ({
                        ...p,
                        askAiCommands: p.askAiCommands ?? globalCommands,
                    }));
                    delete old.askAiCommands;
                    return { ...old, aiPersonas: migratedPersonas };
                }
                return persisted;
            },
        }
    )
);
