import React from 'react';
import { useTranslation } from 'react-i18next';

interface ApiKeyAuthPanelProps {
    /** i18n key for the form heading (e.g. 'settings.ai.auth.openaiTitle'). */
    titleKey: string;
    /** i18n key for the API-key input placeholder. */
    placeholderKey: string;
    /** i18n key for the sign-in button label (idle state). */
    connectKey: string;
    apiKey: string;
    setApiKey: (value: string) => void;
    isAuthLoading: boolean;
    onLogin: () => void;
    authError: string | null;
}

/**
 * Single-API-key sign-in form shared by the OpenAI and Anthropic panels — the
 * only differences between those providers are three i18n keys. The key is
 * never persisted client-side (the backend stores it DPAPI-encrypted).
 */
export const ApiKeyAuthPanel: React.FC<ApiKeyAuthPanelProps> = ({
    titleKey,
    placeholderKey,
    connectKey,
    apiKey,
    setApiKey,
    isAuthLoading,
    onLogin,
    authError,
}) => {
    const { t } = useTranslation();
    return (
        <div className="settings-group settings-ai-auth-form">
            <h4 className="settings-ai-auth-title">{t(titleKey)}</h4>
            <label>{t('settings.ai.auth.apiKey')}</label>
            <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={t(placeholderKey)}
                autoComplete="off"
            />
            <button
                className="settings-ai-auth-signin"
                onClick={onLogin}
                disabled={!apiKey || isAuthLoading}
            >
                {isAuthLoading ? t('settings.ai.auth.connecting') : t(connectKey)}
            </button>
            {authError && <div className="settings-ai-auth-error">{authError}</div>}
        </div>
    );
};
