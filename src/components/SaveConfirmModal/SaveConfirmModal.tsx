import React, { useEffect, useRef } from 'react';
import { useDraggable } from '../../hooks/useDraggable';
import './SaveConfirmModal.css';

export interface SaveConfirmModalProps {
    fileName: string;
    onSave: () => void;
    onDiscard: () => void;
    onCancel: () => void;
}

export const SaveConfirmModal: React.FC<SaveConfirmModalProps> = ({ fileName, onSave, onDiscard, onCancel }) => {
    const { position, onMouseDown: onHeaderMouseDown } = useDraggable();
    const cancelButtonRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (cancelButtonRef.current) {
            cancelButtonRef.current.focus();
        }

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onCancel]);

    return (
        <div className="save-confirm-modal-overlay">
            <div className="save-confirm-modal" style={{ transform: `translate(${position.x}px, ${position.y}px)` }}>
                <h3 onMouseDown={onHeaderMouseDown} style={{ cursor: 'grab', userSelect: 'none' }}>
                    <span>{'\u2753'}</span> Unsaved Changes
                </h3>
                <div className="save-confirm-content">
                    {`"${fileName}" has unsaved changes.\nDo you want to save before closing?`}
                </div>
                <div className="save-confirm-modal-actions">
                    <button
                        className="save-confirm-btn secondary"
                        onClick={onCancel}
                        ref={cancelButtonRef}
                    >
                        Cancel
                    </button>
                    <button
                        className="save-confirm-btn danger"
                        onClick={onDiscard}
                    >
                        Discard
                    </button>
                    <button
                        className="save-confirm-btn primary"
                        onClick={onSave}
                    >
                        Save
                    </button>
                </div>
            </div>
        </div>
    );
};
