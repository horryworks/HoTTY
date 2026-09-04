import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

/** `label` overrides the "Terminal output" head — the connect envelopes reuse this block. */
export const TerminalOutputBlock: React.FC<{ cmd: string; output: string; label?: string }> = ({ cmd, output, label }) => {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);
    const firstLine = cmd.split('\n')[0];
    const cmdHasMoreLines = cmd.includes('\n');
    const trimmedOutput = output.replace(/\n+$/, '');
    const lineCount = trimmedOutput ? trimmedOutput.split('\n').length : 0;
    const charCount = trimmedOutput.length;
    const toggle = () => setExpanded((e) => !e);

    return (
        <div className={`ai-terminal-output-block${expanded ? ' expanded' : ''}`}>
            <div
                className="ai-terminal-output-header"
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                onClick={toggle}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggle();
                    }
                }}
            >
                <svg className="ai-terminal-output-chevron" viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                    <path d="M9 6l6 6-6 6z" />
                </svg>
                <span className="ai-terminal-output-label">{label ?? t('aiChat.outputBlock.label')}</span>
                <span className="ai-terminal-output-cmd">{firstLine}</span>
                <span className="ai-terminal-output-meta">{t('aiChat.outputBlock.meta', { lines: lineCount, chars: charCount })}</span>
            </div>
            {expanded && (
                <div className="ai-terminal-output-body">
                    {cmdHasMoreLines && (
                        <pre className="ai-terminal-output-cmd-full"><code>{cmd}</code></pre>
                    )}
                    {trimmedOutput.length === 0 ? (
                        <span className="ai-terminal-output-empty">{t('aiChat.outputBlock.empty')}</span>
                    ) : (
                        <pre><code>{trimmedOutput}</code></pre>
                    )}
                </div>
            )}
        </div>
    );
};
