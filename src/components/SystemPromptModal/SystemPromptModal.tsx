import React, { useEffect, useRef, useState } from 'react';
import { useModalEscape } from '../../hooks/useModalEscape';
import './SystemPromptModal.css';

interface SystemPromptModalProps {
  personaLabel: string;
  systemInstruction: string;
  onClose: () => void;
}

export const SystemPromptModal: React.FC<SystemPromptModalProps> = ({
  personaLabel,
  systemInstruction,
  onClose,
}) => {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useModalEscape(onClose);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(systemInstruction);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* silent — clipboard permission denied or unsupported */
    }
  };

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="system-prompt-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="System prompt viewer"
      onClick={handleOverlayClick}
    >
      <div className="system-prompt-modal">
        <div className="system-prompt-modal-header">
          <span className="system-prompt-modal-title">
            System Prompt — {personaLabel}
          </span>
          <button
            type="button"
            className="system-prompt-modal-close-x"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>
        <div className="system-prompt-modal-body">
          <pre className="system-prompt-body">{systemInstruction}</pre>
        </div>
        <div className="system-prompt-modal-footer">
          <button
            type="button"
            className="system-prompt-btn secondary"
            onClick={handleCopy}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            className="system-prompt-btn primary"
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
