import React from 'react';
import { ApiKeyAuthPanel } from './ApiKeyAuthPanel';

interface AnthropicAuthPanelProps {
    apiKey: string;
    setApiKey: (value: string) => void;
    isAuthLoading: boolean;
    onLogin: () => void;
    authError: string | null;
}

/** Anthropic sign-in form — plain API key (never persisted client-side). */
export const AnthropicAuthPanel: React.FC<AnthropicAuthPanelProps> = (props) => (
    <ApiKeyAuthPanel
        titleKey="settings.ai.auth.anthropicTitle"
        placeholderKey="settings.ai.auth.anthropicKeyPlaceholder"
        connectKey="settings.ai.auth.connectAnthropic"
        {...props}
    />
);
