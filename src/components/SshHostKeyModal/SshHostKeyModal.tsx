import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../Dialog/Dialog';
import { tauriService } from '../../services/tauriService';
import { logError } from '../../utils/logger';
import i18n from '../../i18n';
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
      logError('SSH', i18n.t('notifications.errors.sshHostKeyListen'), e);
    });
    return () => {
      unlisten?.();
    };
  }, []);

  const respond = useCallback(
    async (accept: boolean, remember: boolean) => {
      if (!prompt) return;
      try {
        await tauriService.respondSshHostKey(prompt.sessionId, accept, remember);
      } catch (e) {
        // The only failure is "no pending prompt": it was answered elsewhere or
        // already timed out, and the connection reports its own error. Logged
        // quietly because logError would raise a second toast for it.
        tauriService
          .logDebug('warn', 'SSH', `host-key answer not delivered: ${e instanceof Error ? e.message : String(e)}`)
          .catch(() => {});
      } finally {
        // Close even on failure: a dialog that cannot be dismissed locks the
        // window it sits in. The backend still rejects an unanswered key.
        // Compare first so a newer prompt that arrived meanwhile stays up.
        setPrompt((current) => (current === prompt ? null : current));
      }
    },
    [prompt],
  );

  // Escape rejects. A host-key prompt must fail closed: "I did not expect this"
  // is precisely what dismissing it means, and the alternative — treating a
  // stray Escape as consent — would defeat the check entirely.
  const rejectOnEscape = useCallback(() => {
    void respond(false, false);
  }, [respond]);
  if (!prompt) return null;

  const isChanged = prompt.kind === 'changed';

  return (
    <Dialog
      open
      // Escape and the close button both reject. A host-key prompt must fail
      // closed: "I did not expect this" is precisely what dismissing it means,
      // and treating a stray Escape as consent would defeat the check entirely.
      onClose={rejectOnEscape}
      title={isChanged ? t('dialogs.sshHostKey.titleChanged') : t('dialogs.sshHostKey.titleUnknown')}
      width={520}
      showClose={false}
      footer={
        <>
          <button type="button" className="ssh-host-key-btn-danger" onClick={() => respond(false, false)}>
            {t('dialogs.sshHostKey.reject')}
          </button>
          <button type="button" className="ssh-host-key-btn-secondary" onClick={() => respond(true, false)}>
            {t('dialogs.sshHostKey.acceptOnce')}
          </button>
          <button type="button" className="ssh-host-key-btn-primary" onClick={() => respond(true, true)}>
            {t('dialogs.sshHostKey.acceptRemember')}
          </button>
        </>
      }
    >
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
    </Dialog>
  );
}
