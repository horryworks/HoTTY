import React from 'react';
import * as electronService from '../../services/electronService';
import './UpdateNotification.css';

interface UpdateNotificationProps {
    version: string;
    releaseUrl: string;
    onDismiss: () => void;
}

export const UpdateNotification: React.FC<UpdateNotificationProps> = ({ version, releaseUrl, onDismiss }) => {
    const handleDownload = () => {
        electronService.openExternal(releaseUrl);
        onDismiss();
    };

    return (
        <div className="update-notification">
            <span className="update-notification-icon">&#8593;</span>
            <span className="update-notification-text">
                新しいバージョン <strong>v{version}</strong> が公開されています
            </span>
            <button className="update-notification-download" onClick={handleDownload}>
                ダウンロード
            </button>
            <button className="update-notification-dismiss" onClick={onDismiss} title="閉じる">
                &#10005;
            </button>
        </div>
    );
};
