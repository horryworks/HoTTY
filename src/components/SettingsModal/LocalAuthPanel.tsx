import React from 'react';
import { useTranslation } from 'react-i18next';

interface LocalAuthPanelProps {
    baseUrl: string;
    setBaseUrl: (value: string) => void;
    apiKey: string;
    setApiKey: (value: string) => void;
    isAuthLoading: boolean;
    onLogin: () => void;
    authError: string | null;
}

/**
 * Connect form for a local / LAN AI server that speaks the OpenAI API (Ollama,
 * LM Studio, llama.cpp, vLLM, llama-swap). The key is optional and never
 * persisted client-side; the backend seals it together with the address.
 */
export const LocalAuthPanel: React.FC<LocalAuthPanelProps> = ({
    baseUrl,
    setBaseUrl,
    apiKey,
    setApiKey,
    isAuthLoading,
    onLogin,
    authError,
}) => {
    const { t } = useTranslation();
    return (
        <div className="settings-group settings-ai-auth-form">
            <h4 className="settings-ai-auth-title">{t('settings.ai.auth.localTitle')}</h4>
            <label htmlFor="local-ai-url">{t('settings.ai.auth.localServerUrl')}</label>
            <input
                id="local-ai-url"
                type="text"
                inputMode="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="http://localhost:11434"
                autoComplete="off"
                spellCheck={false}
            />
            <label htmlFor="local-ai-key">{t('settings.ai.auth.apiKeyOptional')}</label>
            <input
                id="local-ai-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
            />
            <button
                className="settings-ai-auth-signin"
                onClick={onLogin}
                disabled={!baseUrl.trim() || isAuthLoading}
            >
                {isAuthLoading ? t('settings.ai.auth.connecting') : t('settings.ai.auth.connectLocal')}
            </button>
            {authError && <div className="settings-ai-auth-error">{authError}</div>}
        </div>
    );
};
