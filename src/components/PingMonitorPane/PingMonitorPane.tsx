import { useCallback, useRef, useState } from 'react';
import { tauriService } from '../../services/tauriService';
import { usePingMonitorEvents } from '../../hooks/usePingMonitorEvents';
import { useResize } from '../../hooks/useResize';
import './PingMonitorPane.css';

interface PingMonitorPaneProps {
  paneId: string;
  active: boolean;
}

const INTERVAL_OPTIONS = [
  { label: '1s', value: 1000 },
  { label: '2s', value: 2000 },
  { label: '5s', value: 5000 },
  { label: '10s', value: 10000 },
  { label: '30s', value: 30000 },
  { label: '60s', value: 60000 },
];

const MIN_PANEL_RATIO = 0.15;
const MAX_PANEL_RATIO = 0.6;
const DEFAULT_PANEL_RATIO = 0.3;

function parseTargets(input: string): string[] {
  return input
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function formatIntervalLabel(ms: number): string {
  const opt = INTERVAL_OPTIONS.find((o) => o.value === ms);
  return opt ? opt.label : `${ms / 1000}s`;
}

export function PingMonitorPane({ paneId, active }: PingMonitorPaneProps) {
  const [targetInput, setTargetInput] = useState('');
  const [intervalMs, setIntervalMs] = useState(5000);
  const [running, setRunning] = useState(false);
  const [loggingEnabled, setLoggingEnabled] = useState(false);
  const [loggingPath, setLoggingPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [panelRatio, setPanelRatio] = useState(DEFAULT_PANEL_RATIO);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const ratioBeforeCollapse = useRef(DEFAULT_PANEL_RATIO);

  const { latestResults, logFileName } = usePingMonitorEvents(paneId);

  const { startResize } = useResize({
    orientation: 'horizontal',
    onMove: (dx) => {
      setPanelRatio((prev) => {
        const bodyW = bodyRef.current?.clientWidth ?? 600;
        const delta = dx / bodyW;
        return Math.max(MIN_PANEL_RATIO, Math.min(MAX_PANEL_RATIO, prev + delta));
      });
    },
  });

  const toggleCollapse = useCallback(() => {
    setPanelCollapsed((prev) => {
      if (!prev) {
        ratioBeforeCollapse.current = panelRatio;
      } else {
        setPanelRatio(ratioBeforeCollapse.current);
      }
      return !prev;
    });
  }, [panelRatio]);

  const handleStart = useCallback(async () => {
    const targets = parseTargets(targetInput);
    if (targets.length === 0) {
      setError('Enter at least one target');
      return;
    }
    setError(null);
    try {
      await tauriService.pingMonitorStart(paneId, targets, intervalMs, loggingEnabled, loggingPath);
      setRunning(true);
    } catch (e) {
      setError(String(e));
    }
  }, [paneId, targetInput, intervalMs, loggingEnabled, loggingPath]);

  const handleStop = useCallback(async () => {
    try {
      await tauriService.pingMonitorStop(paneId);
      setRunning(false);
    } catch (e) {
      setError(String(e));
    }
  }, [paneId]);

  const handleUpdateTargets = useCallback(async () => {
    const targets = parseTargets(targetInput);
    if (targets.length === 0) return;
    try {
      await tauriService.pingMonitorUpdateTargets(paneId, targets);
    } catch (e) {
      setError(String(e));
    }
  }, [paneId, targetInput]);

  const handleUpdateInterval = useCallback(async (newMs: number) => {
    setIntervalMs(newMs);
    if (running) {
      try {
        await tauriService.pingMonitorUpdateInterval(paneId, newMs);
      } catch (e) {
        setError(String(e));
      }
    }
  }, [paneId, running]);

  const resultsArray = Array.from(latestResults.values());
  const targetCount = running ? resultsArray.length : parseTargets(targetInput).length;

  return (
    <div className={`ping-monitor-pane${active ? ' active' : ''}`} data-pane-id={paneId}>
      <div className="ping-monitor-toolbar">
        <span className="ping-monitor-toolbar-title">Ping Monitor</span>
        {logFileName && (
          <span className="ping-monitor-log-indicator" title={logFileName}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            Logging
          </span>
        )}
        <span className="ping-monitor-toolbar-spacer" />
        <label className="ping-monitor-interval-label">
          Interval:
          <select
            className="ping-monitor-interval-select"
            value={intervalMs}
            onChange={(e) => handleUpdateInterval(Number(e.target.value))}
          >
            {INTERVAL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
        {running ? (
          <button type="button" className="ping-monitor-toolbar-btn ping-monitor-btn-stop" onClick={handleStop}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect width="10" height="10" rx="1" /></svg>
            Stop
          </button>
        ) : (
          <button type="button" className="ping-monitor-toolbar-btn ping-monitor-btn-start" onClick={handleStart}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><polygon points="0,0 10,5 0,10" /></svg>
            Start
          </button>
        )}
      </div>

      {error && <div className="ping-monitor-error">{error}</div>}

      <div className="ping-monitor-body" ref={bodyRef}>
        {!panelCollapsed && (
          <div className="ping-monitor-targets-panel" style={{ width: `${panelRatio * 100}%` }}>
            <div className="ping-monitor-targets-header">
              <span className="ping-monitor-targets-title">Targets</span>
              <span className="ping-monitor-targets-count">{targetCount} target{targetCount !== 1 ? 's' : ''}</span>
            </div>
            <textarea
              className="ping-monitor-target-input"
              value={targetInput}
              onChange={(e) => setTargetInput(e.target.value)}
              onBlur={() => { if (running) handleUpdateTargets(); }}
              placeholder="8.8.8.8&#10;1.1.1.1&#10;example.com"
            />
            <div className="ping-monitor-logging-section">
              <label className="ping-monitor-logging-toggle">
                <input
                  type="checkbox"
                  checked={loggingEnabled}
                  onChange={(e) => setLoggingEnabled(e.target.checked)}
                  disabled={running}
                />
                CSV Logging
              </label>
              {loggingEnabled && (
                <input
                  type="text"
                  className="ping-monitor-logging-path"
                  value={loggingPath}
                  onChange={(e) => setLoggingPath(e.target.value)}
                  placeholder="Log folder path..."
                  disabled={running}
                />
              )}
            </div>
          </div>
        )}

        <div className="ping-monitor-divider">
          <div className="ping-monitor-divider-handle" onMouseDown={startResize} />
          <button
            type="button"
            className={`ping-monitor-divider-toggle${panelCollapsed ? ' collapsed' : ''}`}
            onClick={toggleCollapse}
            title={panelCollapsed ? 'Show targets panel' : 'Hide targets panel'}
          >
            <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor">
              <path d={panelCollapsed ? 'M2 0l6 6-6 6z' : 'M6 0L0 6l6 6z'} />
            </svg>
          </button>
        </div>

        <div className="ping-monitor-results-panel">
          {resultsArray.length > 0 ? (
            <div className="ping-monitor-results-wrapper">
              <table className="ping-monitor-table">
                <thead>
                  <tr>
                    <th className="ping-monitor-th-num">#</th>
                    <th>Target</th>
                    <th>Status</th>
                    <th>RTT</th>
                    <th>TTL</th>
                    <th>Last Check</th>
                  </tr>
                </thead>
                <tbody>
                  {resultsArray.map((r, idx) => (
                    <tr key={r.target} className={`ping-monitor-row ping-monitor-status-${r.status}`}>
                      <td className="ping-monitor-td-num">{idx + 1}</td>
                      <td>{r.target}</td>
                      <td className="ping-monitor-td-status">{r.status}</td>
                      <td className="ping-monitor-td-rtt">{r.rtt !== null ? `${r.rtt}ms` : '\u2014'}</td>
                      <td className="ping-monitor-td-ttl">{r.ttl !== null ? r.ttl : '\u2014'}</td>
                      <td className="ping-monitor-td-time">{r.timestamp ? r.timestamp.split(' ').pop()?.split('.')[0] ?? r.timestamp : '\u2014'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="ping-monitor-placeholder">
              {running ? 'Waiting for results...' : 'Enter targets in the editor and click Start'}
            </div>
          )}
        </div>
      </div>

      <div className="ping-monitor-statusbar">
        <span className={`ping-monitor-status-dot ${running ? 'running' : 'stopped'}`} />
        <span className="ping-monitor-status-label">{running ? 'Running' : 'Stopped'}</span>
        <span className="ping-monitor-status-info">{targetCount} target{targetCount !== 1 ? 's' : ''}</span>
        <span className="ping-monitor-status-info">Interval: {formatIntervalLabel(intervalMs)}</span>
        {logFileName && <span className="ping-monitor-status-info">Log: {logFileName}</span>}
      </div>
    </div>
  );
}
