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

/** Vertex AI sign-in form — project/region plus ADC or a service-account key. */
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
        <div className="settings-group settings-ai-auth-form">
            <h4 className="settings-ai-auth-title">{t('settings.ai.auth.vertexTitle')}</h4>
            <label>{t('settings.ai.auth.gcpProjectId')}</label>
            <input
                type="text"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                placeholder={t('settings.ai.auth.gcpProjectIdPlaceholder')}
            />
            <label>{t('settings.ai.auth.location')}</label>
            <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder={t('settings.ai.auth.locationPlaceholder')}
            />
            <label>{t('settings.ai.auth.authMethod')}</label>
            <select
                value={authType}
                onChange={(e) => setAuthType(e.target.value as 'adc' | 'service_account')}
            >
                <option value="adc">{t('settings.ai.auth.authMethodAdc')}</option>
                <option value="service_account">{t('settings.ai.auth.authMethodServiceAccount')}</option>
            </select>
            {authType === 'service_account' && (
                <>
                    <label>{t('settings.ai.auth.serviceAccountKeyFile')}</label>
                    <div className="settings-ai-auth-keyfile-row">
                        <input
                            type="text"
                            value={keyFilePath}
                            onChange={(e) => setKeyFilePath(e.target.value)}
                            placeholder={t('settings.ai.auth.serviceAccountKeyFilePlaceholder')}
                            readOnly
                        />
                        <button className="settings-button" onClick={handleBrowse}>
                            {t('settings.ai.auth.browse')}
                        </button>
                    </div>
                </>
            )}
            <button
                className="settings-ai-auth-signin"
                onClick={onLogin}
                disabled={isLoginDisabled}
            >
                {isAuthLoading ? t('settings.ai.auth.connecting') : t('settings.ai.auth.connectVertex')}
            </button>
            {authError && <div className="settings-ai-auth-error">{authError}</div>}
        </div>
    );
};
