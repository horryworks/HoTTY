import React, { useEffect, useRef } from 'react';
import './ErrorModal.css';

interface ErrorModalProps {
    message: string;
    onClose: () => void;
}

export const ErrorModal: React.FC<ErrorModalProps> = ({ message, onClose }) => {
    const closeButtonRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        // Auto-focus the close button on mount
        if (closeButtonRef.current) {
            closeButtonRef.current.focus();
        }

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault();
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    return (
        <div className="error-modal-overlay">
            <div className="error-modal">
                <h3>
                    <span>⚠️</span> Session Error
                </h3>
                <div className="error-content">
                    {message}
                </div>
                <div className="error-modal-actions">
                    <button
                        className="error-btn primary"
                        onClick={onClose}
                        ref={closeButtonRef}
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};
