import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import './ExecutionModeBar.css';

interface ExecutionModeBarProps {
    paused: boolean;
    onPausedChange: (paused: boolean) => void;
    /** Deep-link to Settings → AI, where the classifier/whitelist/blacklist live. */
    onOpenSettings?: () => void;
}

const DEFAULT_MAX_WHEN_LIMITED = 5;

export const ExecutionModeBar: React.FC<ExecutionModeBarProps> = ({ paused, onPausedChange, onOpenSettings }) => {
    const { t } = useTranslation();
    const commandExecutionMode = useSettingsStore(s => s.commandExecutionMode);
    const maxConsecutiveAutoExecutions = useSettingsStore(s => s.maxConsecutiveAutoExecutions);

    const [popoverOpen, setPopoverOpen] = useState(false);
    const popoverRef = useRef<HTMLDivElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);

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

    const handleUnlimitedChange = (checked: boolean) => {
        setMax(checked ? 0 : DEFAULT_MAX_WHEN_LIMITED);
    };

    const handlePauseToggle = () => {
        onPausedChange(!paused);
    };

    const chipLabel = isAuto
        ? t('aiChat.executionMode.chipAuto', { max: isUnlimited ? '∞' : maxConsecutiveAutoExecutions })
        : t('aiChat.executionMode.chipAskBeforeExecute');

    const chipClass = [
        'execution-mode-chip',
        isAuto ? 'auto' : 'ask',
        paused ? 'paused' : '',
    ].filter(Boolean).join(' ');

    return (
        <div className="execution-mode-chip-wrap" data-testid="execution-mode-bar">
            <button
                ref={triggerRef}
                type="button"
                className={chipClass}
                onClick={() => setPopoverOpen(o => !o)}
                aria-haspopup="dialog"
                aria-expanded={popoverOpen}
                aria-label={paused
                    ? t('aiChat.executionMode.chipAriaLabelPaused', { label: chipLabel })
                    : t('aiChat.executionMode.chipAriaLabel', { label: chipLabel })}
                title={t('aiChat.executionMode.chipTitle')}
            >
                {isAuto ? (
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
                        <path d="M7 2v11h3v9l7-12h-4l4-8z" />
                    </svg>
                ) : (
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                )}
                <span className="execution-mode-chip-label">{chipLabel}</span>
                {paused && <span className="execution-mode-chip-paused-tag">{t('aiChat.executionMode.chipPausedTag')}</span>}
            </button>

            {popoverOpen && (
                <div
                    ref={popoverRef}
                    className="execution-mode-popover"
                    role="dialog"
                    aria-label={t('aiChat.executionMode.popoverAriaLabel')}
                >
                    <div className="execution-mode-popover-title">{t('aiChat.executionMode.popoverTitle')}</div>

                    <button
                        type="button"
                        className={`execution-mode-popover-option${!isAuto ? ' selected' : ''}`}
                        role="radio"
                        aria-checked={!isAuto}
                        onClick={() => setMode('ask-before-execute')}
                    >
                        <span className={`execution-mode-popover-radio${!isAuto ? ' selected' : ''}`} />
                        <span className="execution-mode-popover-option-text">
                            <span className="execution-mode-popover-option-title">{t('aiChat.executionMode.askOptionTitle')}</span>
                            <span className="execution-mode-popover-option-desc">{t('aiChat.executionMode.askOptionDesc')}</span>
                        </span>
                    </button>

                    <button
                        type="button"
                        className={`execution-mode-popover-option${isAuto ? ' selected' : ''}`}
                        role="radio"
                        aria-checked={isAuto}
                        onClick={() => setMode('auto-execute-safe')}
                    >
                        <span className={`execution-mode-popover-radio${isAuto ? ' selected' : ''}`} />
                        <span className="execution-mode-popover-option-text">
                            <span className="execution-mode-popover-option-title">{t('aiChat.executionMode.autoOptionTitle')}</span>
                            <span className="execution-mode-popover-option-desc">{t('aiChat.executionMode.autoOptionDesc')}</span>
                        </span>
                    </button>

                    {isAuto && (
                        <>
                            <div className="execution-mode-popover-divider" />
                            <label className="execution-mode-popover-label">
                                <span>{t('aiChat.executionMode.maxConsecutiveRuns')}</span>
                                <span className="execution-mode-popover-max-row">
                                    <input
                                        type="number"
                                        min={0}
                                        max={100}
                                        step={1}
                                        value={maxConsecutiveAutoExecutions}
                                        onChange={(e) => setMax(parseInt(e.target.value, 10))}
                                        disabled={isUnlimited}
                                        aria-label={t('aiChat.executionMode.maxConsecutiveRuns')}
                                    />
                                    <label className="execution-mode-popover-checkbox">
                                        <input
                                            type="checkbox"
                                            checked={isUnlimited}
                                            onChange={(e) => handleUnlimitedChange(e.target.checked)}
                                        />
                                        <span>∞</span>
                                    </label>
                                </span>
                            </label>
                            <p className="execution-mode-popover-hint">
                                {t('aiChat.executionMode.maxConsecutiveRunsHint')}
                            </p>
                            <div className="execution-mode-popover-divider" />
                            <button
                                type="button"
                                className={`execution-mode-popover-pause${paused ? ' paused' : ''}`}
                                onClick={handlePauseToggle}
                            >
                                {paused ? (
                                    <>
                                        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
                                            <path d="M8 5v14l11-7z" />
                                        </svg>
                                        <span>{t('aiChat.executionMode.resumeAutoExecution')}</span>
                                    </>
                                ) : (
                                    <>
                                        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
                                            <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
                                        </svg>
                                        <span>{t('aiChat.executionMode.pauseAutoExecution')}</span>
                                    </>
                                )}
                            </button>
                        </>
                    )}

                    {onOpenSettings && (
                        <>
                            <div className="execution-mode-popover-divider" />
                            <button
                                type="button"
                                className="execution-mode-popover-settings-link"
                                onClick={() => { setPopoverOpen(false); onOpenSettings(); }}
                            >
                                {t('aiChat.executionMode.moreSafetySettings')}
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};
