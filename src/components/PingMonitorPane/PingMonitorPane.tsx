import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tauriService } from '../../services/tauriService';
import { usePingMonitorEvents, MAX_HISTORY } from '../../hooks/usePingMonitorEvents';
import { useSettingsStore } from '../../stores/settingsStore';
import { recallPaneMemory, useRememberPane } from '../../hooks/usePaneMemory';
import { BarSparkline, RunButton, RunStatus, Segmented } from '../PaneTools/PaneTools';
import { addTargets, parseTargets, summarize, timeOfDay } from './pingStats';
import type { PingResult } from '../../types/appTypes';
import './PingMonitorPane.css';

interface PingMonitorPaneProps {
  paneId: string;
  active: boolean;
  /** Opens Settings → General, where the log folder is chosen. */
  onOpenLogSettings?: () => void;
}

const INTERVAL_OPTIONS = [1000, 2000, 5000, 10000, 30000, 60000].map((value) => ({
  value,
  label: `${value / 1000}s`,
}));

type RowState = 'ok' | 'fail' | 'dns' | 'waiting' | 'idle';

function rowState(result: PingResult | undefined, running: boolean): RowState {
  if (!result) return running ? 'waiting' : 'idle';
  if (result.status === 'ok' || result.status === 'dns') return result.status;
  return 'fail';
}

export function PingMonitorPane({ paneId, active, onOpenLogSettings }: PingMonitorPaneProps) {
  const { t } = useTranslation();
  const saved = useSettingsStore((s) => s.pingMonitorConfig);
  const updateSettings = useSettingsStore((s) => s.update);
  // CSV logs land in the same folder as every other log (Settings → General).
  // The backend only writes to folders the user approved through a native
  // dialog, so the pane never takes a path of its own.
  const loggingPath = useSettingsStore((s) => s.loggingPath);

  // Kept across remounts: hiding the tab does not stop the monitor.
  const [targets, setTargets] = useState<string[]>(() => recallPaneMemory(paneId, 'targets', saved.targets));
  const [intervalMs, setIntervalMs] = useState(() => recallPaneMemory(paneId, 'interval', saved.intervalMs));
  const [running, setRunning] = useState(() => recallPaneMemory(paneId, 'running', false));
  const [logging, setLogging] = useState(() => recallPaneMemory(paneId, 'logging', false));
  useRememberPane(paneId, { 'targets': targets, 'interval': intervalMs, 'running': running, 'logging': logging });
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { latestResults, history, logFileName, clearLogFileName } = usePingMonitorEvents(paneId);

  // A new pane starts with the targets and interval the last one used.
  useEffect(() => {
    updateSettings('pingMonitorConfig', { targets, intervalMs });
  }, [targets, intervalMs, updateSettings]);

  /** Start the backend monitor. Returns false when it did not start. */
  const startMonitor = useCallback(async (list: string[], withLog: boolean): Promise<boolean> => {
    // The backend refuses to write CSV into a folder that was never approved
    // through a native dialog, so confirm it first — otherwise logging would
    // silently do nothing. An approved folder returns true without a prompt.
    let approved = false;
    if (withLog && loggingPath) {
      try {
        approved = await tauriService.confirmLogDir(loggingPath);
      } catch {
        approved = false;
      }
      if (!approved) {
        setLogging(false);
        setError(t('panes.pingMonitor.loggingDirDenied'));
      }
    }
    try {
      await tauriService.pingMonitorStart(paneId, list, intervalMs, approved, approved ? loggingPath : '');
      setRunning(true);
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  }, [paneId, intervalMs, loggingPath, t]);

  const handleStart = useCallback(async () => {
    if (targets.length === 0) {
      setError(t('panes.pingMonitor.errorNoTargets'));
      return;
    }
    setError(null);
    await startMonitor(targets, logging);
  }, [targets, logging, startMonitor, t]);

  const handleStop = useCallback(async () => {
    try {
      await tauriService.pingMonitorStop(paneId);
      setRunning(false);
    } catch (e) {
      setError(String(e));
    }
  }, [paneId]);

  /** Apply a new target list at once — while running the backend picks it up on the next round. */
  const applyTargets = useCallback(async (next: string[]) => {
    setTargets(next);
    if (!running) return;
    try {
      if (next.length === 0) {
        await tauriService.pingMonitorStop(paneId);
        setRunning(false);
      } else {
        await tauriService.pingMonitorUpdateTargets(paneId, next);
      }
    } catch (e) {
      setError(String(e));
    }
  }, [paneId, running]);

  const addFromText = useCallback((text: string) => {
    const added = parseTargets(text);
    if (added.length === 0) return;
    setError(null);
    void applyTargets(addTargets(targets, added));
  }, [targets, applyTargets]);

  const handleDraftKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    addFromText(draft);
    setDraft('');
  };

  // A one-line input would flatten a pasted list into one long word, so take
  // several targets straight from the clipboard.
  const handleDraftPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (!/[\s,]/.test(text.trim())) return;
    e.preventDefault();
    addFromText(draft + ' ' + text);
    setDraft('');
  };

  const handleInterval = useCallback(async (ms: number) => {
    setIntervalMs(ms);
    if (!running) return;
    try {
      await tauriService.pingMonitorUpdateInterval(paneId, ms);
    } catch (e) {
      setError(String(e));
    }
  }, [paneId, running]);

  // The backend decides about the CSV file when monitoring starts, so turning
  // it on or off while running restarts the monitor (a new file each time).
  const handleToggleLog = useCallback(async () => {
    if (!loggingPath) {
      onOpenLogSettings?.();
      return;
    }
    const next = !logging;
    setLogging(next);
    clearLogFileName();
    setError(null);
    if (!running) return;
    try {
      await tauriService.pingMonitorStop(paneId);
    } catch (e) {
      setError(String(e));
      return;
    }
    setRunning(false);
    await startMonitor(targets, next);
  }, [loggingPath, onOpenLogSettings, logging, running, paneId, startMonitor, targets, clearLogFileName]);

  const statusLabel = (state: RowState) => {
    switch (state) {
      case 'ok': return t('panes.pingMonitor.statusOk');
      case 'fail': return t('panes.pingMonitor.statusFail');
      case 'dns': return t('panes.pingMonitor.statusDns');
      case 'waiting': return t('panes.pingMonitor.statusWaiting');
      default: return '—';
    }
  };

  const recordLabel = logging && running
    ? (logFileName ? t('panes.pingMonitor.recordingFile', { file: logFileName }) : t('panes.pingMonitor.recording'))
    : t('panes.pingMonitor.recordCsv');

  return (
    <div className={`ping-monitor-pane${active ? ' active' : ''}`} data-pane-id={paneId}>
      <div className="ping-monitor-toolbar">
        <span className="ping-monitor-toolbar-title">{t('panes.pingMonitor.title')}</span>
        <span className="pt-label">{t('panes.pingMonitor.interval')}</span>
        <Segmented
          options={INTERVAL_OPTIONS}
          value={intervalMs}
          onChange={handleInterval}
          ariaLabel={t('panes.pingMonitor.interval')}
        />
        <button
          type="button"
          className={`ping-monitor-record${logging ? ' on' : ''}`}
          aria-pressed={logging}
          onClick={handleToggleLog}
          title={loggingPath ? (logFileName && logging ? logFileName : loggingPath) : t('panes.pingMonitor.setLogFolder')}
        >
          <span className="ping-monitor-record-dot" />
          {recordLabel}
        </button>
        <span className="ping-monitor-toolbar-spacer" />
        <RunStatus
          tone={running ? 'running' : 'stopped'}
          label={running ? t('panes.pingMonitor.running') : t('panes.pingMonitor.stopped')}
        />
        <RunButton
          running={running}
          startLabel={t('panes.pingMonitor.start')}
          stopLabel={t('panes.pingMonitor.stop')}
          onStart={handleStart}
          onStop={handleStop}
        />
      </div>

      {error && (
        <div className="ping-monitor-error" role="alert">
          <span>{error}</span>
          <button type="button" className="ping-monitor-error-close" onClick={() => setError(null)} aria-label={t('common.close')}>&times;</button>
        </div>
      )}

      <div className="ping-monitor-results">
        <table className="ping-monitor-table">
          <thead>
            <tr>
              <th>{t('panes.pingMonitor.thTarget')}</th>
              <th>{t('panes.pingMonitor.thStatus')}</th>
              <th>{t('panes.pingMonitor.thHistory', { count: MAX_HISTORY })}</th>
              <th className="num">{t('panes.pingMonitor.thRtt')}</th>
              <th className="num">{t('panes.pingMonitor.thLoss')}</th>
              <th className="num">{t('panes.pingMonitor.thAvg')}</th>
              <th className="num">{t('panes.pingMonitor.thTtl')}</th>
              <th>{t('panes.pingMonitor.thLastCheck')}</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {targets.map((target) => {
              const result = latestResults.get(target);
              const state = rowState(result, running);
              // A name that does not resolve was never pinged: no loss to report.
              const sum = state === 'dns' ? summarize(undefined) : summarize(history.get(target));
              return (
                <tr key={target} className={`ping-monitor-row ${state}`}>
                  <td className="ping-monitor-target">{target}</td>
                  <td>
                    <span className={`ping-monitor-state ${state}`}>
                      <span className="ping-monitor-state-dot" />
                      {statusLabel(state)}
                    </span>
                  </td>
                  <td>{result?.status === 'dns' ? '—' : <BarSparkline values={sum.bars} slots={MAX_HISTORY} />}</td>
                  <td className="num">{result?.rtt != null ? `${result.rtt} ms` : '—'}</td>
                  <td className={`num${sum.lossPct ? ' ping-monitor-loss' : ''}`}>{sum.lossPct === null ? '—' : `${sum.lossPct}%`}</td>
                  <td className="num">{sum.avgRtt === null ? '—' : `${sum.avgRtt} ms`}</td>
                  <td className="num">{result?.ttl ?? '—'}</td>
                  <td className="ping-monitor-time">{result ? timeOfDay(result.timestamp) : '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="ping-monitor-remove"
                      onClick={() => void applyTargets(targets.filter((x) => x !== target))}
                      title={t('panes.pingMonitor.remove')}
                      aria-label={t('panes.pingMonitor.removeTarget', { target })}
                    >
                      &times;
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={9}>
                <input
                  type="text"
                  className="ping-monitor-add"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={handleDraftKeyDown}
                  onPaste={handleDraftPaste}
                  placeholder={t('panes.pingMonitor.addPlaceholder')}
                  aria-label={t('panes.pingMonitor.addAria')}
                  spellCheck={false}
                />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
