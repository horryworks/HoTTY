import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as electronService from '../../services/electronService';
import { useSettingsStore } from '../../stores/settingsStore';
import { useShallow } from 'zustand/react/shallow';
import './PingMonitorPane.css';

interface PingResult {
    target: string;
    status: string;
    rtt: number | null;
    ttl: number | null;
    timestamp: string;
}

interface PingMonitorPaneProps {
    sessionId: string;
    initialState?: {
        targets: string;
        intervalSeconds: number;
        isRunning: boolean;
    };
    onStateChange?: (newState: { targets?: string; intervalSeconds?: number; isRunning?: boolean }) => void;
}

const INTERVAL_OPTIONS = [
    { value: 1, label: '1s' },
    { value: 3, label: '3s' },
    { value: 5, label: '5s' },
    { value: 10, label: '10s' },
    { value: 30, label: '30s' },
    { value: 60, label: '60s' },
];

function parseTargets(text: string): string[] {
    return text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'));
}

function extractTime(timestamp: string): string {
    // "2026-03-21 12:30:15.123" -> "12:30:15"
    const match = timestamp.match(/(\d{2}:\d{2}:\d{2})/);
    return match ? match[1] : '';
}

export const PingMonitorPane: React.FC<PingMonitorPaneProps> = React.memo(({
    sessionId,
    initialState,
    onStateChange,
}) => {
    const { loggingEnabled, loggingPath } = useSettingsStore(useShallow(s => ({
        loggingEnabled: s.loggingEnabled,
        loggingPath: s.loggingPath,
    })));

    const [targets, setTargets] = useState(initialState?.targets ?? '');
    const [intervalSeconds, setIntervalSeconds] = useState(initialState?.intervalSeconds ?? 5);
    const [isRunning, setIsRunning] = useState(initialState?.isRunning ?? false);
    const [results, setResults] = useState<PingResult[]>([]);
    const [logFileName, setLogFileName] = useState('');
    const [editorCollapsed, setEditorCollapsed] = useState(false);

    const targetsRef = useRef(targets);
    const isRunningRef = useRef(isRunning);

    // Keep refs in sync
    useEffect(() => { targetsRef.current = targets; }, [targets]);
    useEffect(() => { isRunningRef.current = isRunning; }, [isRunning]);

    // Persist state changes to session
    const handleTargetsChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newTargets = e.target.value;
        setTargets(newTargets);
        onStateChange?.({ targets: newTargets });

        // Update targets in running monitor
        if (isRunningRef.current) {
            const parsed = parseTargets(newTargets);
            electronService.pingMonitorUpdateTargets(sessionId, parsed);
        }
    }, [sessionId, onStateChange]);

    const handleIntervalChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
        const newInterval = parseInt(e.target.value, 10);
        setIntervalSeconds(newInterval);
        onStateChange?.({ intervalSeconds: newInterval });

        // Update interval in running monitor
        if (isRunningRef.current) {
            electronService.pingMonitorUpdateInterval(sessionId, newInterval * 1000);
        }
    }, [sessionId, onStateChange]);

    const handleStart = useCallback(() => {
        const parsed = parseTargets(targetsRef.current);
        if (parsed.length === 0) return;

        electronService.pingMonitorStart(
            sessionId,
            parsed,
            intervalSeconds * 1000,
            loggingEnabled,
            loggingPath,
        );
        setIsRunning(true);
        onStateChange?.({ isRunning: true });

        // Set initial pending results
        setResults(parsed.map(t => ({
            target: t,
            status: 'pending',
            rtt: null,
            ttl: null,
            timestamp: '',
        })));
    }, [sessionId, intervalSeconds, loggingEnabled, loggingPath, onStateChange]);

    const handleStop = useCallback(() => {
        electronService.pingMonitorStop(sessionId);
        setIsRunning(false);
        onStateChange?.({ isRunning: false });
    }, [sessionId, onStateChange]);

    // Listen for ping results
    useEffect(() => {
        const cleanup = electronService.onPingMonitorData((data) => {
            if (data.sessionId === sessionId) {
                setResults(data.results);
            }
        });
        return cleanup;
    }, [sessionId]);

    // Listen for log file name
    useEffect(() => {
        const cleanup = electronService.onPingMonitorLogFile((data) => {
            if (data.sessionId === sessionId) {
                setLogFileName(data.fileName);
            }
        });
        return cleanup;
    }, [sessionId]);

    const targetCount = parseTargets(targets).length;
    const okCount = results.filter(r => r.status === 'ok').length;
    const failCount = results.filter(r => r.status === 'fail').length;
    const dnsCount = results.filter(r => r.status === 'dns').length;

    return (
        <div className="ping-monitor-pane">
            {/* Control Bar */}
            <div className="ping-monitor-control-bar">
                <span className="ping-monitor-control-bar-title">Ping Monitor</span>
                <div style={{ flex: 1 }} />
                <div className="ping-monitor-control-group">
                    <span className="ping-monitor-label">Interval:</span>
                    <select
                        className="ping-monitor-select"
                        value={intervalSeconds}
                        onChange={handleIntervalChange}
                    >
                        {INTERVAL_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                </div>
                {!isRunning ? (
                    <button
                        className="ping-monitor-btn ping-monitor-btn-start"
                        onClick={handleStart}
                        disabled={targetCount === 0}
                        title="Start monitoring"
                    >
                        &#9654; Start
                    </button>
                ) : (
                    <button
                        className="ping-monitor-btn ping-monitor-btn-stop"
                        onClick={handleStop}
                        title="Stop monitoring"
                    >
                        &#9632; Stop
                    </button>
                )}
            </div>

            {/* Body */}
            <div className="ping-monitor-body">
                {/* Targets Editor */}
                <div className={`ping-monitor-editor${editorCollapsed ? ' collapsed' : ''}`}>
                    <div className="ping-monitor-editor-header">
                        <span>Targets</span>
                        <span>{targetCount} target{targetCount !== 1 ? 's' : ''}</span>
                    </div>
                    <textarea
                        className="ping-monitor-textarea"
                        value={targets}
                        onChange={handleTargetsChange}
                        placeholder={"# Enter one target per line\n# Lines starting with # are comments\n192.168.1.1\ngoogle.com\n10.0.0.1"}
                        spellCheck={false}
                    />
                </div>

                {/* Editor collapse tab */}
                <button
                    className="ping-monitor-editor-toggle"
                    onClick={() => setEditorCollapsed(!editorCollapsed)}
                    title={editorCollapsed ? 'Expand target list' : 'Collapse target list'}
                >
                    {editorCollapsed ? '\u203A' : '\u2039'}
                </button>

                {/* Results Table */}
                <div className="ping-monitor-results">
                    {results.length === 0 ? (
                        <div className="ping-monitor-empty">
                            {targetCount === 0
                                ? 'Enter targets in the editor and click Start'
                                : 'Click Start to begin monitoring'}
                        </div>
                    ) : (
                        <div className="ping-monitor-table-wrap">
                            <table className="ping-monitor-table">
                                <thead>
                                    <tr>
                                        <th className="col-num">#</th>
                                        <th className="col-target">Target</th>
                                        <th className="col-status">Status</th>
                                        <th className="col-rtt">RTT</th>
                                        <th className="col-ttl">TTL</th>
                                        <th className="col-time">Last Check</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {results.map((r, i) => (
                                        <tr key={r.target}>
                                            <td className="col-num">{i + 1}</td>
                                            <td className="col-target">{r.target}</td>
                                            <td className="col-status">
                                                <span className={`ping-status-${r.status}`}>
                                                    {r.status === 'ok' ? 'OK' : r.status === 'dns' ? 'DNS failed' : r.status === 'fail' ? 'FAIL' : '...'}
                                                </span>
                                            </td>
                                            <td className="col-rtt">
                                                {r.rtt !== null ? `${r.rtt}ms` : '\u2014'}
                                            </td>
                                            <td className="col-ttl">
                                                {r.ttl !== null ? r.ttl : '\u2014'}
                                            </td>
                                            <td className="col-time">
                                                {r.timestamp ? extractTime(r.timestamp) : ''}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            {/* Status Bar */}
            <div className="ping-monitor-status-bar">
                <div className="ping-monitor-status-item">
                    <span className={`ping-monitor-status-dot ${isRunning ? 'running' : 'stopped'}`} />
                    {isRunning ? 'Monitoring' : 'Stopped'}
                </div>
                <div className="ping-monitor-status-item">
                    {targetCount} target{targetCount !== 1 ? 's' : ''}
                </div>
                {isRunning && results.length > 0 && (
                    <>
                        <div className="ping-monitor-status-item">
                            <span className="ping-status-ok">{okCount}</span> OK
                        </div>
                        {failCount > 0 && (
                            <div className="ping-monitor-status-item">
                                <span className="ping-status-fail">{failCount}</span> FAIL
                            </div>
                        )}
                        {dnsCount > 0 && (
                            <div className="ping-monitor-status-item">
                                <span className="ping-status-dns">{dnsCount}</span> DNS failed
                            </div>
                        )}
                    </>
                )}
                <div className="ping-monitor-status-item">
                    Interval: {intervalSeconds}s
                </div>
                {logFileName && (
                    <div className="ping-monitor-status-item" style={{ opacity: 0.7 }}>
                        Log: {logFileName}
                    </div>
                )}
            </div>
        </div>
    );
});
