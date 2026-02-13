import React, { useEffect } from 'react';
import './PasteConfirmationModal.css';

interface PasteConfirmationModalProps {
    content: string;
    onConfirm: () => void;
    onCancel: () => void;
}

export const PasteConfirmationModal: React.FC<PasteConfirmationModalProps> = ({ content, onConfirm, onCancel }) => {
    const confirmButtonRef = React.useRef<HTMLButtonElement>(null);

    useEffect(() => {
        // Auto-focus the confirm button on mount
        if (confirmButtonRef.current) {
            confirmButtonRef.current.focus();
        }

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                onConfirm();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onConfirm, onCancel]);

    const hasNewlines = content.match(/(\r\n|\n|\r)/);

    return (
        <div className="paste-modal-overlay">
            <div className={`paste-modal ${hasNewlines ? 'has-newlines' : ''}`}>
                <h3>Paste Confirmation</h3>
                {hasNewlines && (
                    <div className="paste-warning">
                        ⚠️ Warning: Contains newline characters
                    </div>
                )}
                <div className="paste-content-preview">
                    <pre>
                        {content.split(/(\r\n|\n|\r)/).map((part, index) => {
                            if (part.match(/\r\n|\n|\r/)) {
                                return (
                                    <React.Fragment key={index}>
                                        <span className="newline-symbol">↵</span>
                                        {part}
                                    </React.Fragment>
                                );
                            }
                            return <span key={index}>{part}</span>;
                        })}
                    </pre>
                </div>
                <div className="paste-modal-actions">
                    <button className="paste-btn cancel" onClick={onCancel}>
                        Cancel
                    </button>
                    <button
                        className="paste-btn confirm"
                        onClick={onConfirm}
                        ref={confirmButtonRef}
                    >
                        Paste
                    </button>
                </div>
            </div>
        </div>
    );
};
