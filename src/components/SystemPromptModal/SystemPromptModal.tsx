import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
      aria-label={t('dialogs.systemPrompt.ariaLabel')}
      onClick={handleOverlayClick}
    >
      <div className="system-prompt-modal">
        <div className="system-prompt-modal-header">
          <span className="system-prompt-modal-title">
            {t('dialogs.systemPrompt.title', { persona: personaLabel })}
          </span>
          <button
            type="button"
            className="system-prompt-modal-close-x"
            onClick={onClose}
            aria-label={t('common.close')}
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
            {copied ? t('common.copied') : t('common.copy')}
          </button>
          <button
            type="button"
            className="system-prompt-btn primary"
            onClick={onClose}
            ref={closeButtonRef}
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
};
