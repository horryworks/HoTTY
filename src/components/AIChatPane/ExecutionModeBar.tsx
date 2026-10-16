import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import { Segmented } from '../PaneTools/PaneTools';
import { DockMenu } from '../Dock/DockMenu';
import './ExecutionModeBar.css';

interface ExecutionModeBarProps {
    paused: boolean;
    onPausedChange: (paused: boolean) => void;
    /** Deep-link to Settings → AI, where the classifier/whitelist/blacklist live. */
    onOpenSettings?: () => void;
}

type ExecutionMode = 'ask-before-execute' | 'auto-execute-safe';

const DEFAULT_MAX_WHEN_LIMITED = 5;

/**
 * How AI-proposed commands run, at the right end of the AI Chat toolbar — where
 * the tool panes show whether they are running. The mode is a `Segmented` pair
 * that takes effect at once. In auto mode a second button carries the run limit
 * (or "Paused") and opens the limit, pause and safety-settings controls.
 */
export const ExecutionModeBar: React.FC<ExecutionModeBarProps> = ({ paused, onPausedChange, onOpenSettings }) => {
    const { t } = useTranslation();
    const commandExecutionMode = useSettingsStore(s => s.commandExecutionMode);
    const maxConsecutiveAutoExecutions = useSettingsStore(s => s.maxConsecutiveAutoExecutions);

    const [popoverOpen, setPopoverOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);

    const isAuto = commandExecutionMode === 'auto-execute-safe';
    const isUnlimited = maxConsecutiveAutoExecutions <= 0;

    const setMode = (mode: ExecutionMode) => {
        // Leaving auto mode leaves nothing for the limit popover to hold.
        if (mode !== 'auto-execute-safe') setPopoverOpen(false);
        useSettingsStore.getState().update('commandExecutionMode', mode);
    };

    const setMax = (n: number) => {
        const clamped = Math.max(0, Math.min(100, Number.isFinite(n) ? Math.floor(n) : 0));
        useSettingsStore.getState().update('maxConsecutiveAutoExecutions', clamped);
    };

    const limitLabel = paused
        ? t('aiChat.executionMode.chipPausedTag')
        : t('aiChat.executionMode.limitButton', { max: isUnlimited ? '∞' : maxConsecutiveAutoExecutions });

    return (
        <div className="execution-mode-bar" data-testid="execution-mode-bar">
            <Segmented<ExecutionMode>
                options={[
                    { value: 'ask-before-execute', label: t('aiChat.executionMode.modeAsk') },
                    { value: 'auto-execute-safe', label: t('aiChat.executionMode.modeAuto') },
                ]}
                value={commandExecutionMode}
                onChange={setMode}
                ariaLabel={t('aiChat.executionMode.chipTitle')}
            />
            {isAuto && (
                <button
                    ref={triggerRef}
                    type="button"
                    className={`execution-mode-limit${paused ? ' paused' : ''}${popoverOpen ? ' open' : ''}`}
                    onClick={() => setPopoverOpen(o => !o)}
                    aria-haspopup="dialog"
                    aria-expanded={popoverOpen}
                    title={t('aiChat.executionMode.popoverAriaLabel')}
                >
                    {paused && (
                        <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true">
                            <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
                        </svg>
                    )}
                    <span>{limitLabel}</span>
                    <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true">
                        <path d="M6 9l6 6 6-6z" />
                    </svg>
                </button>
            )}

            {isAuto && (
                <DockMenu
                    open={popoverOpen}
                    onClose={() => setPopoverOpen(false)}
                    anchorRef={triggerRef}
                    placement="down"
                    className="execution-mode-popover"
                    role="dialog"
                    aria-label={t('aiChat.executionMode.popoverAriaLabel')}
                >
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
                                    onChange={(e) => setMax(e.target.checked ? 0 : DEFAULT_MAX_WHEN_LIMITED)}
                                />
                                <span>∞</span>
                            </label>
                        </span>
                    </label>
                    <div className="execution-mode-popover-divider" />
                    <button
                        type="button"
                        className={`execution-mode-popover-pause${paused ? ' paused' : ''}`}
                        onClick={() => onPausedChange(!paused)}
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
                </DockMenu>
            )}
        </div>
    );
};
