import { useTranslation } from 'react-i18next';

/** Above these fractions the ring turns to warning / danger colour. */
const WARN_AT = 0.8;
const DANGER_AT = 0.95;

interface ContextGaugeProps {
    /** Tokens the conversation takes up now. */
    used: number;
    /** The model's context window in tokens. */
    limit: number;
}

/**
 * A small pie (donut) showing how full the model's context window is,
 * with the percentage beside it; exact counts are in the tooltip.
 */
export function ContextGauge({ used, limit }: ContextGaugeProps) {
    const { t } = useTranslation();
    const ratio = Math.min(used / limit, 1);
    const pct = Math.round(ratio * 100);
    const level = ratio >= DANGER_AT ? 'danger' : ratio >= WARN_AT ? 'warn' : 'ok';
    const label = t('aiChat.pane.contextUsage', {
        used: used.toLocaleString(),
        limit: limit.toLocaleString(),
        pct,
    });
    return (
        <span className={`ai-chat-context ai-chat-context--${level}`} title={label} aria-label={label} role="img">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <circle className="ai-chat-context-track" cx="7" cy="7" r="5" />
                <circle
                    className="ai-chat-context-fill"
                    cx="7" cy="7" r="5"
                    pathLength={100}
                    strokeDasharray={`${ratio * 100} 100`}
                    transform="rotate(-90 7 7)"
                />
            </svg>
            {pct}%
        </span>
    );
}
