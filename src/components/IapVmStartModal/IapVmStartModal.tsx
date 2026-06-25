import { useEffect, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { tauriService } from '../../services/tauriService';
import { logError } from '../../utils/logger';
import type { IapVmStartPromptPayload } from '../../types/appTypes';
import './IapVmStartModal.css';

export function IapVmStartModal() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState<IapVmStartPromptPayload | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    tauriService
      .onIapVmStartPrompt((p) => setPrompt(p))
      .then((fn) => {
        unlisten = fn;
      })
      .catch((e) => {
        logError('IAP', 'Failed to listen for VM-start prompts', e);
      });
    return () => {
      unlisten?.();
    };
  }, []);

  if (!prompt) return null;

  const respond = async (approved: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await tauriService.gceIapRespondVmStart(prompt.sessionId, approved);
    } catch (e) {
      logError('IAP', 'Failed to respond to VM-start prompt', e);
    } finally {
      setBusy(false);
      setPrompt(null);
    }
  };

  return (
    <div className="iap-vm-start-overlay">
      <div className="iap-vm-start-modal">
        <div className="iap-vm-start-header">
          <span>{t('dialogs.iapVmStart.title')}</span>
        </div>
        <div className="iap-vm-start-body">
          <p className="iap-vm-start-message">
            <Trans
              i18nKey="dialogs.iapVmStart.message"
              values={{ status: prompt.currentStatus }}
              components={[<strong key="status" />]}
            />
          </p>
          <div className="iap-vm-start-row">
            <span className="iap-vm-start-label">{t('dialogs.iapVmStart.instance')}</span>
            <span className="iap-vm-start-value">{prompt.instance}</span>
          </div>
          <div className="iap-vm-start-row">
            <span className="iap-vm-start-label">{t('dialogs.iapVmStart.project')}</span>
            <span className="iap-vm-start-value">{prompt.project}</span>
          </div>
          <div className="iap-vm-start-row">
            <span className="iap-vm-start-label">{t('dialogs.iapVmStart.zone')}</span>
            <span className="iap-vm-start-value">{prompt.zone}</span>
          </div>
        </div>
        <div className="iap-vm-start-footer">
          <button
            type="button"
            className="iap-vm-start-btn-secondary"
            disabled={busy}
            onClick={() => respond(false)}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="iap-vm-start-btn-primary"
            disabled={busy}
            onClick={() => respond(true)}
          >
            {t('dialogs.iapVmStart.startVm')}
          </button>
        </div>
      </div>
    </div>
  );
}
