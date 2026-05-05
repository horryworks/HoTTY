import React, { useEffect, useRef, useState } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import './ExecutionModeBar.css';

interface ExecutionModeBarProps {
    paused: boolean;
    onPausedChange: (paused: boolean) => void;
}

const DEFAULT_MAX_WHEN_LIMITED = 5;

export const ExecutionModeBar: React.FC<ExecutionModeBarProps> = ({ paused, onPausedChange }) => {
    const commandExecutionMode = useSettingsStore(s => s.commandExecutionMode);
    const maxConsecutiveAutoExecutions = useSettingsStore(s => s.maxConsecutiveAutoExecutions);

    const [popoverOpen, setPopoverOpen] = useState(false);
    const popoverRef = useRef<HTMLDivElement | null>(null);
    const triggerRef = useRef<HTMLSpanElement | null>(null);

    const isAuto = commandExecutionMode === 'auto-execute-safe';
    const isUnlimited = maxConsecutiveAutoExecutions <= 0;

    useEffect(() => {
        if (!popoverOpen) return;
        const onMouseDown = (e: MouseEvent) => {
            const target = e.target as Node;
            if (popoverRef.current?.contains(target)) return;
            if (triggerRef.current?.contains(target)) return;
            setPopoverOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setPopoverOpen(false);
        };
        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [popoverOpen]);

    const setMode = (mode: 'ask-before-execute' | 'auto-execute-safe') => {
        useSettingsStore.getState().update('commandExecutionMode', mode);
    };

    const setMax = (n: number) => {
        const clamped = Math.max(0, Math.min(100, Number.isFinite(n) ? Math.floor(n) : 0));
        useSettingsStore.getState().update('maxConsecutiveAutoExecutions', clamped);
    };

    const handleAskClick = () => {
        if (commandExecutionMode !== 'ask-before-execute') {
            setMode('ask-before-execute');
        }
    };

    const handleAutoClick = () => {
        if (commandExecutionMode !== 'auto-execute-safe') {
            setMode('auto-execute-safe');
        }
    };

    const handleBadgeClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!isAuto) {
            setMode('auto-execute-safe');
        }
        setPopoverOpen(prev => !prev);
    };

    const handlePauseToggle = () => {
        onPausedChange(!paused);
    };

    const handleUnlimitedChange = (checked: boolean) => {
        setMax(checked ? 0 : DEFAULT_MAX_WHEN_LIMITED);
    };

    const maxLabel = isUnlimited ? '∞' : String(maxConsecutiveAutoExecutions);

    return (
        <div
            className={`execution-mode-bar${paused ? ' paused' : ''}`}
            data-testid="execution-mode-bar"
            role="group"
            aria-label="AI command execution mode"
        >
            <button
                type="button"
                className={`execution-mode-pill${!isAuto ? ' active' : ''}`}
                onClick={handleAskClick}
                aria-pressed={!isAuto}
                title="Require manual confirmation before running AI-suggested commands"
            >
                Ask before execute
            </button>

            <button
                type="button"
                className={`execution-mode-pill execution-mode-pill--auto${isAuto ? ' active' : ''}`}
                onClick={handleAutoClick}
                aria-pressed={isAuto}
                title="Automatically run safe (read-only) AI-suggested commands"
            >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                    <path d="M7 2v11h3v9l7-12h-4l4-8z" />
                </svg>
                <span className="execution-mode-pill-label">Auto-execute safe commands</span>
                <span
                    ref={triggerRef}
                    className="execution-mode-max-badge"
                    onClick={handleBadgeClick}
                    role="button"
                    tabIndex={0}
                    aria-label={`Max consecutive auto-executions: ${isUnlimited ? 'unlimited' : maxConsecutiveAutoExecutions}`}
                    aria-haspopup="dialog"
                    aria-expanded={popoverOpen}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleBadgeClick(e as unknown as React.MouseEvent);
                        }
                    }}
                >
                    Max: {maxLabel}
                </span>
            </button>

            {isAuto && (
                <button
                    type="button"
                    className={`execution-mode-kill${paused ? ' paused' : ''}${isUnlimited ? ' unlimited' : ''}`}
                    onClick={handlePauseToggle}
                    aria-pressed={paused}
                    title={paused ? 'Resume auto-execution' : 'Pause auto-execution and abort current AI stream'}
                >
                    {paused ? (
                        <>
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
                                <path d="M8 5v14l11-7z" />
                            </svg>
                            <span>Resume</span>
                        </>
                    ) : (
                        <>
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
                                <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
                            </svg>
                            <span>Pause</span>
                        </>
                    )}
                </button>
            )}

            {paused && isAuto && (
                <span className="execution-mode-paused-banner">Auto-execution paused</span>
            )}

            {popoverOpen && (
                <div
                    ref={popoverRef}
                    className="execution-mode-popover"
                    role="dialog"
                    aria-label="Configure max consecutive auto-executions"
                >
                    <label className="execution-mode-popover-label">
                        Max consecutive runs
                        <input
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            value={maxConsecutiveAutoExecutions}
                            onChange={(e) => setMax(parseInt(e.target.value, 10))}
                            disabled={isUnlimited}
                            aria-label="Max consecutive runs"
                        />
                    </label>
                    <label className="execution-mode-popover-checkbox">
                        <input
                            type="checkbox"
                            checked={isUnlimited}
                            onChange={(e) => handleUnlimitedChange(e.target.checked)}
                        />
                        <span>Unlimited (∞)</span>
                    </label>
                    <p className="execution-mode-popover-hint">
                        After this many auto-runs in a row, commands require manual confirmation.
                    </p>
                </div>
            )}
        </div>
    );
};
