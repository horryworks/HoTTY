import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useModalEscape } from '../../hooks/useModalEscape';
import './PasteConfirmationModal.css';

interface PasteConfirmationModalProps {
  content: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function PasteConfirmationModal({ content, onConfirm, onCancel }: PasteConfirmationModalProps) {
  const { t } = useTranslation();
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmButtonRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onConfirm]);

  useModalEscape(onCancel);

  const hasNewlines = /\r\n|\n|\r/.test(content);

  return (
    <div className="paste-modal-overlay">
      <div className={`paste-modal${hasNewlines ? ' has-newlines' : ''}`}>
        <div className="paste-modal-header">{t('dialogs.paste.header')}</div>
        {hasNewlines && (
          <div className="paste-warning" role="alert">
            {t('dialogs.paste.newlineWarning')}
          </div>
        )}
        <div className="paste-modal-body">
          <pre className="paste-content-preview">
            {content.split(/(\r\n|\n|\r)/).map((part, index) => {
              if (/\r\n|\n|\r/.test(part)) {
                return (
                  <React.Fragment key={index}>
                    <span className="paste-newline-symbol">↵</span>
                    {part}
                  </React.Fragment>
                );
              }
              return <span key={index}>{part}</span>;
            })}
          </pre>
        </div>
        <div className="paste-modal-footer">
          <button className="paste-btn paste-btn-secondary" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button
            className="paste-btn paste-btn-primary"
            onClick={onConfirm}
            ref={confirmButtonRef}
          >
            {t('dialogs.paste.paste')}
          </button>
        </div>
      </div>
    </div>
  );
}
