import React, { useEffect, useRef } from 'react';
import { useModalEscape } from '../../hooks/useModalEscape';
import './SaveConfirmModal.css';

interface SaveConfirmModalProps {
  filename: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export const SaveConfirmModal: React.FC<SaveConfirmModalProps> = ({
  filename,
  onSave,
  onDiscard,
  onCancel,
}) => {
  const saveButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    saveButtonRef.current?.focus();
  }, []);

  useModalEscape(onCancel);

  return (
    <div className="save-confirm-modal-overlay" role="dialog" aria-modal="true">
      <div className="save-confirm-modal">
        <h3>
          <span>&#9888;</span> Unsaved changes
        </h3>
        <div className="save-confirm-content">
          <span className="save-confirm-filename">{filename}</span> has unsaved
          changes. Do you want to save before closing?
        </div>
        <div className="save-confirm-modal-actions">
          <button
            className="save-confirm-btn secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="save-confirm-btn danger"
            onClick={onDiscard}
          >
            Don&apos;t save
          </button>
          <button
            className="save-confirm-btn primary"
            onClick={onSave}
            ref={saveButtonRef}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};
