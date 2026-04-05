export type ProtocolId = 'ssh' | 'telnet' | 'serial' | 'wsl' | 'cmd' | 'powershell' | 'git-bash';
export type FeatureId = 'ai-chat' | 'log-viewer' | 'ping-monitor' | 'text-editor' | 'file-explorer';

export interface AskAiCommand {
    id: string;
    label: string;
    promptTemplate: string;
}

export interface PromptPattern {
    id: string;
    name: string;
    pattern: string;
}

export interface PersonaDefinition {
    id: string;
    label: string;
    systemPrompt: string;
    askAiCommands: AskAiCommand[];
}

export type CommandExecutionMode = 'ask-before-execute' | 'auto-execute-safe';
