import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../Dialog/Dialog';
import { tauriService } from '../../services/tauriService';
import {
  validateSshKeyName,
  validateSshKeyComment,
  type SshKeyNameError,
  type SshKeyCommentError,
} from '../../utils/sshKeyName';
import type { SshKeyAlgorithm, SshKeyInfo } from '../../types/appTypes';
import './SshKeyGenerateModal.css';

const ALGORITHMS: readonly SshKeyAlgorithm[] = [
  'ed25519',
  'ecdsa-p256',
  'ecdsa-p384',
  'ecdsa-p521',
  'rsa-2048',
  'rsa-3072',
  'rsa-4096',
];

const ALGORITHM_LABEL_KEYS: Record<SshKeyAlgorithm, string> = {
  ed25519: 'settings.sshKeys.algoEd25519',
  'ecdsa-p256': 'settings.sshKeys.algoEcdsaP256',
  'ecdsa-p384': 'settings.sshKeys.algoEcdsaP384',
  'ecdsa-p521': 'settings.sshKeys.algoEcdsaP521',
  'rsa-2048': 'settings.sshKeys.algoRsa2048',
  'rsa-3072': 'settings.sshKeys.algoRsa3072',
  'rsa-4096': 'settings.sshKeys.algoRsa4096',
};

const NAME_ERROR_KEYS: Record<SshKeyNameError, string> = {
  empty: 'settings.sshKeys.nameErrorEmpty',
  tooLong: 'settings.sshKeys.nameErrorTooLong',
  invalidCharacters: 'settings.sshKeys.nameErrorInvalidCharacters',
  startsWithDot: 'settings.sshKeys.nameErrorStartsWithDot',
  endsWithDot: 'settings.sshKeys.nameErrorEndsWithDot',
  isPublicKey: 'settings.sshKeys.nameErrorIsPublicKey',
  reservedDevice: 'settings.sshKeys.nameErrorReservedDevice',
};

const COMMENT_ERROR_KEYS: Record<SshKeyCommentError, string> = {
  tooLong: 'settings.sshKeys.commentErrorTooLong',
  hasLineBreak: 'settings.sshKeys.commentErrorHasLineBreak',
};

function algorithmHelpKey(algorithm: SshKeyAlgorithm): string {
  if (algorithm.startsWith('rsa')) return 'settings.sshKeys.algoHelpRsa';
  if (algorithm.startsWith('ecdsa')) return 'settings.sshKeys.algoHelpEcdsa';
  return 'settings.sshKeys.algoHelpEd25519';
}

interface SshKeyGenerateModalProps {
  open: boolean;
  /** Pre-filled name, e.g. one derived from the host being connected to. */
  defaultName: string;
  /** Names already in `~/.ssh`, so a collision is caught before the round trip. */
  existingNames: readonly string[];
  /**
   * Shown only when the modal was opened from a connection form. Offers to put
   * the new key straight into that connection's fields.
   */
  offerUseForConnection?: boolean;
  onClose: () => void;
  /**
   * The key was created. `passphrase` is whatever the user typed, passed on only
   * so a connection form can fill its own field; it is never stored here.
   */
  onGenerated: (info: SshKeyInfo, passphrase: string | null, useForConnection: boolean) => void;
}

export function SshKeyGenerateModal({
  open,
  defaultName,
  existingNames,
  offerUseForConnection = false,
  onClose,
  onGenerated,
}: SshKeyGenerateModalProps) {
  const { t } = useTranslation();

  const [name, setName] = useState(defaultName);
  const [algorithm, setAlgorithm] = useState<SshKeyAlgorithm>('ed25519');
  const [comment, setComment] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [useForConnection, setUseForConnection] = useState(true);

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<SshKeyInfo | null>(null);
  const [publicLine, setPublicLine] = useState('');
  const [copied, setCopied] = useState(false);

  // Reset on every open, so a passphrase typed last time is never sitting in the
  // field when the form comes back.
  useEffect(() => {
    if (!open) return;
    setName(defaultName);
    setAlgorithm('ed25519');
    setComment('');
    setPassphrase('');
    setConfirmPassphrase('');
    setUseForConnection(true);
    setGenerating(false);
    setError(null);
    setCreated(null);
    setPublicLine('');
    setCopied(false);
  }, [open, defaultName]);

  // And on unmount, for the path where the whole settings modal closes.
  useEffect(
    () => () => {
      setPassphrase('');
      setConfirmPassphrase('');
    },
    [],
  );

  const nameError = validateSshKeyName(name);
  const nameTaken = nameError === null && existingNames.includes(name);
  const commentError = validateSshKeyComment(comment);
  const passphraseMismatch = passphrase !== confirmPassphrase;
  const canGenerate =
    !generating && nameError === null && !nameTaken && commentError === null && !passphraseMismatch;

  const handleClose = useCallback(() => {
    // Closing mid-generation would be a lie: `spawn_blocking` cannot be
    // interrupted, so the file would still appear a few seconds later.
    if (generating) return;
    setPassphrase('');
    setConfirmPassphrase('');
    onClose();
  }, [generating, onClose]);

  // Escape answers the safe way here by refusing while a key is being written.

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) return;
    setGenerating(true);
    setError(null);
    try {
      const info = await tauriService.generateSshKey(
        { name, algorithm, comment: comment || undefined },
        passphrase || null,
      );
      const line = await tauriService.readSshPublicKey(info.name);
      setCreated(info);
      setPublicLine(line);
      onGenerated(info, passphrase || null, offerUseForConnection && useForConnection);
      // The passphrase has been handed to the backend and to the caller; there
      // is no reason for this component to keep holding it.
      setPassphrase('');
      setConfirmPassphrase('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }, [
    canGenerate,
    name,
    algorithm,
    comment,
    passphrase,
    onGenerated,
    offerUseForConnection,
    useForConnection,
  ]);

  const handleCopy = useCallback(async () => {
    await tauriService.writeClipboard(publicLine);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [publicLine]);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={created ? t('settings.sshKeys.createdTitle') : t('settings.sshKeys.modalTitle')}
      width={420}
      showClose={false}
      footer={
        <>
          {created ? (
            <>
              <button type="button" className="skg-btn-secondary" onClick={handleCopy}>
                {copied ? t('common.copied') : t('settings.sshKeys.copyPublicKey')}
              </button>
              <button type="button" className="skg-btn-primary" onClick={handleClose}>
                {t('common.close')}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="skg-btn-secondary"
                onClick={handleClose}
                disabled={generating}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="skg-btn-primary"
                onClick={() => void handleGenerate()}
                disabled={!canGenerate}
              >
                {generating ? t('settings.sshKeys.generating') : t('settings.sshKeys.generate')}
              </button>
            </>
          )}
        </>
      }
    >
          {created ? (
            <>
              <div className="skg-field">
                <label htmlFor="skg-public">{t('settings.sshKeys.createdHelp')}</label>
                <textarea id="skg-public" className="skg-public" readOnly value={publicLine} />
              </div>
              <p className="skg-hint">{t('settings.sshKeys.authorizedKeysHelp')}</p>
              {/* Only shown from the session dialog: someone who generated a key
                  from the settings tab is already looking at the list. */}
              {offerUseForConnection && (
                <p className="skg-hint">{t('settings.sshKeys.createdLaterHint')}</p>
              )}
            </>
          ) : (
            <>
              <div className="skg-field">
                <label htmlFor="skg-name">{t('settings.sshKeys.nameLabel')}</label>
                <input
                  id="skg-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={generating}
                  autoComplete="off"
                  spellCheck={false}
                />
                {nameError !== null && (
                  <p className="skg-field-error">{t(NAME_ERROR_KEYS[nameError])}</p>
                )}
                {nameTaken && (
                  <p className="skg-field-error">{t('settings.sshKeys.nameErrorTaken')}</p>
                )}
                {nameError === null && !nameTaken && (
                  <p className="skg-hint">{t('settings.sshKeys.nameHelp')}</p>
                )}
              </div>

              <div className="skg-field">
                <label htmlFor="skg-algorithm">{t('settings.sshKeys.algorithmLabel')}</label>
                <select
                  id="skg-algorithm"
                  value={algorithm}
                  onChange={(e) => setAlgorithm(e.target.value as SshKeyAlgorithm)}
                  disabled={generating}
                >
                  {ALGORITHMS.map((a) => (
                    <option key={a} value={a}>
                      {t(ALGORITHM_LABEL_KEYS[a])}
                    </option>
                  ))}
                </select>
                <p className="skg-hint">{t(algorithmHelpKey(algorithm))}</p>
              </div>

              <div className="skg-field">
                <label htmlFor="skg-comment">{t('settings.sshKeys.commentLabel')}</label>
                <input
                  id="skg-comment"
                  type="text"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  disabled={generating}
                  autoComplete="off"
                />
                {commentError !== null ? (
                  <p className="skg-field-error">{t(COMMENT_ERROR_KEYS[commentError])}</p>
                ) : (
                  <p className="skg-hint">{t('settings.sshKeys.commentHelp')}</p>
                )}
              </div>

              <div className="skg-field skg-field--tight">
                <label htmlFor="skg-passphrase">{t('settings.sshKeys.passphraseLabel')}</label>
                <input
                  id="skg-passphrase"
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  disabled={generating}
                  autoComplete="new-password"
                />
              </div>

              <div className="skg-field">
                <label htmlFor="skg-passphrase-confirm">
                  {t('settings.sshKeys.passphraseConfirmLabel')}
                </label>
                <input
                  id="skg-passphrase-confirm"
                  type="password"
                  value={confirmPassphrase}
                  onChange={(e) => setConfirmPassphrase(e.target.value)}
                  disabled={generating}
                  autoComplete="new-password"
                />
                {passphraseMismatch ? (
                  <p className="skg-field-error">{t('settings.sshKeys.passphraseMismatch')}</p>
                ) : passphrase ? (
                  <p className="skg-hint">{t('settings.sshKeys.passphraseHelp')}</p>
                ) : (
                  <p className="skg-hint">{t('settings.sshKeys.noPassphraseNote')}</p>
                )}
              </div>

              {offerUseForConnection && (
                <label className="skg-checkbox">
                  <input
                    type="checkbox"
                    checked={useForConnection}
                    onChange={(e) => setUseForConnection(e.target.checked)}
                    disabled={generating}
                  />
                  {t('settings.sshKeys.useForConnection')}
                </label>
              )}

              {generating && algorithm.startsWith('rsa') && (
                <p className="skg-hint">{t('settings.sshKeys.generatingSlow')}</p>
              )}
              {error !== null && <p className="skg-error">{error}</p>}
            </>
          )}
    </Dialog>
  );
}
