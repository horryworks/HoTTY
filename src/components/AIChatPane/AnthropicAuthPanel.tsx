import React from 'react';

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
    return (
        <div className="ai-chat-auth-container">
            <div className="ai-chat-auth-card">
                <div className="ai-chat-auth-icon">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                        <rect width="24" height="24" rx="4" fill="#D97757" />
                        <text x="12" y="16" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold" fontFamily="serif">A</text>
                    </svg>
                </div>
                <h2>Connect to Anthropic</h2>
                <div className="ai-chat-auth-form">
                    <label>API Key</label>
                    <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        className="ai-chat-input"
                        placeholder="sk-ant-..."
                        autoComplete="off"
                    />
                    <button
                        className="ai-chat-login-btn"
                        onClick={onLogin}
                        disabled={!apiKey || isAuthLoading}
                    >
                        {isAuthLoading ? 'Connecting...' : 'Connect to Anthropic'}
                    </button>
                    {authError && <div className="ai-chat-auth-error">{authError}</div>}
                </div>
            </div>
        </div>
    );
};
