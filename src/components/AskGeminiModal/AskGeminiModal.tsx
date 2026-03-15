import React, { useState, useEffect, useRef } from 'react';
import './AskGeminiModal.css';

interface AskGeminiModalProps {
    isOpen: boolean;
    selection: string;
    onClose: () => void;
    onSubmit: (prompt: string, selection: string) => void;
}

export const AskGeminiModal: React.FC<AskGeminiModalProps> = ({
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
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        }
    };

    return (
        <div className="ask-gemini-modal-overlay" onClick={onClose}>
            <div className="ask-gemini-modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="ask-gemini-modal-header">
                    <h2>Ask AI</h2>
                    <button className="ask-gemini-modal-close-btn" onClick={onClose} title="Close">×</button>
                </div>

                <div className="ask-gemini-modal-body">
                    <div className="ask-gemini-modal-section">
                        <label>Your Question:</label>
                        <textarea
                            ref={textareaRef}
                            className="ask-gemini-modal-prompt-input"
                            placeholder="What would you like to ask about the selection? (Ctrl+Enter to Ask)"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            onKeyDown={handleKeyDown}
                            rows={4}
                        />
                    </div>

                    <div className="ask-gemini-modal-section">
                        <label>Selected Text:</label>
                        <textarea
                            className="ask-gemini-modal-selection-preview"
                            value={selection}
                            readOnly
                            rows={6}
                        />
                    </div>
                </div>

                <div className="ask-gemini-modal-footer">
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
