import React from 'react';
import { useTranslation } from 'react-i18next';

interface AuthenticationPanelProps {
    clientId: string;
    setClientId: (value: string) => void;
    clientSecret: string;
    setClientSecret: (value: string) => void;
    isAuthLoading: boolean;
    onLogin: () => void;
    authError: string | null;
}

/** Gemini (Google AI Studio) sign-in form — OAuth client ID/secret. */
export const AuthenticationPanel: React.FC<AuthenticationPanelProps> = ({
    clientId,
    setClientId,
    clientSecret,
    setClientSecret,
    isAuthLoading,
    onLogin,
    authError,
}) => {
    const { t } = useTranslation();
    return (
        <div className="settings-group settings-ai-auth-form">
            <h4 className="settings-ai-auth-title">{t('settings.ai.auth.geminiTitle')}</h4>
            <label>{t('settings.ai.auth.clientId')}</label>
            <input type="text" value={clientId} onChange={(e) => setClientId(e.target.value)} />
            <label>{t('settings.ai.auth.clientSecret')}</label>
            <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="off" />
            <button
                className="settings-ai-auth-signin"
                onClick={onLogin}
                disabled={!clientId || !clientSecret || isAuthLoading}
            >
                {isAuthLoading ? t('settings.ai.auth.connecting') : t('settings.ai.auth.signInWithGoogle')}
            </button>
            {authError && <div className="settings-ai-auth-error">{authError}</div>}
        </div>
    );
};
