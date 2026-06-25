import React from 'react';
import { useTranslation } from 'react-i18next';
import { tauriService } from '../../services/tauriService';

interface VertexAIAuthPanelProps {
    projectId: string;
    setProjectId: (value: string) => void;
    location: string;
    setLocation: (value: string) => void;
    authType: 'adc' | 'service_account';
    setAuthType: (value: 'adc' | 'service_account') => void;
    keyFilePath: string;
    setKeyFilePath: (value: string) => void;
    isAuthLoading: boolean;
    onLogin: () => void;
    authError: string | null;
}

export const VertexAIAuthPanel: React.FC<VertexAIAuthPanelProps> = ({
    projectId,
    setProjectId,
    location,
    setLocation,
    authType,
    setAuthType,
    keyFilePath,
    setKeyFilePath,
    isAuthLoading,
    onLogin,
    authError,
}) => {
    const { t } = useTranslation();
    const handleBrowse = async () => {
        const selectedPath = await tauriService.selectServiceAccountKeyFile();
        if (selectedPath) {
            setKeyFilePath(selectedPath);
        }
    };

    const isLoginDisabled = !projectId || !location || isAuthLoading ||
        (authType === 'service_account' && !keyFilePath);

    return (
        <div className="ai-chat-auth-container">
            <div className="ai-chat-auth-card">
                <div className="ai-chat-auth-icon">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" fill="var(--provider-vertex-ai)" />
                    </svg>
                </div>
                <h2>{t('aiChat.auth.vertexTitle')}</h2>
                <div className="ai-chat-auth-form">
                    <label>{t('aiChat.auth.gcpProjectId')}</label>
                    <input
                        type="text"
                        value={projectId}
                        onChange={(e) => setProjectId(e.target.value)}
                        className="ai-chat-input"
                        placeholder={t('aiChat.auth.gcpProjectIdPlaceholder')}
                    />
                    <label>{t('aiChat.auth.location')}</label>
                    <input
                        type="text"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        className="ai-chat-input"
                        placeholder={t('aiChat.auth.locationPlaceholder')}
                    />
                    <label>{t('aiChat.auth.authMethod')}</label>
                    <select
                        value={authType}
                        onChange={(e) => setAuthType(e.target.value as 'adc' | 'service_account')}
                        className="ai-chat-input"
                        style={{ cursor: 'pointer' }}
                    >
                        <option value="adc">{t('aiChat.auth.authMethodAdc')}</option>
                        <option value="service_account">{t('aiChat.auth.authMethodServiceAccount')}</option>
                    </select>
                    {authType === 'service_account' && (
                        <>
                            <label>{t('aiChat.auth.serviceAccountKeyFile')}</label>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <input
                                    type="text"
                                    value={keyFilePath}
                                    onChange={(e) => setKeyFilePath(e.target.value)}
                                    className="ai-chat-input"
                                    placeholder={t('aiChat.auth.serviceAccountKeyFilePlaceholder')}
                                    style={{ flex: 1 }}
                                    readOnly
                                />
                                <button
                                    onClick={handleBrowse}
                                    style={{
                                        padding: '8px 12px',
                                        cursor: 'pointer',
                                        backgroundColor: 'var(--bg-secondary)',
                                        border: '1px solid var(--border-color)',
                                        color: 'var(--text-primary)',
                                        borderRadius: '4px',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    {t('aiChat.auth.browse')}
                                </button>
                            </div>
                        </>
                    )}
                    <button
                        className="ai-chat-login-btn"
                        onClick={onLogin}
                        disabled={isLoginDisabled}
                    >
                        {isAuthLoading ? t('aiChat.auth.connecting') : t('aiChat.auth.connectVertex')}
                    </button>
                    {authError && <div className="ai-chat-auth-error">{authError}</div>}
                </div>
            </div>
        </div>
    );
};
