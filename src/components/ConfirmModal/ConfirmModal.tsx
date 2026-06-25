import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useModalEscape } from '../../hooks/useModalEscape';
import './ConfirmModal.css';

interface ConfirmModalProps {
    title?: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({ title, message, confirmLabel, onConfirm, onCancel }) => {
    const { t } = useTranslation();
    const cancelButtonRef = useRef<HTMLButtonElement>(null);
    const resolvedTitle = title ?? t('dialogs.confirm.title');
    const resolvedConfirmLabel = confirmLabel ?? t('dialogs.confirm.confirmLabel');

    useEffect(() => {
        if (cancelButtonRef.current) {
            cancelButtonRef.current.focus();
        }
    }, []);

    useModalEscape(onCancel);

    return (
        <div className="confirm-modal-overlay">
            <div className="confirm-modal">
                <h3>
                    <span>&#10067;</span> {resolvedTitle}
                </h3>
                <div className="confirm-content">
                    {message}
                </div>
                <div className="confirm-modal-actions">
                    <button
                        className="confirm-btn secondary"
                        onClick={onCancel}
                        ref={cancelButtonRef}
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        className="confirm-btn danger"
                        onClick={onConfirm}
                    >
                        {resolvedConfirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
};
