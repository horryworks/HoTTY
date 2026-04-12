import { useCallback, useState } from 'react';
import { tauriService } from '../../services/tauriService';
import { usePingMonitorEvents } from '../../hooks/usePingMonitorEvents';
import './PingMonitorPane.css';

interface PingMonitorPaneProps {
  paneId: string;
  active: boolean;
}

function parseTargets(input: string): string[] {
  return input
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function PingMonitorPane({ paneId, active }: PingMonitorPaneProps) {
  const [targetInput, setTargetInput] = useState('');
  const [intervalMs, setIntervalMs] = useState(1000);
  const [running, setRunning] = useState(false);
  const [loggingEnabled, setLoggingEnabled] = useState(false);
  const [loggingPath, setLoggingPath] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { latestResults, logFileName } = usePingMonitorEvents(paneId);

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

  const handleUpdateInterval = useCallback(async () => {
    try {
      await tauriService.pingMonitorUpdateInterval(paneId, intervalMs);
    } catch (e) {
      setError(String(e));
    }
  }, [paneId, intervalMs]);

  const resultsArray = Array.from(latestResults.values());

  return (
    <div className={`ping-monitor-pane${active ? ' active' : ''}`} data-pane-id={paneId}>
      <div className="ping-monitor-toolbar">
        {running ? (
          <button type="button" className="ping-monitor-toolbar-btn ping-monitor-btn-stop" onClick={handleStop}>
            Stop
          </button>
        ) : (
          <button type="button" className="ping-monitor-toolbar-btn ping-monitor-btn-start" onClick={handleStart}>
            Start
          </button>
        )}
        <label className="ping-monitor-interval-label">
          Interval:
          <input
            type="number"
            className="ping-monitor-interval-input"
            value={intervalMs}
            onChange={(e) => setIntervalMs(Math.max(1000, parseInt(e.target.value) || 1000))}
            onBlur={() => { if (running) handleUpdateInterval(); }}
            min={1000}
            step={1000}
          />
          ms
        </label>
        <span className="ping-monitor-target-count">
          {resultsArray.length} target{resultsArray.length !== 1 ? 's' : ''}
        </span>
        {logFileName && (
          <span className="ping-monitor-log-indicator" title={logFileName}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            Logging
          </span>
        )}
      </div>

      <div className="ping-monitor-config">
        <div className="ping-monitor-config-row">
          <label className="ping-monitor-config-label">Targets (one per line or comma-separated):</label>
          <textarea
            className="ping-monitor-target-input"
            value={targetInput}
            onChange={(e) => setTargetInput(e.target.value)}
            onBlur={() => { if (running) handleUpdateTargets(); }}
            placeholder="8.8.8.8&#10;1.1.1.1&#10;example.com"
            rows={3}
          />
        </div>
        <div className="ping-monitor-config-row ping-monitor-logging-row">
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

      {error && <div className="ping-monitor-error">{error}</div>}

      <div className="ping-monitor-results-wrapper">
        <table className="ping-monitor-table">
          <thead>
            <tr>
              <th>Target</th>
              <th>Status</th>
              <th>RTT (ms)</th>
              <th>TTL</th>
              <th>Last Updated</th>
            </tr>
          </thead>
          <tbody>
            {resultsArray.map((r) => (
              <tr key={r.target} className={`ping-monitor-row ping-monitor-status-${r.status}`}>
                <td>{r.target}</td>
                <td className="ping-monitor-td-status">{r.status}</td>
                <td className="ping-monitor-td-rtt">{r.rtt !== null ? r.rtt : '—'}</td>
                <td className="ping-monitor-td-ttl">{r.ttl !== null ? r.ttl : '—'}</td>
                <td className="ping-monitor-td-time">{r.timestamp}</td>
              </tr>
            ))}
            {resultsArray.length === 0 && (
              <tr>
                <td colSpan={5} className="ping-monitor-empty">
                  {running ? 'Waiting for results...' : 'Configure targets and click Start'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
