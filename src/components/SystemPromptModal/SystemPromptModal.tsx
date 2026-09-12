import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../Dialog/Dialog';
import './SystemPromptModal.css';

interface SystemPromptModalProps {
  personaLabel: string;
  systemInstruction: string;
  onClose: () => void;
}

/**
 * A wall of prompt text, so it opens large and can be pulled larger still.
 * The geometry hook owns the bounds; the stylesheet sets no size.
 */
const DEFAULT_SIZE = { width: 640, height: 560 };
const MIN_SIZE = { width: 420, height: 300 };

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


  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(systemInstruction);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* silent — clipboard permission denied or unsupported */
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('dialogs.systemPrompt.title', { persona: personaLabel })}
      geometry={{ persistKey: 'systemPrompt', defaultSize: DEFAULT_SIZE, minSize: MIN_SIZE }}
      footer={
        <>
          <button type="button" className="system-prompt-btn secondary" onClick={handleCopy}>
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
        </>
      }
    >
      <pre className="system-prompt-body">{systemInstruction}</pre>
    </Dialog>
  );
};
