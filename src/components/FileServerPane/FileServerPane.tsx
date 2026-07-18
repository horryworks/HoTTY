import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tauriService } from '../../services/tauriService';
import { useSettingsStore } from '../../stores/settingsStore';
import { useFileServerEvents } from '../../hooks/useFileServerEvents';
import type { FileServerConfig, FileServerProtocol, FirewallReport } from '../../types/appTypes';
import './FileServerPane.css';

interface FileServerPaneProps {
  paneId: string;
  active: boolean;
}

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
  const [sftpPassword, setSftpPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fwTftp, setFwTftp] = useState<FirewallReport | null>(null);
  const [fwSftp, setFwSftp] = useState<FirewallReport | null>(null);
  const [fwChecking, setFwChecking] = useState<FileServerProtocol | null>(null);

  const { tftpState, sftpState, transfers, lastError, clearTransfers } = useFileServerEvents(paneId);
  const tftpRunning = tftpState === 'running';
  const sftpRunning = sftpState === 'running';

  // Persist config (excluding the password, which is component-local only).
  useEffect(() => {
    updateSettings('fileServerConfig', cfg);
  }, [cfg, updateSettings]);

  const setField = useCallback(
    <K extends keyof FileServerConfig>(key: K, value: FileServerConfig[K]) => {
      setCfg((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const checkFirewall = useCallback(async (protocol: FileServerProtocol, port: number) => {
    setFwChecking(protocol);
    try {
      const report = await tauriService.fileServerFirewallStatus(protocol, port);
      if (protocol === 'tftp') setFwTftp(report);
      else setFwSftp(report);
    } catch {
      const report: FirewallReport = { status: 'unknown', reason: 'queryFailed' };
      if (protocol === 'tftp') setFwTftp(report);
      else setFwSftp(report);
    } finally {
      setFwChecking(null);
    }
  }, []);

  const handleAllowFirewall = useCallback(
    async (protocol: FileServerProtocol, port: number) => {
      try {
        await tauriService.fileServerFirewallAllow(protocol, port);
        await checkFirewall(protocol, port);
      } catch (e) {
        setError(String(e));
      }
    },
    [checkFirewall]
  );

  const handleBrowse = useCallback(async () => {
    try {
      const dir = await tauriService.selectFolder();
      if (dir) setField('rootDir', dir);
    } catch (e) {
      setError(String(e));
    }
  }, [setField]);

  const handleTftpStart = useCallback(async () => {
    if (!cfg.rootDir) {
      setError(t('panes.fileServer.errorNoRoot'));
      return;
    }
    setError(null);
    try {
      await tauriService.fileServerTftpStart(paneId, cfg.bindAddr, cfg.tftpPort, cfg.rootDir, cfg.tftpAllowWrite);
      void checkFirewall('tftp', cfg.tftpPort);
    } catch (e) {
      setError(String(e));
    }
  }, [paneId, cfg, checkFirewall, t]);

  const handleTftpStop = useCallback(async () => {
    try {
      await tauriService.fileServerTftpStop(paneId);
    } catch (e) {
      setError(String(e));
    }
  }, [paneId]);

  const handleSftpStart = useCallback(async () => {
    if (!cfg.rootDir) {
      setError(t('panes.fileServer.errorNoRoot'));
      return;
    }
    if (!cfg.sftpUsername.trim() || !sftpPassword) {
      setError(t('panes.fileServer.errorNoCreds'));
      return;
    }
    setError(null);
    try {
      await tauriService.fileServerSftpStart(
        paneId,
        cfg.bindAddr,
        cfg.sftpPort,
        cfg.rootDir,
        cfg.sftpUsername,
        sftpPassword,
        cfg.sftpAllowWrite
      );
      void checkFirewall('sftp', cfg.sftpPort);
    } catch (e) {
      setError(String(e));
    }
  }, [paneId, cfg, sftpPassword, checkFirewall, t]);

  const handleSftpStop = useCallback(async () => {
    try {
      await tauriService.fileServerSftpStop(paneId);
    } catch (e) {
      setError(String(e));
    }
  }, [paneId]);

  const sharedDisabled = tftpRunning || sftpRunning;

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

  const renderFirewall = (protocol: FileServerProtocol, port: number, running: boolean) => {
    if (!running) return null;
    const report = protocol === 'tftp' ? fwTftp : fwSftp;
    const status = report?.status;
    const checking = fwChecking === protocol;
    let cls = 'fs-fw-unknown';
    let label = t('panes.fileServer.fwUnknown');
    if (checking) {
      label = t('panes.fileServer.fwChecking');
    } else if (status === 'allowed') {
      cls = 'fs-fw-allowed';
      label = t('panes.fileServer.fwAllowed');
    } else if (status === 'blocked') {
      cls = 'fs-fw-blocked';
      label = t('panes.fileServer.fwBlocked');
    } else if (status === 'notApplicable') {
      return null;
    }
    // Offer remediation on 'unknown' too: a check we couldn't complete is no
    // reason to strand the user, and adding the rule is harmless if allowed.
    const canRemediate = !checking && report != null && (status === 'blocked' || status === 'unknown');
    return (
      <div className={`fs-firewall ${cls}`}>
        <span className="fs-firewall-label">{label}</span>
        <button type="button" className="fs-link-btn" onClick={() => checkFirewall(protocol, port)}>
          {t('panes.fileServer.recheck')}
        </button>
        {canRemediate && (
          <>
            <button type="button" className="fs-link-btn fs-fw-allow" onClick={() => handleAllowFirewall(protocol, port)}>
              {t('panes.fileServer.allowThroughFirewall')}
            </button>
            <span className="fs-firewall-hint">{firewallHint(report)}</span>
          </>
        )}
      </div>
    );
  };

  return (
    <div className={`file-server-pane${active ? ' active' : ''}`} data-pane-id={paneId}>
      <div className="file-server-toolbar">
        <span className="file-server-toolbar-title">{t('panes.fileServer.title')}</span>
        <span className="file-server-toolbar-spacer" />
      </div>

      <div className="file-server-warning">{t('panes.fileServer.exposureWarning')}</div>

      {(error || lastError) && <div className="file-server-error">{error ?? lastError}</div>}

      <div className="file-server-body">
        {/* Shared config */}
        <div className="fs-shared">
          <div className="fs-field fs-field-grow">
            <label className="fs-label">{t('panes.fileServer.rootLabel')}</label>
            <div className="fs-row">
              <input
                type="text"
                className="fs-input"
                value={cfg.rootDir}
                onChange={(e) => setField('rootDir', e.target.value)}
                placeholder={t('panes.fileServer.rootPlaceholder')}
                disabled={sharedDisabled}
              />
              <button type="button" className="fs-btn fs-btn-secondary" onClick={handleBrowse} disabled={sharedDisabled}>
                {t('panes.fileServer.browse')}
              </button>
            </div>
          </div>
          <div className="fs-field">
            <label className="fs-label">{t('panes.fileServer.bindLabel')}</label>
            <input
              type="text"
              className="fs-input"
              value={cfg.bindAddr}
              onChange={(e) => setField('bindAddr', e.target.value)}
              placeholder={t('panes.fileServer.bindPlaceholder')}
              disabled={sharedDisabled}
            />
          </div>
        </div>

        <div className="fs-sections">
          {/* TFTP */}
          <section className="fs-section">
            <div className="fs-section-header">
              <span className={`fs-status-dot ${tftpRunning ? 'running' : 'stopped'}`} />
              <span className="fs-section-title">{t('panes.fileServer.tftpTitle')}</span>
              <span className="fs-section-status">
                {tftpRunning ? t('panes.fileServer.statusRunning') : t('panes.fileServer.statusStopped')}
              </span>
            </div>
            <div className="fs-row">
              <div className="fs-field fs-field-port">
                <label className="fs-label">{t('panes.fileServer.portLabel')}</label>
                <input
                  type="number"
                  className="fs-input"
                  min={1}
                  max={65535}
                  value={cfg.tftpPort}
                  onChange={(e) => setField('tftpPort', Number(e.target.value))}
                  disabled={tftpRunning}
                />
              </div>
              <label className="fs-checkbox">
                <input
                  type="checkbox"
                  checked={cfg.tftpAllowWrite}
                  onChange={(e) => setField('tftpAllowWrite', e.target.checked)}
                  disabled={tftpRunning}
                />
                {t('panes.fileServer.allowWrite')}
              </label>
            </div>
            <div className="fs-actions">
              {tftpRunning ? (
                <button type="button" className="fs-btn fs-btn-stop" onClick={handleTftpStop}>
                  {t('panes.fileServer.stop')}
                </button>
              ) : (
                <button type="button" className="fs-btn fs-btn-start" onClick={handleTftpStart}>
                  {t('panes.fileServer.start')}
                </button>
              )}
            </div>
            {renderFirewall('tftp', cfg.tftpPort, tftpRunning)}
          </section>

          {/* SFTP */}
          <section className="fs-section">
            <div className="fs-section-header">
              <span className={`fs-status-dot ${sftpRunning ? 'running' : 'stopped'}`} />
              <span className="fs-section-title">{t('panes.fileServer.sftpTitle')}</span>
              <span className="fs-section-status">
                {sftpRunning ? t('panes.fileServer.statusRunning') : t('panes.fileServer.statusStopped')}
              </span>
            </div>
            <div className="fs-row">
              <div className="fs-field fs-field-port">
                <label className="fs-label">{t('panes.fileServer.portLabel')}</label>
                <input
                  type="number"
                  className="fs-input"
                  min={1}
                  max={65535}
                  value={cfg.sftpPort}
                  onChange={(e) => setField('sftpPort', Number(e.target.value))}
                  disabled={sftpRunning}
                />
              </div>
              <label className="fs-checkbox">
                <input
                  type="checkbox"
                  checked={cfg.sftpAllowWrite}
                  onChange={(e) => setField('sftpAllowWrite', e.target.checked)}
                  disabled={sftpRunning}
                />
                {t('panes.fileServer.allowWrite')}
              </label>
            </div>
            <div className="fs-row">
              <div className="fs-field">
                <label className="fs-label">{t('panes.fileServer.usernameLabel')}</label>
                <input
                  type="text"
                  className="fs-input"
                  value={cfg.sftpUsername}
                  onChange={(e) => setField('sftpUsername', e.target.value)}
                  placeholder={t('panes.fileServer.usernamePlaceholder')}
                  disabled={sftpRunning}
                  autoComplete="off"
                />
              </div>
              <div className="fs-field">
                <label className="fs-label">{t('panes.fileServer.passwordLabel')}</label>
                <input
                  type="password"
                  className="fs-input"
                  value={sftpPassword}
                  onChange={(e) => setSftpPassword(e.target.value)}
                  placeholder={t('panes.fileServer.passwordPlaceholder')}
                  disabled={sftpRunning}
                  autoComplete="new-password"
                />
              </div>
            </div>
            <div className="fs-actions">
              {sftpRunning ? (
                <button type="button" className="fs-btn fs-btn-stop" onClick={handleSftpStop}>
                  {t('panes.fileServer.stop')}
                </button>
              ) : (
                <button type="button" className="fs-btn fs-btn-start" onClick={handleSftpStart}>
                  {t('panes.fileServer.start')}
                </button>
              )}
            </div>
            {renderFirewall('sftp', cfg.sftpPort, sftpRunning)}
          </section>
        </div>

        {/* Transfer log */}
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
                      <td>
                        {tr.direction === 'upload'
                          ? t('panes.fileServer.dirUpload')
                          : t('panes.fileServer.dirDownload')}
                      </td>
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
