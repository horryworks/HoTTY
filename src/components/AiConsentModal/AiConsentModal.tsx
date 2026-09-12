import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../Dialog/Dialog';
import './AiConsentModal.css';

interface AiConsentModalProps {
  /** User accepted the disclosure — persist consent and proceed with the send. */
  onAccept: () => void;
  /** User declined (button or Escape) — abort the pending AI send. */
  onCancel: () => void;
}

/**
 * One-time disclosure shown before any terminal data is first sent to a
 * third-party AI provider (chat send, Ask AI, or enabling Watch Mode). Gated by
 * the persisted `aiDataConsentAccepted` flag in the settings store.
 */
export function AiConsentModal({ onAccept, onCancel }: AiConsentModalProps) {
  const { t } = useTranslation();
  const acceptButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    acceptButtonRef.current?.focus();
  }, []);

  return (
    <Dialog
      open
      // Escape and the close button decline. Consent has to be given, never
      // inferred from a dismissal.
      onClose={onCancel}
      title={t('aiChat.consent.title')}
      width={520}
      showClose={false}
      footer={
        <>
          <button className="ai-consent-btn ai-consent-btn-secondary" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button
            className="ai-consent-btn ai-consent-btn-primary"
            ref={acceptButtonRef}
            onClick={onAccept}
          >
            {t('aiChat.consent.accept')}
          </button>
        </>
      }
    >
          <p className="ai-consent-intro">{t('aiChat.consent.intro')}</p>
          <ul className="ai-consent-list">
            <li>{t('aiChat.consent.bulletWhat')}</li>
            <li>{t('aiChat.consent.bulletWhen')}</li>
            <li className="ai-consent-warn">{t('aiChat.consent.bulletRedaction')}</li>
          </ul>
          <p className="ai-consent-footnote">{t('aiChat.consent.footnote')}</p>
    </Dialog>
  );
}
