import React, { useEffect, useRef } from 'react';
import { useDraggable } from '../../hooks/useDraggable';
import './MessageModal.css';

export interface MessageModalProps {
    type: 'error' | 'success' | 'info';
    title?: string;
    message: string;
    onClose: () => void;
}

export const MessageModal: React.FC<MessageModalProps> = ({ type, title, message, onClose }) => {
    const { position, onMouseDown: onHeaderMouseDown } = useDraggable();
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

    const getIcon = () => {
        switch (type) {
            case 'error': return '⚠️';
            case 'success': return '✅';
            case 'info': return 'ℹ️';
            default: return '💬';
        }
    };

    const getDefaultTitle = () => {
        switch (type) {
            case 'error': return 'Error';
            case 'success': return 'Success';
            case 'info': return 'Information';
            default: return 'Message';
        }
    };

    return (
        <div className="message-modal-overlay">
            <div className={`message-modal ${type}`} style={{ transform: `translate(${position.x}px, ${position.y}px)` }}>
                <h3 onMouseDown={onHeaderMouseDown} style={{ cursor: 'grab', userSelect: 'none' }}>
                    <span>{getIcon()}</span> {title || getDefaultTitle()}
                </h3>
                <div className="message-content">
                    {message}
                </div>
                <div className="message-modal-actions">
                    <button
                        className={`message-btn primary ${type}`}
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
