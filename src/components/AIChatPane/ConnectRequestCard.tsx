import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConnectParseResult, ResolvedConnect } from '../../utils/aiConnectRequest';
import { describeParseErrors } from '../../utils/aiConnectRequest';
import type { ConnectBlock } from '../../utils/connectRequestReducer';
import type { ConnectEnvelope } from './terminalOutputUtils';
import type { AiLocalShellType } from '../../types/appTypes';

/**
 * The in-chat card for an AI `connect` request (ADR-AI-007).
 *
 * Shows WHAT the AI wants to open (target, login name, where the credentials
 * would come from, its stated reason) and offers the human decision — Open /
 * Don't open / Open in connection dialog — or the auto-open countdown. This is
 * the confirmation itself, rendered in place (no modal): a request is
 * supplementary information attached to the conversation, and the buttons ARE
 * the confirm step.
 *
 * Final states (opened / failed / declined / refused) come from the transcript
 * envelope (`outcome`), not from React state, so they survive re-renders and tab
 * switches; only the transient states (asking / scheduled / opening / dialog)
 * come from the reducer (`block`).
 */
export interface ConnectRequestCardProps {
    /** Raw fence body — shown when the request is still streaming or malformed. */
    body: string;
    /** Parse result of a closed fence; undefined while streaming. */
    parse?: ConnectParseResult;
    /** Transient state from the connect reducer (undefined until evaluated). */
    block?: ConnectBlock;
    /** Final outcome from the transcript, once an envelope for this request exists. */
    outcome?: ConnectEnvelope;
    /** `aiConnectPolicy === 'off'` — render inert. */
    policyOff?: boolean;
    localShellType: AiLocalShellType;
    onOpen?: () => void;
    onOpenInDialog?: () => void;
    onDecline?: () => void;
    onCancelSchedule?: () => void;
    /** Materialize the opened worker (by alias) into a real tab. */
    onOpenAsTab?: (alias: string) => void;
    /** True when the alias in `outcome` is still a live WORKER (so "Open as tab" applies). */
    canOpenAsTab?: (alias: string) => boolean;
}

const SHELL_LABEL_KEY: Record<AiLocalShellType, string> = {
    powershell: 'aiChat.connect.shellPowershell',
    cmd: 'aiChat.connect.shellCmd',
    'git-bash': 'aiChat.connect.shellGitBash',
};

/** Live "⏳ Opening in Ns…" countdown for an auto-open in its grace window. */
const AutoOpenCountdown: React.FC<{ runAt: number }> = ({ runAt }) => {
    const { t } = useTranslation();
    const compute = () => Math.max(0, Math.ceil((runAt - Date.now()) / 1000));
    const [remaining, setRemaining] = useState(compute);
    useEffect(() => {
        setRemaining(compute());
        const id = setInterval(() => setRemaining(compute()), 250);
        return () => clearInterval(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [runAt]);
    return (
        <div className="ai-execute-countdown">
            {t('aiChat.connect.autoOpenCountdown', { seconds: Math.max(1, remaining) })}
        </div>
    );
};

const PlugIcon: React.FC = () => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 2v6" />
        <path d="M15 2v6" />
        <path d="M6 8h12v3a6 6 0 0 1-12 0z" />
        <path d="M12 17v5" />
    </svg>
);

const CheckIcon: React.FC = () => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
    </svg>
);

const CrossIcon: React.FC = () => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
    </svg>
);

export const ConnectRequestCard: React.FC<ConnectRequestCardProps> = ({
    body, parse, block, outcome, policyOff, localShellType,
    onOpen, onOpenInDialog, onDecline, onCancelSchedule, onOpenAsTab, canOpenAsTab,
}) => {
    const { t } = useTranslation();
    const pending = parse === undefined;
    const resolved: ResolvedConnect | undefined = block?.resolved;
    const decision = block?.decision;
    const shellLabel = t(SHELL_LABEL_KEY[localShellType]);

    // ── Header: what the AI wants to open ──
    let target: string;
    if (resolved?.kind === 'local') {
        target = t('aiChat.connect.typeLocal', { shell: shellLabel });
    } else if (resolved?.kind === 'remote') {
        target = t('aiChat.connect.targetRemote', { protocol: resolved.protocol.toUpperCase(), host: resolved.host, port: resolved.port });
    } else if (parse?.ok) {
        const r = parse.request;
        target = r.type === 'local'
            ? t('aiChat.connect.typeLocal', { shell: shellLabel })
            : t('aiChat.connect.targetRemote', { protocol: r.type.toUpperCase(), host: r.host ?? '?', port: r.port ?? (r.type === 'ssh' ? 22 : 23) });
    } else {
        target = '';
    }

    // ── Meta lines (rendered as text nodes — never markdown) ──
    const meta: { key: string; text: string; tone?: 'warn' | 'danger' }[] = [];
    if (resolved?.kind === 'remote') {
        if (resolved.username) meta.push({ key: 'user', text: t('aiChat.connect.userLine', { user: resolved.username }) });
        if (resolved.displayName && resolved.displayName !== resolved.host) meta.push({ key: 'name', text: t('aiChat.connect.nameLine', { name: resolved.displayName }) });
        if (resolved.reason) meta.push({ key: 'reason', text: t('aiChat.connect.reason', { reason: resolved.reason }) });
        const cs = resolved.credentialSource;
        if (cs.kind === 'host-tree') meta.push({ key: 'creds', text: t('aiChat.connect.credsHostTree', { name: cs.nodeName }) });
        else if (cs.kind === 'inherit') meta.push({ key: 'creds', text: t('aiChat.connect.credsReuse', { alias: cs.alias }), tone: 'warn' });
        else if (cs.kind === 'inherit-username') meta.push({ key: 'creds', text: t('aiChat.connect.credsUsernameOnly', { alias: cs.alias }) });
        else if (resolved.needsDialog) meta.push({ key: 'creds', text: t('aiChat.connect.credsNoneSsh') });
        else meta.push({ key: 'creds', text: t('aiChat.connect.credsNone') });
        if (resolved.viaNote && parse?.ok && parse.request.via) {
            meta.push({ key: 'via', text: t('aiChat.connect.viaUnknown', { alias: parse.request.via }) });
        }
        if (resolved.hostTreeAmbiguous) {
            meta.push({ key: 'ambiguous', text: t('aiChat.connect.hostTreeAmbiguous', { count: resolved.hostTreeAmbiguous }) });
        }
    } else if (parse?.ok && parse.request.reason) {
        meta.push({ key: 'reason', text: t('aiChat.connect.reason', { reason: parse.request.reason }) });
    }

    // ── Which state to show ──
    // Outcome (from the transcript) wins; then the reducer's transient status.
    type View =
        | { kind: 'streaming' }
        | { kind: 'inert' }
        | { kind: 'invalid'; detail: string }
        | { kind: 'ask'; variant: 'open' | 'dialog'; reuse: boolean }
        | { kind: 'scheduled'; runAt: number }
        | { kind: 'opening'; waitingLogin: boolean }
        | { kind: 'dialog' }
        | { kind: 'opened'; alias: string; auto: boolean }
        | { kind: 'failed'; reason: string }
        | { kind: 'declined' }
        | { kind: 'refused'; reason: string }
        | { kind: 'expired' };

    let view: View;
    if (pending) view = { kind: 'streaming' };
    else if (policyOff || decision?.action === 'inert') view = { kind: 'inert' };
    else if (outcome) {
        switch (outcome.kind) {
            case 'connected': view = { kind: 'opened', alias: outcome.alias ?? '', auto: !!block?.autoOpened }; break;
            case 'failed': view = { kind: 'failed', reason: firstBracketed(outcome.body) }; break;
            case 'declined': view = { kind: 'declined' }; break;
            case 'refused': view = { kind: 'refused', reason: refusedLabel(t, decision, outcome.body) }; break;
        }
    } else if (!parse.ok) view = { kind: 'invalid', detail: describeParseErrors(parse.errors) };
    else if (!block || !decision) view = { kind: 'expired' };
    else if (decision.action === 'refuse') view = { kind: 'refused', reason: refusedLabel(t, decision, '') };
    else if (block.status === 'scheduled' && block.runAt !== undefined) view = { kind: 'scheduled', runAt: block.runAt };
    else if (block.status === 'opening') view = { kind: 'opening', waitingLogin: resolved?.kind === 'remote' && resolved.manualLogin };
    else if (block.status === 'dialog') view = { kind: 'dialog' };
    else if (block.status === 'settled') view = { kind: 'expired' };
    else if (decision.action === 'ask') view = { kind: 'ask', variant: decision.variant, reuse: decision.reuse };
    else if (decision.action === 'auto') view = { kind: 'ask', variant: 'open', reuse: false };
    else view = { kind: 'expired' };

    const tone = view.kind === 'ask' && view.reuse ? 'warn'
        : view.kind === 'failed' ? 'danger'
        : undefined;
    const classes = ['ai-execute-block', 'ai-connect-block'];
    if (view.kind === 'scheduled') classes.push('ai-execute-scheduled');
    if (view.kind === 'opened') classes.push('ai-execute-auto');
    if (view.kind === 'declined') classes.push('ai-execute-declined');
    if (tone) classes.push(`ai-execute-tone-${tone}`);

    const showBody = view.kind === 'streaming' || view.kind === 'invalid' || !target;

    return (
        <div className={classes.join(' ')} data-testid="ai-connect-card">
            <div className="ai-connect-head">
                <span className="ai-connect-icon"><PlugIcon /></span>
                <span className="ai-connect-title">{t('aiChat.connect.title')}</span>
                {target && <span className="ai-connect-target">{target}</span>}
                <span className="ai-connect-headless">{t('aiChat.connect.headless')}</span>
            </div>
            {showBody && <pre className="ai-connect-body"><code>{body}</code></pre>}
            {meta.length > 0 && (
                <ul className="ai-connect-meta">
                    {meta.map((m) => (
                        <li key={m.key} className={m.tone ? `ai-connect-meta-${m.tone}` : undefined}>{m.text}</li>
                    ))}
                </ul>
            )}
            <div className="ai-execute-actions">
                {view.kind === 'streaming' && (
                    <button type="button" className="ai-run-btn" disabled>{t('aiChat.connect.open')}</button>
                )}
                {view.kind === 'ask' && (
                    <>
                        <button
                            type="button"
                            className="ai-run-btn"
                            onClick={view.variant === 'dialog' ? onOpenInDialog : onOpen}
                        >
                            <PlugIcon />
                            {view.variant === 'dialog' ? t('aiChat.connect.openInDialog') : t('aiChat.connect.open')}
                        </button>
                        <button type="button" className="ai-decline-btn" onClick={onDecline}>
                            <CrossIcon />
                            {t('aiChat.connect.decline')}
                        </button>
                    </>
                )}
                {view.kind === 'scheduled' && (
                    <button type="button" className="ai-decline-btn" onClick={onCancelSchedule}>
                        <CrossIcon />
                        {t('aiChat.connect.cancelAuto')}
                    </button>
                )}
                {view.kind === 'opening' && (
                    <button type="button" className="ai-run-btn" disabled>{t('aiChat.connect.opening')}</button>
                )}
                {view.kind === 'dialog' && (
                    <button type="button" className="ai-run-btn" disabled>{t('aiChat.connect.dialogPending')}</button>
                )}
                {view.kind === 'opened' && (
                    <>
                        <span className="ai-execute-auto-badge">
                            <CheckIcon />
                            {view.auto
                                ? t('aiChat.connect.openedAuto', { alias: view.alias })
                                : t('aiChat.connect.opened', { alias: view.alias })}
                        </span>
                        {onOpenAsTab && canOpenAsTab?.(view.alias) && (
                            <button type="button" className="ai-decline-btn ai-connect-as-tab" onClick={() => onOpenAsTab(view.alias)}>
                                {t('aiChat.connect.openAsTab')}
                            </button>
                        )}
                    </>
                )}
                {view.kind === 'declined' && (
                    <span className="ai-execute-declined-badge">
                        <CrossIcon />
                        {t('aiChat.connect.declined')}
                    </span>
                )}
                {view.kind === 'failed' && (
                    <span className="ai-execute-declined-badge ai-connect-failed-badge">
                        <CrossIcon />
                        {t('aiChat.connect.failed', { reason: view.reason })}
                    </span>
                )}
            </div>
            {view.kind === 'scheduled' && <AutoOpenCountdown runAt={view.runAt} />}
            {view.kind === 'opening' && view.waitingLogin && (
                <div className="ai-execute-verdict ai-execute-verdict-warn">{t('aiChat.connect.waitingLogin')}</div>
            )}
            {view.kind === 'inert' && (
                <div className="ai-execute-verdict ai-execute-verdict-warn">{t('aiChat.connect.inert')}</div>
            )}
            {view.kind === 'invalid' && (
                <div className="ai-execute-paused-banner">{t('aiChat.connect.refusedInvalid', { detail: view.detail })}</div>
            )}
            {view.kind === 'refused' && (
                <div className="ai-execute-paused-banner">{view.reason}</div>
            )}
            {view.kind === 'expired' && (
                <div className="ai-execute-verdict">{t('aiChat.connect.expired')}</div>
            )}
        </div>
    );
};

/** The `[reason]` an envelope body opens with, without the brackets. */
function firstBracketed(body: string): string {
    const m = body.match(/^\[([^\]]*)\]/);
    return m ? m[1] : body.split('\n')[0];
}

function refusedLabel(
    t: (key: string, opts?: Record<string, unknown>) => string,
    decision: ConnectBlock['decision'],
    envelopeBody: string,
): string {
    if (decision?.action === 'refuse') {
        switch (decision.reason) {
            case 'cap': return t('aiChat.connect.refusedCap');
            case 'with-execute': return t('aiChat.connect.refusedWithExecute');
            case 'multiple': return t('aiChat.connect.refusedMultiple');
            case 'invalid': return t('aiChat.connect.refusedInvalid', { detail: decision.errors ? describeParseErrors(decision.errors) : '' });
        }
    }
    // Refused by the orchestrator at open time (e.g. cap re-check) — show its reason.
    return envelopeBody ? firstBracketed(envelopeBody) : t('aiChat.connect.refusedCap');
}
