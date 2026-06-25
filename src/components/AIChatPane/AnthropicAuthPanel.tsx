import React from 'react';
import { useTranslation } from 'react-i18next';

interface AnthropicAuthPanelProps {
    apiKey: string;
    setApiKey: (value: string) => void;
    isAuthLoading: boolean;
    onLogin: () => void;
    authError: string | null;
}

export const AnthropicAuthPanel: React.FC<AnthropicAuthPanelProps> = ({
    apiKey,
    setApiKey,
    isAuthLoading,
    onLogin,
    authError,
}) => {
    const { t } = useTranslation();
    return (
        <div className="ai-chat-auth-container">
            <div className="ai-chat-auth-card">
                <div className="ai-chat-auth-icon">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                        <rect width="24" height="24" rx="4" fill="var(--provider-anthropic)" />
                        <text x="12" y="16" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold" fontFamily="serif">A</text>
                    </svg>
                </div>
                <h2>{t('aiChat.auth.anthropicTitle')}</h2>
                <div className="ai-chat-auth-form">
                    <label>{t('aiChat.auth.apiKey')}</label>
                    <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        className="ai-chat-input"
                        placeholder={t('aiChat.auth.anthropicKeyPlaceholder')}
                        autoComplete="off"
                    />
                    <button
                        className="ai-chat-login-btn"
                        onClick={onLogin}
                        disabled={!apiKey || isAuthLoading}
                    >
                        {isAuthLoading ? t('aiChat.auth.connecting') : t('aiChat.auth.connectAnthropic')}
                    </button>
                    {authError && <div className="ai-chat-auth-error">{authError}</div>}
                </div>
            </div>
        </div>
    );
};
