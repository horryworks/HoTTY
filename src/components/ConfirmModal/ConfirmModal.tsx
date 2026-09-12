import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../Dialog/Dialog';
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
        // Cancel takes focus, not the confirm button: this dialog guards
        // destructive actions, so a reflexive Enter must not be the one that
        // goes through with it.
        cancelButtonRef.current?.focus();
    }, []);

    return (
        <Dialog
            open
            onClose={onCancel}
            title={<><span aria-hidden="true">{'❓'}</span> {resolvedTitle}</>}
            tone="warning"
            width={400}
            // Kept so callers and tests can scope to this dialog: it is opened
            // from nine places, often over another dialog, and "the confirm
            // one" has to be nameable.
            className="confirm-modal"
            // No close button: the two footer buttons are the answer, and a third
            // way out would leave it ambiguous which one an × meant.
            showClose={false}
            footer={
                <>
                    <button className="confirm-btn secondary" onClick={onCancel} ref={cancelButtonRef}>
                        {t('common.cancel')}
                    </button>
                    <button className="confirm-btn danger" onClick={onConfirm}>
                        {resolvedConfirmLabel}
                    </button>
                </>
            }
        >
            <div className="confirm-content">{message}</div>
        </Dialog>
    );
};
