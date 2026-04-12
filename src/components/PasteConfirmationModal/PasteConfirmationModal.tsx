import React, { useEffect, useRef } from 'react';
import './PasteConfirmationModal.css';

interface PasteConfirmationModalProps {
  content: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function PasteConfirmationModal({ content, onConfirm, onCancel }: PasteConfirmationModalProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmButtonRef.current?.focus();
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

  const hasNewlines = /\r\n|\n|\r/.test(content);

  return (
    <div className="paste-modal-overlay">
      <div className={`paste-modal${hasNewlines ? ' has-newlines' : ''}`}>
        <div className="paste-modal-header">Paste Confirmation</div>
        {hasNewlines && (
          <div className="paste-warning" role="alert">
            ⚠️ Warning: Contains newline characters
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
            Cancel
          </button>
          <button
            className="paste-btn paste-btn-primary"
            onClick={onConfirm}
            ref={confirmButtonRef}
          >
            Paste
          </button>
        </div>
      </div>
    </div>
  );
}
