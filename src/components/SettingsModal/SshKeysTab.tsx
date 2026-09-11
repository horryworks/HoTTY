import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSshKeys } from '../../hooks/useSshKeys';
import { tauriService } from '../../services/tauriService';
import { SshKeyGenerateModal } from '../SshKeyGenerateModal/SshKeyGenerateModal';
import { ConfirmModal } from '../ConfirmModal/ConfirmModal';
import { suggestSshKeyName, uniqueSshKeyName } from '../../utils/sshKeyName';
import type { SshKeyInfo } from '../../types/appTypes';
import './SshKeysTab.css';

/** `SHA256:AAAA…BBBB` — enough to compare at a glance without filling the row. */
function shortFingerprint(fingerprint: string): string {
  if (fingerprint.length <= 30) return fingerprint;
  return `${fingerprint.slice(0, 18)}…${fingerprint.slice(-6)}`;
}

/** `ssh-rsa` plus the size, since RSA is the one algorithm with a choice. */
function algorithmLabel(key: SshKeyInfo): string {
  if (!key.algorithm) return '';
  return key.bits ? `${key.algorithm} ${key.bits}` : key.algorithm;
}

export function SshKeysTab() {
  const { t } = useTranslation();
  const { keys, sshDir, available, unavailableReason, truncated, error, refresh } =
    useSshKeys(true);

  const [generateOpen, setGenerateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SshKeyInfo | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [copiedName, setCopiedName] = useState<string | null>(null);
  const [shownLine, setShownLine] = useState<{ name: string; line: string } | null>(null);

  const handleCopy = useCallback(async (key: SshKeyInfo) => {
    const line = await tauriService.readSshPublicKey(key.name);
    await tauriService.writeClipboard(line);
    setCopiedName(key.name);
    window.setTimeout(() => setCopiedName(null), 1500);
  }, []);

  const handleShowLine = useCallback(
    async (key: SshKeyInfo) => {
      if (shownLine?.name === key.name) {
        setShownLine(null);
        return;
      }
      const line = await tauriService.readSshPublicKey(key.name);
      setShownLine({ name: key.name, line });
    },
    [shownLine],
  );

  const handleDelete = useCallback(async () => {
    const key = pendingDelete;
    setPendingDelete(null);
    if (!key?.fingerprint) return;
    setDeleteError(null);
    try {
      await tauriService.deleteSshKey(key.name, key.fingerprint);
      await refresh();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    }
  }, [pendingDelete, refresh]);

  const defaultName = uniqueSshKeyName(
    suggestSshKeyName('ed25519'),
    keys.map((k) => k.name),
  );

  return (
    <>
      <div className="settings-card">
        <h3 className="settings-section-title settings-section-title--first">
          {t('settings.sshKeys.generateSection')}
        </h3>
        <button
          type="button"
          className="settings-button"
          onClick={() => setGenerateOpen(true)}
          disabled={!available}
        >
          {t('settings.sshKeys.generateButton')}
        </button>
        <p className="settings-help-text">{t('settings.sshKeys.generateHelp')}</p>
      </div>

      <div className="settings-card">
        <h3 className="settings-section-title">{t('settings.sshKeys.keysSection')}</h3>

        {available && sshDir !== null && (
          <div className="ssh-keys-folder-row">
            <span className="ssh-keys-folder-path" title={sshDir}>
              {sshDir}
            </span>
            <button
              type="button"
              className="settings-button"
              onClick={() => void tauriService.openSshKeyFolder()}
            >
              {t('settings.sshKeys.openFolder')}
            </button>
            <button type="button" className="settings-button" onClick={() => void refresh()}>
              {t('settings.sshKeys.refresh')}
            </button>
          </div>
        )}

        {!available && <p className="ssh-keys-notice">{unavailableReason}</p>}
        {error !== null && <p className="ssh-keys-notice">{t('settings.sshKeys.loadError')}</p>}
        {deleteError !== null && <p className="ssh-keys-notice">{deleteError}</p>}

        {available && error === null && keys.length === 0 && (
          <p className="settings-help-text">{t('settings.sshKeys.empty')}</p>
        )}

        {keys.length > 0 && (
          <ul className="ssh-keys-list">
            {keys.map((key) => (
              <li key={key.name} className="ssh-keys-item">
                <div className="ssh-keys-item-head">
                  <span className="ssh-keys-name">{key.name}</span>
                  {key.managed && (
                    <span className="ssh-keys-badge ssh-keys-badge--managed">
                      {t('settings.sshKeys.createdByHotty')}
                    </span>
                  )}
                  {key.encrypted && (
                    <span className="ssh-keys-badge">{t('settings.sshKeys.hasPassphrase')}</span>
                  )}
                  {key.format !== 'openssh' && key.format !== 'unknown' && (
                    <span className="ssh-keys-badge">{key.format.toUpperCase()}</span>
                  )}
                  <span className="ssh-keys-algorithm">{algorithmLabel(key)}</span>
                </div>

                {key.fingerprint ? (
                  <div className="ssh-keys-item-meta">
                    <span className="ssh-keys-fingerprint" title={key.fingerprint}>
                      {shortFingerprint(key.fingerprint)}
                    </span>
                    {key.comment !== undefined && (
                      <span className="ssh-keys-comment">{key.comment}</span>
                    )}
                  </div>
                ) : (
                  <div className="ssh-keys-item-meta">
                    <span className="ssh-keys-comment">{t('settings.sshKeys.unreadable')}</span>
                  </div>
                )}

                <div className="ssh-keys-item-actions">
                  <button
                    type="button"
                    className="settings-button"
                    onClick={() => void handleCopy(key)}
                    disabled={!key.hasPublicFile}
                  >
                    {copiedName === key.name
                      ? t('common.copied')
                      : t('settings.sshKeys.copyPublicKey')}
                  </button>
                  <button
                    type="button"
                    className="settings-button"
                    onClick={() => void handleShowLine(key)}
                    disabled={!key.hasPublicFile}
                  >
                    {t('settings.sshKeys.showAuthorizedKeys')}
                  </button>
                  <button
                    type="button"
                    className="settings-button"
                    onClick={() => void tauriService.exportSshPublicKey(key.name)}
                    disabled={!key.hasPublicFile}
                  >
                    {t('settings.sshKeys.exportPublicKey')}
                  </button>
                  <button
                    type="button"
                    className="settings-button ssh-keys-delete"
                    onClick={() => setPendingDelete(key)}
                    disabled={!key.managed}
                    title={key.managed ? undefined : t('settings.sshKeys.deleteOnlyOwn')}
                  >
                    {t('settings.sshKeys.deleteKey')}
                  </button>
                </div>

                {shownLine?.name === key.name && (
                  <>
                    <textarea className="ssh-keys-public" readOnly value={shownLine.line} />
                    <p className="settings-help-text">
                      {t('settings.sshKeys.authorizedKeysHelp')}
                    </p>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {truncated && (
          <p className="settings-help-text">
            {t('settings.sshKeys.truncated', { count: keys.length })}
          </p>
        )}
      </div>

      <SshKeyGenerateModal
        open={generateOpen}
        defaultName={defaultName}
        existingNames={keys.map((k) => k.name)}
        onClose={() => {
          setGenerateOpen(false);
          void refresh();
        }}
        onGenerated={() => {
          // The passphrase is deliberately dropped here. This tab has no
          // connection to attach it to, and storing it would mean inventing a
          // second home for credentials next to the host tree's.
          void refresh();
        }}
      />

      {pendingDelete !== null && (
        <ConfirmModal
          title={t('settings.sshKeys.deleteConfirmTitle')}
          message={t('settings.sshKeys.deleteConfirmMessage', { name: pendingDelete.name })}
          confirmLabel={t('common.delete')}
          onConfirm={() => void handleDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  );
}
