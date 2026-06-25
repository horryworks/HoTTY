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
        <div className="ai-chat-auth-container">
            <div className="ai-chat-auth-card">
                <div className="ai-chat-auth-icon">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                        <path d="M12 2L14.8 9.2L22 12L14.8 14.8L12 22L9.2 14.8L2 12L9.2 9.2L12 2Z" fill="url(#gemini-gradient-auth)" />
                        <defs>
                            <linearGradient id="gemini-gradient-auth" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                                <stop stopColor="var(--provider-gemini-1)" />
                                <stop offset="0.5" stopColor="var(--provider-gemini-2)" />
                                <stop offset="1" stopColor="var(--provider-gemini-3)" />
                            </linearGradient>
                        </defs>
                    </svg>
                </div>
                <h2>{t('aiChat.auth.geminiTitle')}</h2>
                <div className="ai-chat-auth-form">
                    <label>{t('aiChat.auth.clientId')}</label>
                    <input type="text" value={clientId} onChange={(e) => setClientId(e.target.value)} className="ai-chat-input" />
                    <label>{t('aiChat.auth.clientSecret')}</label>
                    <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} className="ai-chat-input" />
                    <button className="ai-chat-login-btn" onClick={onLogin} disabled={!clientId || !clientSecret || isAuthLoading}>
                        {isAuthLoading ? t('aiChat.auth.connecting') : t('aiChat.auth.signInWithGoogle')}
                    </button>
                    {authError && <div className="ai-chat-auth-error">{authError}</div>}
                </div>
            </div>
        </div>
    );
};
