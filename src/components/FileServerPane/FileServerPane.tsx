import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tauriService } from '../../services/tauriService';
import { useSettingsStore } from '../../stores/settingsStore';
import { useFileServerEvents } from '../../hooks/useFileServerEvents';
import { recallPaneMemory, useRememberPane } from '../../hooks/usePaneMemory';
import { RunStatus, Segmented } from '../PaneTools/PaneTools';
import { deviceCommand, reachableAddress } from './fileServerHelpers';
import type { FileServerConfig, FileServerProtocol, FirewallReport, LocalAddress } from '../../types/appTypes';
import './FileServerPane.css';

interface FileServerPaneProps {
  paneId: string;
  active: boolean;
}

/** Wait this long after a port edit before asking the firewall about it. */
const FIREWALL_RECHECK_DELAY_MS = 600;

function formatBytes(n?: number | null): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString();
  } catch {
    return '';
  }
}

export function FileServerPane({ paneId, active }: FileServerPaneProps) {
  const { t } = useTranslation();
  const persisted = useSettingsStore((s) => s.fileServerConfig);
  const updateSettings = useSettingsStore((s) => s.update);

  const [cfg, setCfg] = useState<FileServerConfig>(persisted);
  // Kept across remounts: hiding the tab does not stop the servers.
  const [sftpPassword, setSftpPassword] = useState(() => recallPaneMemory(paneId, 'sftpPassword', ''));
  const [error, setError] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<LocalAddress[]>([]);
  const [pickedAddress, setPickedAddress] = useState<string | null>(() => recallPaneMemory(paneId, 'address', null));
  useRememberPane(paneId, { 'sftpPassword': sftpPassword, 'address': pickedAddress });
  const [copied, setCopied] = useState<string | null>(null);
  const [firewall, setFirewall] = useState<Record<FileServerProtocol, FirewallReport | null>>({ tftp: null, sftp: null });
  const [fwChecking, setFwChecking] = useState<Record<FileServerProtocol, boolean>>({ tftp: false, sftp: false });

  const { tftpState, sftpState, transfers, lastError, clearTransfers, clearLastError } = useFileServerEvents(paneId);
  const isRunning = { tftp: tftpState === 'running', sftp: sftpState === 'running' };
  const anyRunning = isRunning.tftp || isRunning.sftp;

  // Persist config (excluding the password, which is component-local only).
  useEffect(() => {
    updateSettings('fileServerConfig', cfg);
  }, [cfg, updateSettings]);

  const setField = useCallback(<K extends keyof FileServerConfig>(key: K, value: FileServerConfig[K]) => {
    setCfg((prev) => ({ ...prev, [key]: value }));
  }, []);

  // The PC's addresses, so the pane can say what a device should type.
  useEffect(() => {
    let cancelled = false;
    tauriService.fileServerLocalAddresses()
      .then((list) => { if (!cancelled) setAddresses(list); })
      .catch(() => { if (!cancelled) setAddresses([]); });
    return () => { cancelled = true; };
  }, []);

  // Each check runs PowerShell and can take seconds, so an older one (for the
  // port before an edit) may finish last. Only the newest may show its result.
  const fwRequest = useRef<Record<FileServerProtocol, number>>({ tftp: 0, sftp: 0 });
  const checkFirewall = useCallback(async (protocol: FileServerProtocol, port: number) => {
    const request = ++fwRequest.current[protocol];
    setFwChecking((prev) => ({ ...prev, [protocol]: true }));
    let report: FirewallReport;
    try {
      report = await tauriService.fileServerFirewallStatus(protocol, port);
    } catch {
      report = { status: 'unknown', reason: 'queryFailed' };
    }
    if (request !== fwRequest.current[protocol]) return;
    setFirewall((prev) => ({ ...prev, [protocol]: report }));
    setFwChecking((prev) => ({ ...prev, [protocol]: false }));
  }, []);

  // Ask the firewall before the server starts, so a block shows up while the
  // user can still fix it — not as a device transfer that times out.
  useEffect(() => {
    if (cfg.tftpPort < 1 || cfg.tftpPort > 65535) return;
    const id = setTimeout(() => void checkFirewall('tftp', cfg.tftpPort), FIREWALL_RECHECK_DELAY_MS);
    return () => clearTimeout(id);
  }, [cfg.tftpPort, checkFirewall]);
  useEffect(() => {
    if (cfg.sftpPort < 1 || cfg.sftpPort > 65535) return;
    const id = setTimeout(() => void checkFirewall('sftp', cfg.sftpPort), FIREWALL_RECHECK_DELAY_MS);
    return () => clearTimeout(id);
  }, [cfg.sftpPort, checkFirewall]);

  const handleAllowFirewall = useCallback(async (protocol: FileServerProtocol, port: number) => {
    try {
      await tauriService.fileServerFirewallAllow(protocol, port);
      await checkFirewall(protocol, port);
    } catch (e) {
      setError(String(e));
    }
  }, [checkFirewall]);

  const handleBrowse = useCallback(async () => {
    try {
      const dir = await tauriService.selectFolder();
      if (dir) setField('rootDir', dir);
    } catch (e) {
      setError(String(e));
    }
  }, [setField]);

  const start = useCallback(async (protocol: FileServerProtocol) => {
    if (!cfg.rootDir) {
      setError(t('panes.fileServer.errorNoRoot'));
      return;
    }
    if (protocol === 'sftp' && (!cfg.sftpUsername.trim() || !sftpPassword)) {
      setError(t('panes.fileServer.errorNoCreds'));
      return;
    }
    setError(null);
    clearLastError();
    try {
      if (protocol === 'tftp') {
        await tauriService.fileServerTftpStart(paneId, cfg.bindAddr, cfg.tftpPort, cfg.rootDir, cfg.tftpAllowWrite);
      } else {
        await tauriService.fileServerSftpStart(
          paneId, cfg.bindAddr, cfg.sftpPort, cfg.rootDir, cfg.sftpUsername, sftpPassword, cfg.sftpAllowWrite,
        );
      }
      void checkFirewall(protocol, protocol === 'tftp' ? cfg.tftpPort : cfg.sftpPort);
    } catch (e) {
      setError(String(e));
    }
  }, [paneId, cfg, sftpPassword, checkFirewall, clearLastError, t]);

  const stop = useCallback(async (protocol: FileServerProtocol) => {
    try {
      if (protocol === 'tftp') await tauriService.fileServerTftpStop(paneId);
      else await tauriService.fileServerSftpStop(paneId);
    } catch (e) {
      setError(String(e));
    }
  }, [paneId]);

  const copy = useCallback(async (text: string) => {
    try {
      await tauriService.writeClipboard(text);
      setCopied(text);
      setTimeout(() => setCopied((c) => (c === text ? null : c)), 1500);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  /** Explains *why* traffic is (or may be) dropped, so the fix is obvious. */
  const firewallHint = (report: FirewallReport): string => {
    switch (report.reason) {
      case 'otherExeRule':
        return t('panes.fileServer.fwOtherExeHint', { path: report.otherExePath ?? '' });
      case 'blockRule':
        return t('panes.fileServer.fwBlockRuleHint');
      case 'profileMismatch':
        return t('panes.fileServer.fwProfileMismatchHint');
      case 'thirdPartyFw':
        return t('panes.fileServer.fwThirdPartyHint');
      case 'queryFailed':
        return t('panes.fileServer.fwUnknownHint');
      default:
        return t('panes.fileServer.fwBlockedHint');
    }
  };

  const address = reachableAddress(cfg.bindAddr, addresses, pickedAddress);

  const renderFirewall = (protocol: FileServerProtocol, port: number) => {
    const report = firewall[protocol];
    if (report?.status === 'notApplicable') return null;
    if (fwChecking[protocol] || !report) {
      return <div className="fs-fw checking">{t('panes.fileServer.fwChecking')}</div>;
    }
    if (report.status === 'allowed') {
      return (
        <div className="fs-fw allowed">
          <span>✓ {t('panes.fileServer.fwAllowed')}</span>
          <button type="button" className="fs-link-btn" onClick={() => void checkFirewall(protocol, port)}>
            {t('panes.fileServer.recheck')}
          </button>
        </div>
      );
    }
    // Offer the fix on 'unknown' too: a check that could not finish is no
    // reason to strand the user, and adding the rule is harmless if allowed.
    return (
      <div className={`fs-fw ${report.status === 'blocked' ? 'blocked' : 'unknown'}`}>
        <div className="fs-fw-line">
          <span>{report.status === 'blocked' ? `✕ ${t('panes.fileServer.fwBlocked')}` : t('panes.fileServer.fwUnknown')}</span>
          <button type="button" className="fs-link-btn" onClick={() => void handleAllowFirewall(protocol, port)}>
            {t('panes.fileServer.allowThroughFirewall')}
          </button>
          <button type="button" className="fs-link-btn" onClick={() => void checkFirewall(protocol, port)}>
            {t('panes.fileServer.recheck')}
          </button>
        </div>
        <div className="fs-fw-hint">{firewallHint(report)}</div>
      </div>
    );
  };

  const writeOptions = [
    { value: 'off' as const, label: t('panes.fileServer.writeOff') },
    { value: 'on' as const, label: t('panes.fileServer.writeOn') },
  ];

  const renderCard = (protocol: FileServerProtocol) => {
    const running = isRunning[protocol];
    const isTftp = protocol === 'tftp';
    const port = isTftp ? cfg.tftpPort : cfg.sftpPort;
    const allowWrite = isTftp ? cfg.tftpAllowWrite : cfg.sftpAllowWrite;
    const name = isTftp ? t('panes.fileServer.tftpTitle') : t('panes.fileServer.sftpTitle');
    const command = address ? deviceCommand(protocol, address, port, cfg.sftpUsername) : null;
    return (
      <section className={`fs-card${running ? ' running' : ''}`} aria-label={name}>
        <div className="fs-card-head">
          <span className="fs-card-title">{name}</span>
          <RunStatus
            tone={running ? 'running' : 'stopped'}
            label={running ? t('panes.fileServer.statusRunning') : t('panes.fileServer.statusStopped')}
          />
          <button
            type="button"
            role="switch"
            aria-checked={running}
            aria-label={t('panes.fileServer.toggleAria', { protocol: name })}
            className="fs-switch"
            onClick={() => void (running ? stop(protocol) : start(protocol))}
          />
        </div>

        <div className="fs-card-fields">
          <label className="fs-field fs-field-port">
            <span className="fs-label">{t('panes.fileServer.portLabel')}</span>
            <input
              type="number"
              className="fs-input"
              min={1}
              max={65535}
              value={port}
              onChange={(e) => setField(isTftp ? 'tftpPort' : 'sftpPort', Number(e.target.value))}
              disabled={running}
            />
          </label>
          {!isTftp && (
            <>
              <label className="fs-field">
                <span className="fs-label">{t('panes.fileServer.usernameLabel')}</span>
                <input
                  type="text"
                  className="fs-input"
                  value={cfg.sftpUsername}
                  onChange={(e) => setField('sftpUsername', e.target.value)}
                  placeholder={t('panes.fileServer.usernamePlaceholder')}
                  disabled={running}
                  autoComplete="off"
                />
              </label>
              <label className="fs-field">
                <span className="fs-label">{t('panes.fileServer.passwordLabel')}</span>
                <input
                  type="password"
                  className="fs-input"
                  value={sftpPassword}
                  onChange={(e) => setSftpPassword(e.target.value)}
                  placeholder={t('panes.fileServer.passwordPlaceholder')}
                  disabled={running}
                  autoComplete="new-password"
                />
              </label>
            </>
          )}
        </div>

        <div className="fs-card-row">
          <span className="fs-label">{t('panes.fileServer.writeLabel')}</span>
          <Segmented
            options={writeOptions}
            value={allowWrite ? 'on' : 'off'}
            onChange={(v) => setField(isTftp ? 'tftpAllowWrite' : 'sftpAllowWrite', v === 'on')}
            ariaLabel={t('panes.fileServer.writeAria', { protocol: name })}
            disabled={running}
          />
        </div>

        {running && command && (
          <div className="fs-cmd">
            <code title={command}>{command}</code>
            <button type="button" className="fs-link-btn" onClick={() => void copy(command)}>
              {copied === command ? t('panes.fileServer.copied') : t('panes.fileServer.copy')}
            </button>
          </div>
        )}

        {renderFirewall(protocol, port)}
      </section>
    );
  };

  const uploading = (['tftp', 'sftp'] as const).filter((p) => isRunning[p] && (p === 'tftp' ? cfg.tftpAllowWrite : cfg.sftpAllowWrite));
  const shownError = error ?? lastError;
  const bindIsAny = !cfg.bindAddr.trim() || cfg.bindAddr.trim() === '0.0.0.0';

  return (
    <div className={`file-server-pane${active ? ' active' : ''}`} data-pane-id={paneId}>
      <div className="fs-top">
        <div className="fs-reach">
          <span className="fs-label">{t('panes.fileServer.reachAt')}</span>
          <span className="fs-address">{address ?? t('panes.fileServer.noAddress')}</span>
          {bindIsAny && addresses.length > 1 && (
            <select
              className="fs-input fs-address-pick"
              value={address ?? ''}
              onChange={(e) => setPickedAddress(e.target.value)}
              aria-label={t('panes.fileServer.addressAria')}
            >
              {addresses.map((a) => (
                <option key={`${a.name}-${a.address}`} value={a.address}>
                  {a.name ? `${a.name} — ${a.address}` : a.address}
                </option>
              ))}
            </select>
          )}
          {bindIsAny && addresses.length === 1 && addresses[0].name && (
            <span className="fs-adapter">{addresses[0].name}</span>
          )}
          {address && (
            <button type="button" className="fs-link-btn" onClick={() => void copy(address)}>
              {copied === address ? t('panes.fileServer.copied') : t('panes.fileServer.copy')}
            </button>
          )}
        </div>
        <div className="fs-root">
          <span className="fs-label">{t('panes.fileServer.rootLabel')}</span>
          <button
            type="button"
            className={`fs-root-btn${cfg.rootDir ? '' : ' empty'}`}
            onClick={() => void handleBrowse()}
            disabled={anyRunning}
            title={anyRunning ? t('panes.fileServer.rootLocked') : cfg.rootDir || undefined}
          >
            {cfg.rootDir || t('panes.fileServer.rootPick')}
          </button>
        </div>
      </div>

      {shownError && (
        <div className="file-server-error" role="alert">
          <span>{shownError}</span>
          <button
            type="button"
            className="fs-error-close"
            onClick={() => { setError(null); clearLastError(); }}
            aria-label={t('common.close')}
          >
            &times;
          </button>
        </div>
      )}

      <div className="file-server-body">
        <div className="fs-cards">
          {renderCard('tftp')}
          {renderCard('sftp')}
        </div>

        {uploading.length > 0 && (
          <div className="file-server-warning" role="status">
            {t('panes.fileServer.uploadsWarning', { protocols: uploading.map((p) => p.toUpperCase()).join(' / ') })}
          </div>
        )}

        <details className="fs-details">
          <summary>{t('panes.fileServer.advanced')}</summary>
          <label className="fs-field fs-field-bind">
            <span className="fs-label">{t('panes.fileServer.bindLabel')}</span>
            <input
              type="text"
              className="fs-input"
              value={cfg.bindAddr}
              onChange={(e) => setField('bindAddr', e.target.value)}
              placeholder={t('panes.fileServer.bindPlaceholder')}
              disabled={anyRunning}
            />
          </label>
        </details>

        <div className="fs-transfers">
          <div className="fs-transfers-header">
            <span className="fs-transfers-title">{t('panes.fileServer.transfersTitle')}</span>
            <span className="fs-transfers-spacer" />
            <button type="button" className="fs-link-btn" onClick={clearTransfers} disabled={transfers.length === 0}>
              {t('panes.fileServer.clear')}
            </button>
          </div>
          <div className="fs-transfers-body">
            {transfers.length > 0 ? (
              <table className="fs-table">
                <thead>
                  <tr>
                    <th>{t('panes.fileServer.thTime')}</th>
                    <th>{t('panes.fileServer.thProtocol')}</th>
                    <th>{t('panes.fileServer.thClient')}</th>
                    <th>{t('panes.fileServer.thFile')}</th>
                    <th>{t('panes.fileServer.thDirection')}</th>
                    <th className="fs-th-size">{t('panes.fileServer.thSize')}</th>
                  </tr>
                </thead>
                <tbody>
                  {transfers.map((tr) => (
                    <tr key={tr.id}>
                      <td className="fs-td-time">{formatTime(tr.timestamp)}</td>
                      <td className="fs-td-proto">{tr.protocol.toUpperCase()}</td>
                      <td>{tr.client}</td>
                      <td className="fs-td-file">{tr.filename}</td>
                      <td>{tr.direction === 'upload' ? t('panes.fileServer.dirUpload') : t('panes.fileServer.dirDownload')}</td>
                      <td className="fs-td-size">{formatBytes(tr.bytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="fs-placeholder">{t('panes.fileServer.noTransfers')}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
