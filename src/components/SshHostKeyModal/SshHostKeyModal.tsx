import { useEffect, useState } from 'react';
import { tauriService } from '../../services/tauriService';
import type { SshHostKeyPromptPayload } from '../../types/appTypes';
import './SshHostKeyModal.css';

export function SshHostKeyModal() {
  const [prompt, setPrompt] = useState<SshHostKeyPromptPayload | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    tauriService.onSshHostKeyPrompt((p) => setPrompt(p)).then((fn) => {
      unlisten = fn;
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
          <span>{isChanged ? 'Host key CHANGED' : 'Unknown host key'}</span>
        </div>
        <div className="ssh-host-key-body">
          {isChanged && (
            <p className="ssh-host-key-warning">
              WARNING: The host key for this server has changed since last
              connection. This could indicate a man-in-the-middle attack.
            </p>
          )}
          <div className="ssh-host-key-row">
            <span className="ssh-host-key-label">Host:</span>
            <span className="ssh-host-key-value">
              {prompt.host}:{prompt.port}
            </span>
          </div>
          <div className="ssh-host-key-row">
            <span className="ssh-host-key-label">Key type:</span>
            <span className="ssh-host-key-value">{prompt.keyType}</span>
          </div>
          <div className="ssh-host-key-row">
            <span className="ssh-host-key-label">Fingerprint:</span>
            <span className="ssh-host-key-fingerprint">{prompt.fingerprint}</span>
          </div>
        </div>
        <div className="ssh-host-key-footer">
          <button
            type="button"
            className="ssh-host-key-btn-danger"
            onClick={() => respond(false, false)}
          >
            Reject
          </button>
          <button
            type="button"
            className="ssh-host-key-btn-secondary"
            onClick={() => respond(true, false)}
          >
            Accept once
          </button>
          <button
            type="button"
            className="ssh-host-key-btn-primary"
            onClick={() => respond(true, true)}
          >
            Accept &amp; remember
          </button>
        </div>
      </div>
    </div>
  );
}
