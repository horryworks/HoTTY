import React from 'react';

interface OpenAIAuthPanelProps {
    apiKey: string;
    setApiKey: (value: string) => void;
    isAuthLoading: boolean;
    onLogin: () => void;
    authError: string | null;
}

export const OpenAIAuthPanel: React.FC<OpenAIAuthPanelProps> = ({
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
                        <rect width="24" height="24" rx="4" fill="#10A37F" />
                        <path d="M11.5 6.5C9.01 6.5 7 8.51 7 11c0 1.43.65 2.71 1.67 3.57L8 17.5h8l-.67-2.93A4.49 4.49 0 0 0 16 11c0-2.49-2.01-4.5-4.5-4.5z" fill="white" />
                        <rect x="9" y="17" width="5" height="1.5" rx="0.75" fill="white" />
                    </svg>
                </div>
                <h2>Connect to OpenAI</h2>
                <div className="ai-chat-auth-form">
                    <label>API Key</label>
                    <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        className="ai-chat-input"
                        placeholder="sk-..."
                        autoComplete="off"
                    />
                    <button
                        className="ai-chat-login-btn"
                        onClick={onLogin}
                        disabled={!apiKey || isAuthLoading}
                    >
                        {isAuthLoading ? 'Connecting...' : 'Connect to OpenAI'}
                    </button>
                    {authError && <div className="ai-chat-auth-error">{authError}</div>}
                </div>
            </div>
        </div>
    );
};
