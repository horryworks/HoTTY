import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../Dialog/Dialog';
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

  const hasNewlines = /\r\n|\n|\r/.test(content);

  return (
    <Dialog
      open
      onClose={onCancel}
      title={t('dialogs.paste.header')}
      width={520}
      // The warning sits between the header and the preview: it is about the
      // content below it, not one more line of that content.
      subheader={
        hasNewlines ? (
          <div className="paste-warning" role="alert">
            {t('dialogs.paste.newlineWarning')}
          </div>
        ) : undefined
      }
      footer={
        <>
          <button className="paste-btn paste-btn-secondary" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button className="paste-btn paste-btn-primary" onClick={onConfirm} ref={confirmButtonRef}>
            {t('dialogs.paste.paste')}
          </button>
        </>
      }
    >
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
    </Dialog>
  );
}
