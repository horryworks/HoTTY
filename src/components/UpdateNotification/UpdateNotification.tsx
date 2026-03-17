import React from 'react';
import * as electronService from '../../services/electronService';
import './UpdateNotification.css';

interface UpdateNotificationProps {
    version: string;
    releaseUrl: string;
    onDismiss: () => void;
    onSkip: () => void;
    onNeverNotify: () => void;
}

export const UpdateNotification: React.FC<UpdateNotificationProps> = ({ version, releaseUrl, onDismiss, onSkip, onNeverNotify }) => {
    const handleDownload = () => {
        electronService.openExternal(releaseUrl);
        onDismiss();
    };

    return (
        <div className="update-notification">
            <span className="update-notification-icon">&#8593;</span>
            <span className="update-notification-text">
                A new version <strong>v{version}</strong> is available
            </span>
            <button className="update-notification-download" onClick={handleDownload}>
                Download
            </button>
            <button className="update-notification-skip" onClick={onSkip}>
                Skip this version
            </button>
            <button className="update-notification-skip" onClick={onNeverNotify}>
                Never Notify
            </button>
            <button className="update-notification-dismiss" onClick={onDismiss} title="Close">
                &#10005;
            </button>
        </div>
    );
};
