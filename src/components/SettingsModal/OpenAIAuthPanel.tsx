import React from 'react';
import { ApiKeyAuthPanel } from './ApiKeyAuthPanel';

interface OpenAIAuthPanelProps {
    apiKey: string;
    setApiKey: (value: string) => void;
    isAuthLoading: boolean;
    onLogin: () => void;
    authError: string | null;
}

/** OpenAI sign-in form — plain API key (never persisted client-side). */
export const OpenAIAuthPanel: React.FC<OpenAIAuthPanelProps> = (props) => (
    <ApiKeyAuthPanel
        titleKey="settings.ai.auth.openaiTitle"
        placeholderKey="settings.ai.auth.openaiKeyPlaceholder"
        connectKey="settings.ai.auth.connectOpenai"
        {...props}
    />
);
