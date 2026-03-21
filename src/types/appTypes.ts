export interface AskAiCommand {
    id: string;
    label: string;
    promptTemplate: string;
}

export interface PromptPattern {
    id: string;
    name: string;
    pattern: string;
    enabled: boolean;
}

export interface PersonaDefinition {
    id: string;
    label: string;
    systemPrompt: string;
    askAiCommands: AskAiCommand[];
}
