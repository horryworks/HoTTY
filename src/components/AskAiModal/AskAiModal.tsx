import React, { useState, useEffect, useRef } from 'react';
import './AskAiModal.css';

interface AskAiModalProps {
    isOpen: boolean;
    selection: string;
    onClose: () => void;
    onSubmit: (prompt: string, selection: string) => void;
}

export const AskAiModal: React.FC<AskAiModalProps> = ({
    isOpen,
    selection,
    onClose,
    onSubmit
}) => {
    const [prompt, setPrompt] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (isOpen) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setPrompt('');
            // Focus textarea when modal opens
            setTimeout(() => {
                if (textareaRef.current) {
                    textareaRef.current.focus();
                }
            }, 100);
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const handleSubmit = () => {
        if (!prompt.trim()) return;
        onSubmit(prompt, selection);
        onClose();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            handleSubmit();
        }
    };

    return (
        <div className="ask-ai-modal-overlay">
            <div className="ask-ai-modal-content">
                <div className="ask-ai-modal-header">
                    <h2>Ask AI</h2>
                    <button className="ask-ai-modal-close-btn" onClick={onClose} title="Close">×</button>
                </div>

                <div className="ask-ai-modal-body">
                    <div className="ask-ai-modal-section">
                        <label>Your Question:</label>
                        <textarea
                            ref={textareaRef}
                            className="ask-ai-modal-prompt-input"
                            placeholder="What would you like to ask about the selection? (Ctrl+Enter to Ask)"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            onKeyDown={handleKeyDown}
                            rows={4}
                        />
                    </div>

                    <div className="ask-ai-modal-section">
                        <label>Selected Text:</label>
                        <textarea
                            className="ask-ai-modal-selection-preview"
                            value={selection}
                            readOnly
                            rows={6}
                        />
                    </div>
                </div>

                <div className="ask-ai-modal-footer">
                    <button className="btn-secondary" onClick={onClose}>Cancel</button>
                    <button
                        className="btn-primary"
                        onClick={handleSubmit}
                        disabled={!prompt.trim()}
                    >
                        Ask
                    </button>
                </div>
            </div>
        </div>
    );
};
