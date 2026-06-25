import React, { useEffect, useRef } from 'react';
import { useTranslation, Trans } from 'react-i18next';
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
  const { t } = useTranslation();
  const saveButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    saveButtonRef.current?.focus();
  }, []);

  useModalEscape(onCancel);

  return (
    <div className="save-confirm-modal-overlay" role="dialog" aria-modal="true">
      <div className="save-confirm-modal">
        <h3>
          <span>&#9888;</span> {t('dialogs.saveConfirm.heading')}
        </h3>
        <div className="save-confirm-content">
          <Trans
            i18nKey="dialogs.saveConfirm.body"
            values={{ filename }}
            components={[<span className="save-confirm-filename" key="filename" />]}
          />
        </div>
        <div className="save-confirm-modal-actions">
          <button
            className="save-confirm-btn secondary"
            onClick={onCancel}
          >
            {t('common.cancel')}
          </button>
          <button
            className="save-confirm-btn danger"
            onClick={onDiscard}
          >
            {t('dialogs.saveConfirm.dontSave')}
          </button>
          <button
            className="save-confirm-btn primary"
            onClick={onSave}
            ref={saveButtonRef}
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
};
