import React from 'react';

const GeminiIcon: React.FC<{ size?: number; className?: string }> = ({ size = 24, className = "" }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className={className}
        style={{ flexShrink: 0 }}
    >
        <path d="M12 2L14.8 9.2L22 12L14.8 14.8L12 22L9.2 14.8L2L12L9.2 9.2L12 2Z" fill="url(#gemini-gradient-auth)" />
        <defs>
            <linearGradient id="gemini-gradient-auth" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                <stop stopColor="#4E77FF" />
                <stop offset="0.5" stopColor="#A87FF4" />
                <stop offset="1" stopColor="#FF76AB" />
            </linearGradient>
        </defs>
    </svg>
);

interface AuthenticationPanelProps {
    clientId: string;
    setClientId: (value: string) => void;
    clientSecret: string;
    setClientSecret: (value: string) => void;
    isAuthLoading: boolean;
    onLogin: () => void;
    authError: string | null;
    fontSize?: number;
    terminalBackground?: string;
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
    return (
        <div className="ai-chat-auth-container">
            <div className="ai-chat-auth-card">
                <div className="ai-chat-auth-icon"><GeminiIcon size={64} /></div>
                <h2>Connect to Gemini</h2>
                <div className="ai-chat-auth-form">
                    <label>Client ID</label>
                    <input type="text" value={clientId} onChange={(e) => setClientId(e.target.value)} className="ai-chat-input" />
                    <label>Client Secret</label>
                    <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} className="ai-chat-input" />
                    <button className="ai-chat-login-btn" onClick={onLogin} disabled={!clientId || !clientSecret || isAuthLoading}>
                        {isAuthLoading ? 'Connecting...' : 'Sign in with Google'}
                    </button>
                    {authError && <div className="ai-chat-auth-error">{authError}</div>}
                </div>
            </div>
        </div>
    );
};
