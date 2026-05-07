import React, { useEffect, useRef } from 'react';
import { useModalEscape } from '../../hooks/useModalEscape';
import './ConfirmModal.css';

interface ConfirmModalProps {
    title?: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({ title = 'Confirm', message, confirmLabel = 'Delete', onConfirm, onCancel }) => {
    const cancelButtonRef = useRef<HTMLButtonElement>(null);

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
                    <span>&#10067;</span> {title}
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
                        Cancel
                    </button>
                    <button
                        className="confirm-btn danger"
                        onClick={onConfirm}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
};
