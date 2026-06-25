import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tauriService } from '../../services/tauriService';
import { logError } from '../../utils/logger';
import type { SshHostKeyPromptPayload } from '../../types/appTypes';
import './SshHostKeyModal.css';

export function SshHostKeyModal() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState<SshHostKeyPromptPayload | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    tauriService.onSshHostKeyPrompt((p) => setPrompt(p)).then((fn) => {
      unlisten = fn;
    }).catch((e) => {
      logError('SSH', 'Failed to listen for host key prompts', e);
    });
    return () => {
      unlisten?.();
    };
  }, []);

  if (!prompt) return null;

  const respond = async (accept: boolean, remember: boolean) => {
    await tauriService.respondSshHostKey(prompt.sessionId, accept, remember);
    setPrompt(null);
  };

  const isChanged = prompt.kind === 'changed';

  return (
    <div className="ssh-host-key-overlay">
      <div className="ssh-host-key-modal">
        <div className="ssh-host-key-header">
          <span>{isChanged ? t('dialogs.sshHostKey.titleChanged') : t('dialogs.sshHostKey.titleUnknown')}</span>
        </div>
        <div className="ssh-host-key-body">
          {isChanged && (
            <p className="ssh-host-key-warning">
              {t('dialogs.sshHostKey.warning')}
            </p>
          )}
          <div className="ssh-host-key-row">
            <span className="ssh-host-key-label">{t('dialogs.sshHostKey.host')}</span>
            <span className="ssh-host-key-value">
              {prompt.host}:{prompt.port}
            </span>
          </div>
          <div className="ssh-host-key-row">
            <span className="ssh-host-key-label">{t('dialogs.sshHostKey.keyType')}</span>
            <span className="ssh-host-key-value">{prompt.keyType}</span>
          </div>
          <div className="ssh-host-key-row">
            <span className="ssh-host-key-label">{t('dialogs.sshHostKey.fingerprint')}</span>
            <span className="ssh-host-key-fingerprint">{prompt.fingerprint}</span>
          </div>
        </div>
        <div className="ssh-host-key-footer">
          <button
            type="button"
            className="ssh-host-key-btn-danger"
            onClick={() => respond(false, false)}
          >
            {t('dialogs.sshHostKey.reject')}
          </button>
          <button
            type="button"
            className="ssh-host-key-btn-secondary"
            onClick={() => respond(true, false)}
          >
            {t('dialogs.sshHostKey.acceptOnce')}
          </button>
          <button
            type="button"
            className="ssh-host-key-btn-primary"
            onClick={() => respond(true, true)}
          >
            {t('dialogs.sshHostKey.acceptRemember')}
          </button>
        </div>
      </div>
    </div>
  );
}
