import React, { useState, useEffect, useRef, useReducer, useCallback, useMemo } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { getTransparentColor } from '../../utils/colorUtils';
import { renderMarkdown } from '../../utils/markdown';
import { MarkdownContent } from '../MarkdownContent/MarkdownContent';
import { decideAutoExec, classifyStatic, type AutoExecDecision } from '../../utils/aiCommandClassifier';
import {
    autoExecReducer,
    emptyAutoExecState,
    hasBlock,
    getBlock,
    collectMessageDecorations,
    type AutoExecState,
    type AutoExecAction,
} from '../../utils/autoExecReducer';
import { STORAGE_KEYS } from '../../constants/storage';
import { aiProviderLabelKey } from '../../constants/aiProviders';
import { formatAICost } from '../../constants/aiPricing';
import { buildExecutionRules, languageDirective, resolveAiLanguage, languageSwitchNotice, AUTO_LANGUAGE, NETWORK_EXPERT_KICKOFF, NETWORK_EXPERT_RECONNECT_PREP, buildWatchTargetsBlock, withTargetDirective } from '../../constants/aiPrompts';
import { SUPPORTED_LANGUAGES } from '../../i18n';
import { ExecutionModeBar } from './ExecutionModeBar';
import { TerminalOutputBlock } from './TerminalOutputBlock';
import { parseTerminalOutputMessage, notConnectedNote, declinedNote } from './terminalOutputUtils';
import { segmentMessageContent, extractExecuteCommands, extractExecuteBlocks } from './executeBlockUtils';
import { buildAliasEntries, resolveAlias } from '../../utils/terminalAlias';
import { conversationColorIndex, conversationColorVar } from '../../utils/conversationColor';
import { SystemPromptModal } from '../SystemPromptModal/SystemPromptModal';
import { ConfirmModal } from '../ConfirmModal/ConfirmModal';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAiAuthStore } from '../../stores/aiAuthStore';
import { tauriService } from '../../services/tauriService';
import { logError } from '../../utils/logger';
import type { AiChatState, ChatTab } from '../../hooks/useAiChat';
import { getActiveTab, aiBackendSessionId } from '../../hooks/useAiChat';

/**
 * The single terminal an AI-issued command runs on for a tab (Phase 2a): the
 * last-focused watched terminal if it is still watched, else the first watched.
 * Phase 2b lets the AI override this per-command via a `target=` tag.
 */
function execTargetOf(tab: ChatTab | undefined): string | undefined {
    const list = tab?.linkedSessions ?? [];
    if (list.length === 0) return undefined;
    const focused = tab?.lastFocusedWatchId;
    if (focused && list.some((w) => w.sessionId === focused)) return focused;
    return list[0]?.sessionId;
}
import type { SessionRecord } from '../../hooks/useSessionManager';
import type { PersonaDefinition, AIModelInfo, LinkableSession, ChatImage } from '../../types/appTypes';
import { TabStrip } from './TabStrip';
import { groupLinkableSessions } from './linkPicker';
import { MODEL_LOAD_RETRY_DELAYS_MS } from './modelLoadRetry';
import { useChatStream, type ChatMessage } from '../../hooks/useChatStream';
import { useChatLog } from '../../hooks/useChatLog';
import './AIChatPane.css';

// ── Image-attachment limits (mirror the Rust validation in commands/ai.rs) ──
// Client-side caps give fast feedback; the backend re-validates authoritatively.
const IMAGE_ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MiB per image (decoded)
const IMAGE_MAX_COUNT = 5; // per message

/** Read a File into a `{ mimeType, dataBase64 }` (base64 WITHOUT the data: prefix). */
function fileToChatImage(file: File): Promise<ChatImage> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error('read failed'));
        reader.onload = () => {
            const result = typeof reader.result === 'string' ? reader.result : '';
            // result is `data:<mime>;base64,<data>` — strip the prefix.
            const comma = result.indexOf(',');
            const dataBase64 = comma >= 0 ? result.slice(comma + 1) : '';
            resolve({ mimeType: file.type, dataBase64 });
        };
        reader.readAsDataURL(file);
    });
}

interface AIChatPaneProps {
    paneId: string;
    active: boolean;
    chatState?: AiChatState;
    onChatStateChange?: (newState: Partial<AiChatState>) => void;
    onUpdateTabById?: (tabId: string, partial: Partial<ChatTab>) => void;
    /** Append a machine-generated message to a tab's pending-send queue. */
    onEnqueuePending?: (tabId: string, message: string) => void;
    /** Drop the first message from a tab's pending-send queue (after dispatch). */
    onDequeuePending?: (tabId: string) => void;
    /** Append a human-typed message (sent while streaming) to a tab's priority queue. */
    onEnqueuePendingUser?: (tabId: string, message: string, images?: ChatImage[]) => void;
    /** Drop the first message from a tab's priority (user) queue (after dispatch). */
    onDequeuePendingUser?: (tabId: string) => void;
    onAddTab?: (initialLinkSessionId?: string) => void;
    onCloseTab?: (tabId: string) => void;
    /** Close the whole AI Chat pane (used when the last remaining tab is closed). */
    onClosePane?: () => void;
    onSelectTab?: (tabId: string) => void;
    onFlashSessionPane?: (sessionId: string) => void;
    sessions?: Map<string, SessionRecord>;
    onRunCommand?: (sessionId: string, command: string, originatingTabId: string) => void;
    onSendMessage?: (text: string, images?: ChatImage[]) => void;
    aiPersonas: PersonaDefinition[];
    terminalBackground?: string;
    /** Sessions selectable in the link picker (this window + other windows). */
    linkableSessions?: LinkableSession[];
    /** Add a terminal to the active tab's watched set (header "+" picker). */
    onAddLink?: (sessionId: string) => void;
    /** Remove a watched terminal from the active tab's set (chip ×). */
    onRemoveLink?: (sessionId: string) => void;
    /** Refresh the cross-window session list (called when the picker opens). */
    onRefreshSessions?: () => void;
    /** Open the Settings modal on the AI tab (sign-in lives there). */
    onOpenSettings?: () => void;
    /** Resolve the AI data-sharing consent gate (shows the modal if needed). */
    ensureConsent?: () => Promise<boolean>;
}

// ── AI Icon Component ──
// The spark tints to the active provider so the pane's icon reflects who is
// answering: Gemini keeps its 3-stop brand gradient; the other providers fill
// with their single brand color (existing theme vars). Falls back to the Gemini
// gradient for unknown/undefined providers.
const SPARK_PATH = 'M12 2L14.8 9.2L22 12L14.8 14.8L12 22L9.2 14.8L2 12L9.2 9.2L12 2Z';
const PROVIDER_SOLID_VAR: Record<string, string> = {
    openai: 'provider-openai',
    anthropic: 'provider-anthropic',
    vertexai: 'provider-vertex-ai',
};
const AIIcon: React.FC<{ size?: number; className?: string; provider?: string }> = ({ size = 24, className = '', provider }) => {
    const solidVar = provider ? PROVIDER_SOLID_VAR[provider] : undefined;
    const svgProps = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', className, style: { flexShrink: 0 } as React.CSSProperties };
    if (solidVar) {
        return (
            <svg {...svgProps}>
                <path d={SPARK_PATH} fill={`var(--${solidVar})`} />
            </svg>
        );
    }
    return (
        <svg {...svgProps}>
            <path d={SPARK_PATH} fill="url(#ai-gradient)" />
            <defs>
                <linearGradient id="ai-gradient" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                    <stop stopColor="var(--provider-gemini-1)" />
                    <stop offset="0.5" stopColor="var(--provider-gemini-2)" />
                    <stop offset="1" stopColor="var(--provider-gemini-3)" />
                </linearGradient>
            </defs>
        </svg>
    );
};

// ── Per-command safety verdict note ──
// Always rendered under an execute block (in auto-execute-safe mode) so the user
// can see HOW each command was judged: blocked by the deny guard, allow-listed,
// AI-judged read-only/modifying, or unverified (fallback). Required by design —
// no command's verdict is hidden.
// i18n keys for each verdict source; resolved to display text at render via t().
const VERDICT_LABEL_KEY: Record<AutoExecDecision['source'], string> = {
    'blacklist': 'aiChat.message.verdictBlacklist',
    'whitelist': 'aiChat.message.verdictWhitelist',
    'ai': 'aiChat.message.verdictAi',
    'ask': 'aiChat.message.verdictAsk',
    'fallback': 'aiChat.message.verdictFallback',
};

type VerdictTone = 'safe' | 'warn' | 'danger';

// Tone: red for blocked, warning for "modifies / uncertain / unverified",
// success for "will / did auto-run". Also drives the execute block's left bar,
// so the judgement is readable without expanding the reason.
const verdictTone = (verdict: AutoExecDecision): VerdictTone =>
    verdict.source === 'blacklist' ? 'danger' : verdict.autoExec ? 'safe' : 'warn';

// The verdict is summarised to a tone dot + one phrase ("Safe · whitelisted");
// the full reason stays collapsed behind it so a routine safe run reads quietly.
// Nothing is hidden — the reason is one click away, per block.
const VerdictNote: React.FC<{ classifying?: boolean; verdict?: AutoExecDecision }> = ({ classifying, verdict }) => {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);
    if (classifying) {
        return <div className="ai-execute-verdict ai-execute-verdict-checking">{t('aiChat.message.checkingSafety')}</div>;
    }
    if (!verdict) return null;

    const tone = verdictTone(verdict);
    // An AI verdict carries its own confidence and splits by outcome
    // ("Safe · AI 96%" vs "Check · AI 62%"); the static tiers are a fixed phrase.
    const summary = verdict.source === 'ai'
        ? t(verdict.autoExec ? 'aiChat.message.verdictAi' : 'aiChat.message.verdictAiReview')
        + (typeof verdict.confidence === 'number'
            ? t('aiChat.message.verdictConfidence', { percent: Math.round(verdict.confidence * 100) })
            : '')
        : t(VERDICT_LABEL_KEY[verdict.source]);

    return (
        <>
            <button
                type="button"
                className={`ai-execute-verdict-toggle ai-execute-verdict-toggle-${tone}${expanded ? ' expanded' : ''}`}
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
            >
                <span className="ai-execute-verdict-dot" aria-hidden="true" />
                <span>{summary}</span>
                <svg className="ai-execute-verdict-caret" viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true">
                    <path d="M9 6l6 6-6 6z" />
                </svg>
            </button>
            {expanded && (
                <div className={`ai-execute-verdict ai-execute-verdict-reason ai-execute-verdict-${tone}`}>
                    {verdict.reason || (verdict.autoExec ? t('aiChat.message.verdictReasonReadOnly') : t('aiChat.message.verdictReasonRunManually'))}
                </div>
            )}
        </>
    );
};

// Live "⏳ Waiting Ns…" indicator shown on an execute block whose leading `sleep`
// is being run as a client-side delay (see App.tsx scheduleSleepDelay).
const SleepCountdown: React.FC<{ delay: NonNullable<ChatTab['sleepDelay']> }> = ({ delay }) => {
    const { t } = useTranslation();
    const compute = () => Math.max(0, Math.ceil((delay.untilTs - Date.now()) / 1000));
    const [remaining, setRemaining] = useState(compute);
    useEffect(() => {
        setRemaining(compute());
        const id = setInterval(() => setRemaining(compute()), 1000);
        return () => clearInterval(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [delay.untilTs]);
    if (remaining <= 0) return null;
    return (
        <div className="ai-execute-sleep-wait">
            {delay.wasClamped
                ? t('aiChat.message.sleepWaitingCapped', { seconds: remaining })
                : t('aiChat.message.sleepWaiting', { seconds: remaining })}
        </div>
    );
};

// Live "⏳ Auto-running in Ns…" indicator shown on an auto-execute-safe command
// while it waits out the pre-execution grace period (see the auto-exec effect's
// countdown). Purely a display: the pane's timer is what actually fires the run.
const AutoRunCountdown: React.FC<{ runAt: number }> = ({ runAt }) => {
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
            {t('aiChat.message.autoRunCountdown', { seconds: Math.max(1, remaining) })}
        </div>
    );
};

// ── Message Content Component with Execution Support ──
const MessageContent: React.FC<{
    content: string;
    onRun?: (cmd: string, target?: string) => void;
    onDecline?: (cmd: string) => void;
    onHoverTarget?: (hovered: boolean) => void;
    targetTitle?: string;
    targetId?: string;
    targetLive?: boolean;
    /** Resolve an execute block's `target=<alias>` to the terminal it will run on,
     *  so the label under each block shows the AUTO-DETECTED target (Phase 2). When
     *  omitted, the block falls back to the single targetTitle/targetId/targetLive. */
    resolveBlockTarget?: (alias?: string) => { title?: string; id?: string; live: boolean };
    autoExecutedCommands?: Set<string>;
    declinedCommands?: Set<string>;
    /** command → auto-run deadline (epoch ms) for blocks in the pre-run countdown. */
    scheduledCommands?: Map<string, number>;
    /** Cancel a scheduled auto-run (reverts the block to manual Run/Decline). */
    onCancelScheduled?: (command: string) => void;
    verdictByCommand?: Map<string, AutoExecDecision>;
    classifyingCommands?: Set<string>;
    limitReached?: boolean;
    sleepDelay?: ChatTab['sleepDelay'];
}> = ({ content, onRun, onDecline, onHoverTarget, targetTitle, targetId, targetLive = true, resolveBlockTarget, autoExecutedCommands, declinedCommands, scheduledCommands, onCancelScheduled, verdictByCommand, classifyingCommands, limitReached, sleepDelay }) => {
    const { t } = useTranslation();
    const parts = segmentMessageContent(content);
    // The run-target label for one block, resolved from its own `target=` alias when
    // present (auto-detected), else the tab's single exec target.
    const renderTargetLabel = (blockTarget?: string) => {
        const bt = resolveBlockTarget ? resolveBlockTarget(blockTarget) : { title: targetTitle, id: targetId, live: targetLive };
        return bt.id
            ? (bt.live
                ? <span className="ai-run-target">{t('aiChat.message.target', { title: bt.title || t('aiChat.message.unnamedTerminal') })}</span>
                : <span className="ai-run-target ai-run-target-stale">{t('aiChat.message.targetStale', { title: bt.title || t('aiChat.message.unnamedTerminal') })}</span>)
            : <span className="ai-run-target no-target">{t('aiChat.message.noTarget')}</span>;
    };

    return (
        <>
            {parts.map((part) => {
                if (part.kind === 'execute-pending') {
                    // Streaming tail: render the styled block immediately with a disabled
                    // button so it updates in place (no jump) when the closing fence arrives.
                    return (
                        <div key={part.key} className="ai-execute-block">
                            <pre><code>{part.command}</code></pre>
                            <div className="ai-execute-actions">
                                <button className="ai-run-btn" disabled>
                                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                                        <path d="M8 5v14l11-7z" />
                                    </svg>
                                    {t('aiChat.message.runInTerminal')}
                                </button>
                                {renderTargetLabel(part.target)}
                            </div>
                        </div>
                    );
                }
                if (part.kind === 'execute') {
                    const command = part.command;
                    const wasAutoExecuted = autoExecutedCommands?.has(command);
                    const wasDeclined = declinedCommands?.has(command);
                    const scheduledAt = scheduledCommands?.get(command);
                    const isScheduled = scheduledAt !== undefined;
                    // The verdict's tone bar rides on the block itself, and only
                    // where the verdict summary is shown (a scheduled countdown /
                    // declined block owns the row instead — see below).
                    const isSleeping = !!sleepDelay && sleepDelay.command === command;
                    const verdict = verdictByCommand?.get(command);
                    const tone = !wasDeclined && !isScheduled && !isSleeping && verdict
                        ? verdictTone(verdict)
                        : undefined;
                    return (
                        <div key={part.key} className={`ai-execute-block${wasAutoExecuted ? ' ai-execute-auto' : ''}${wasDeclined ? ' ai-execute-declined' : ''}${isScheduled ? ' ai-execute-scheduled' : ''}${tone ? ` ai-execute-tone-${tone}` : ''}`}>
                            <pre><code>{command}</code></pre>
                            <div className="ai-execute-actions">
                                {wasDeclined ? (
                                    <span className="ai-execute-declined-badge">
                                        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                                        </svg>
                                        {t('aiChat.message.declined')}
                                    </span>
                                ) : wasAutoExecuted ? (
                                    <span className="ai-execute-auto-badge">
                                        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                                            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                                        </svg>
                                        {t('aiChat.message.autoExecuted')}
                                    </span>
                                ) : isScheduled ? (
                                    // Grace window before an auto-run: offer a single Cancel that
                                    // stops the run and reverts the block to manual Run/Decline.
                                    <button
                                        className="ai-decline-btn"
                                        onClick={() => onCancelScheduled?.(command)}
                                    >
                                        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                                        </svg>
                                        {t('aiChat.message.autoRunCancel')}
                                    </button>
                                ) : (
                                    <>
                                        <button
                                            className="ai-run-btn"
                                            onClick={() => onRun?.(command, part.target)}
                                            onMouseEnter={() => onHoverTarget?.(true)}
                                            onMouseLeave={() => onHoverTarget?.(false)}
                                        >
                                            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                                                <path d="M8 5v14l11-7z" />
                                            </svg>
                                            {t('aiChat.message.runInTerminal')}
                                        </button>
                                        {onDecline && (
                                            <button
                                                className="ai-decline-btn"
                                                onClick={() => onDecline(command)}
                                            >
                                                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                                                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                                                </svg>
                                                {t('aiChat.message.dontExecute')}
                                            </button>
                                        )}
                                    </>
                                )}
                                {renderTargetLabel(part.target)}
                            </div>
                            {!wasDeclined && (
                                isScheduled ? (
                                    <AutoRunCountdown runAt={scheduledAt} />
                                ) : isSleeping && sleepDelay ? (
                                    <SleepCountdown delay={sleepDelay} />
                                ) : (
                                    <VerdictNote
                                        classifying={classifyingCommands?.has(command)}
                                        verdict={verdict}
                                    />
                                )
                            )}
                            {!wasAutoExecuted && !wasDeclined && !isScheduled && limitReached && (
                                <div className="ai-execute-paused-banner">{t('aiChat.message.autoExecPaused')}</div>
                            )}
                        </div>
                    );
                }
                return (
                    <MarkdownContent
                        key={part.key}
                        className="ai-chat-markdown-inline"
                        sanitizedHtml={renderMarkdown(part.text)}
                    />
                );
            })}
        </>
    );
};

// ── Main Component ──
export const AIChatPane: React.FC<AIChatPaneProps> = React.memo(({
    paneId,
    chatState,
    onChatStateChange,
    onUpdateTabById,
    onEnqueuePending,
    onDequeuePending,
    onEnqueuePendingUser,
    onDequeuePendingUser,
    ensureConsent,
    onAddTab,
    onCloseTab,
    onClosePane,
    onSelectTab,
    onFlashSessionPane,
    sessions,
    onRunCommand,
    onSendMessage,
    aiPersonas,
    terminalBackground,
    linkableSessions,
    onAddLink,
    onRemoveLink,
    onRefreshSessions,
    onOpenSettings,
}) => {
    const { t } = useTranslation();
    // Derive active tab from chatState (Phase 2: tabs[] + activeTabId; each tab
    // watches a SET of terminals — activeTab.linkedSessions).
    const activeTab = chatState ? getActiveTab(chatState) : undefined;
    const activeTabId = activeTab?.id;
    // This conversation's color (matches its watched terminal tabs & conversation
    // tab). Applied to the header chips so the ownership color chain is legible.
    const activeConvColor = activeTab
        ? conversationColorVar(conversationColorIndex(activeTab.ordinal))
        : undefined;
    // Auth state is window-global (owned by useAiAuthOwner, mounted in App);
    // the pane is a pure consumer. Sign-in lives in Settings → AI.
    const isAuthenticated = useAiAuthStore((s) => s.isAuthenticated);
    const isAuthLoading = useAiAuthStore((s) => s.isAuthLoading);
    const logoutNonce = useAiAuthStore((s) => s.logoutNonce);

    const [selectedRegion, setSelectedRegion] = useState(
        () => localStorage.getItem(STORAGE_KEYS.VERTEXAI_SELECTED_REGION) || localStorage.getItem(STORAGE_KEYS.VERTEXAI_LOCATION) || ''
    );
    const [availableRegions, setAvailableRegions] = useState<string[]>([]);
    const [isLoadingModels, setIsLoadingModels] = useState(false);

    const activeAiProvider = useSettingsStore(s => s.activeAiProvider);
    const commandExecutionMode = useSettingsStore(s => s.commandExecutionMode);
    const whitelistCommands = useSettingsStore(s => s.whitelistCommands);
    const blacklistCommands = useSettingsStore(s => s.blacklistCommands);
    const maxConsecutiveAutoExecutions = useSettingsStore(s => s.maxConsecutiveAutoExecutions);
    const aiAutoExecCountdownSecs = useSettingsStore(s => s.aiAutoExecCountdownSecs);
    // How many conversation tabs may stream at once in this pane (extra sends queue).
    // `?? 3` guards a store that predates this setting (or a test mock that omits it)
    // so `slots` math never goes NaN.
    const maxConcurrentStreams = useSettingsStore(s => s.maxConcurrentStreams) ?? 3;
    const classifierStrategy = useSettingsStore(s => s.classifierStrategy);
    const aiClassifyConfidenceThreshold = useSettingsStore(s => s.aiClassifyConfidenceThreshold);
    const aiDataConsentAccepted = useSettingsStore(s => s.aiDataConsentAccepted);
    // Shared with terminal session logging — AI chat transcripts are written to
    // the same user-approved folder, gated by the same toggle.
    const loggingEnabled = useSettingsStore(s => s.loggingEnabled);
    const loggingPath = useSettingsStore(s => s.loggingPath);
    // App UI language + the AI answer language. Both live in the settings store,
    // which is cross-window synced, so changing either reaches every open AI Chat
    // pane (and its in-progress conversation) instead of one pane's local state.
    // `?? …` guards a store that predates these fields (or a test mock that omits
    // them), matching the `maxConcurrentStreams` convention above.
    const appLanguage = useSettingsStore(s => s.language) ?? 'en';
    const aiResponseLanguage = useSettingsStore(s => s.aiResponseLanguage) ?? AUTO_LANGUAGE;
    const updateSetting = useSettingsStore(s => s.update);
    // The concrete language the model is told to answer in. `Auto` follows the app
    // UI language, so a Settings → General change re-authors the system prompt
    // below without the user touching this pane.
    const effectiveLanguage = useMemo(
        () => resolveAiLanguage(aiResponseLanguage, appLanguage),
        [aiResponseLanguage, appLanguage],
    );

    // Auto-execute state. The de-dup guard and the executed-command badge set are
    // tracked PER TAB: their keys (blockKey = messageIndex:command, and command text)
    // are only unique within a single conversation. Clearing a tab's messages on
    // "New chat" resets the message indices to 0,1,2…, so a pane-global set would
    // mistake the new chat's first command for one already processed and suppress it.
    // Consecutive auto-execute streak, tracked PER TAB (keyed by tab id) so parallel
    // auto-exec on two tabs can't consume/reset each other's
    // `maxConsecutiveAutoExecutions` budget. The active tab's value drives the
    // render-time `limitReached`; the async auto-exec continuation reads/writes a
    // SPECIFIC tab's entry via the ref mirror (getAutoExecCount / setAutoExecCountForTab).
    const [autoExecCountByTab, setAutoExecCountByTab] = useState<Map<string, number>>(() => new Map());
    const setAutoExecCountForTab = useCallback((tabId: string, updater: number | ((prev: number) => number)) => {
        setAutoExecCountByTab((prev) => {
            const cur = prev.get(tabId) ?? 0;
            const v = typeof updater === 'function' ? (updater as (p: number) => number)(cur) : updater;
            if (v === cur) return prev;
            const next = new Map(prev); next.set(tabId, v); return next;
        });
    }, []);
    const resetAutoExecCountForTab = useCallback((tabId: string) => setAutoExecCountForTab(tabId, 0), [setAutoExecCountForTab]);
    // Per-tab auto-execute tracking (reserve → classify → execute/decline, one entry
    // per command block keyed by `${messageIndex}:${command}`). ONE immutable reducer
    // replaces the five parallel per-tab refs the pane used to juggle
    // (processed / executed / declined / decisions / classifying) plus the
    // `decisionsVersion` re-render counter — see utils/autoExecReducer. Keying a block
    // by messageIndex+command (not bare command text) keeps the same command in two
    // messages tracked independently; per-tab scoping is why "New chat" (which restarts
    // message indices at 0) must clear the tab so a stale key can't shadow the new
    // conversation's first command.
    //
    // `autoExecStateRef` mirrors the state SYNCHRONOUSLY so the stream-complete effect
    // can reserve a block and the async classifier can re-check "declined" before the
    // reducer's committed state is available (refs mutate in place; useReducer doesn't).
    // Every mutation goes through `applyAutoExec`, which updates the ref AND dispatches,
    // keeping the render-time state and the synchronous ref in lockstep.
    const [autoExecState, dispatchAutoExec] = useReducer(autoExecReducer, emptyAutoExecState);
    const autoExecStateRef = useRef<AutoExecState>(autoExecState);
    const applyAutoExec = useCallback((action: AutoExecAction) => {
        autoExecStateRef.current = autoExecReducer(autoExecStateRef.current, action);
        dispatchAutoExec(action);
    }, []);
    const [autoExecPaused, setAutoExecPaused] = useState(false);

    const [inputText, setInputText] = useState('');
    // Images the user has attached but not yet sent (per-window, ephemeral — like
    // inputText). Cleared on send. Populated by paste / drag-drop / the attach button.
    const [pendingImages, setPendingImages] = useState<ChatImage[]>([]);
    // Transient message shown when an attachment is rejected (too large / wrong type /
    // over the count cap). Cleared when the user attaches or sends successfully.
    const [attachError, setAttachError] = useState<string | null>(null);
    // Set inside a setState updater (where we can see the current count) when a batch
    // would exceed the count cap; read/cleared right after to surface the message.
    const rejectedTooMany = useRef(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [selectedModel, setSelectedModel] = useState(chatState?.selectedModel || 'Unspecified');
    const selectedModelRef = useRef(selectedModel);
    selectedModelRef.current = selectedModel;
    // Generation guard shared by the model-list retry effect and handleRegionChange
    // so a region change cancels an in-flight retry chain (see the retry effect).
    const modelLoadGenRef = useRef(0);
    // Forward handle: clears EVERY per-tab auto-exec / kickoff tracking ref. Assigned
    // once all those refs exist; called on provider switch and explicit logout so a
    // new conversation (message indices restart at 0) isn't shadowed by stale keys.
    const resetAllTabTrackingRef = useRef<() => void>(() => {});

    // Per-tab transcripts + streaming (chunk/done/error listener, two-timer watchdog,
    // and stream-completion detection) are owned by useChatStream. The returned
    // helpers keep the same names the pane used locally, so the send loop / new chat /
    // cancel / provider-switch / logout / prune sites are unchanged. A stable
    // indirection ref lets the hook be created here while `handleStreamComplete` —
    // which needs handlers/refs declared further down — is assigned during render below.
    const streamCompleteHandlerRef = useRef<(tabId: string, messages: ChatMessage[]) => void>(() => {});
    const {
        messagesByTab, setMessagesByTab,
        streamingByTab, streamingTabIds,
        messages, streamingContent, isStreaming,
        setStreamingForTab, markStreaming, setStreamingContent, setIsStreaming, setMessages,
        armStreamWatchdog, clearStreamWatchdog,
        totalInputTokens, totalOutputTokens, totalCost,
        resetAllStreams, pruneStreams, clearTabStream,
    } = useChatStream({
        paneId,
        activeTabId,
        selectedModelRef,
        onStreamComplete: (tabId, msgs) => streamCompleteHandlerRef.current(tabId, msgs),
    });
    const defaultExpertise = aiPersonas?.[0]?.label || 'General Assistant';
    const [selectedExpertise, setSelectedExpertise] = useState(chatState?.selectedExpertise || defaultExpertise);
    // The Network Expert persona carries a mandatory start-of-session protocol
    // (identify device → disable paging) that must run before any real question.
    // We auto-kick it off on terminal link (see effect below). Match by stable id,
    // not label, so a user-renamed Network Expert persona still qualifies.
    const isNetworkExpert = useMemo(
        () => aiPersonas?.find(p => p.label === selectedExpertise)?.id === 'network-expert',
        [aiPersonas, selectedExpertise],
    );
    const [textareaHeight, setTextareaHeight] = useState(0);
    const [localSystemInstruction, setLocalSystemInstruction] = useState(chatState?.systemInstruction || 'You are a helpful assistant.');
    const [showPromptModal, setShowPromptModal] = useState(false);

    // Lookup of selectable sessions (incl. other windows') so a cross-window
    // link resolves its title/liveness even though it isn't in the local
    // `sessions` map.
    const linkableById = useMemo(() => {
        const m = new Map<string, LinkableSession>();
        for (const ls of linkableSessions ?? []) m.set(ls.sessionId, ls);
        return m;
    }, [linkableSessions]);

    // Group selectable sessions for the "+" add picker: this window's own, then one
    // group per other window, EXCLUDING terminals the active tab already watches so
    // the picker only offers new ones.
    const watchedIdSet = useMemo(
        () => new Set((activeTab?.linkedSessions ?? []).map((w) => w.sessionId)),
        [activeTab?.linkedSessions],
    );
    const addLinkGroups = useMemo(
        () => groupLinkableSessions((linkableSessions ?? []).filter((ls) => !watchedIdSet.has(ls.sessionId))),
        [linkableSessions, watchedIdSet],
    );

    // Terminals the active tab watches (rendered as a chip row in the header).
    const watchedTerminals = activeTab?.linkedSessions ?? [];
    // Comma-joined watched-terminal names for the empty state.
    const watchedNamesLabel = watchedTerminals
        .map((w) => sessions?.get(w.sessionId)?.displayName ?? linkableById.get(w.sessionId)?.displayName ?? t('aiChat.pane.terminalFallback'))
        .join(', ');

    // Execute-target info derived from the active tab: the ONE terminal an AI
    // command runs on (execTargetOf — last-focused, else first watched). Drives the
    // run-target label, Network-Expert device identity, and the empty-state check.
    // Prefer the local session record; fall back to the cross-window linkable list.
    const lastTargetSessionId = execTargetOf(activeTab);
    const lastTargetSessionTitle = lastTargetSessionId
        ? (sessions?.get(lastTargetSessionId)?.displayName ?? linkableById.get(lastTargetSessionId)?.displayName)
        : undefined;
    // Liveness of the linked target. A link can point at a session that is
    // disconnected / reconnecting / gone (e.g. SSH dropped while watching), or
    // at a session in another window (resolved via the linkable list). The chip
    // and run-target label reflect this so the UI never looks "connected" when
    // commands can't actually reach the terminal.
    const lastTargetStatus = lastTargetSessionId
        ? (sessions?.get(lastTargetSessionId)?.status ?? linkableById.get(lastTargetSessionId)?.status)
        : undefined;
    const linkedLive = lastTargetStatus === 'connected';
    // Compact signal that changes whenever the active tab's watched SET or any
    // watched terminal's liveness changes — drives the Network-Expert auto-kickoff
    // to (re-)evaluate each watched device without depending on the whole `sessions`
    // map identity. `sid:1` = connected, `sid:0` = not.
    const watchLivenessKey = watchedTerminals
        .map((w) => `${w.sessionId}:${(sessions?.get(w.sessionId)?.status ?? linkableById.get(w.sessionId)?.status) === 'connected' ? '1' : '0'}`)
        .join(',');

    // Mirrors of values the async auto-exec effect must re-check AFTER its await
    // (state captured at effect-run time may be stale by the time classification
    // resolves). Updated every render.
    const linkedLiveRef = useRef(linkedLive);
    linkedLiveRef.current = linkedLive;
    // Mirror of the current chatState so refs/effects can read tabs without taking
    // chatState as a dependency.
    const chatStateRef = useRef(chatState);
    chatStateRef.current = chatState;
    // One-shot language-switch notice (see languageSwitchNotice): the previous
    // effective language, and the set of tabs whose NEXT outgoing message must
    // carry the notice. A tab id is consumed (deleted) by whichever send site
    // dispatches that tab first, so the notice goes out exactly once per tab.
    const prevEffectiveLangRef = useRef<string | null>(null);
    const langNudgeTabsRef = useRef<Set<string>>(new Set());
    // Refs the async auto-exec continuation reads to resolve/re-check a SPECIFIC
    // tab's linked session (auto-exec can complete on a background tab whose link
    // differs from the active tab's). Updated every render.
    const sessionsRef = useRef(sessions);
    sessionsRef.current = sessions;
    const linkableByIdRef = useRef(linkableById);
    linkableByIdRef.current = linkableById;
    const activeTabIdRef = useRef(activeTabId);
    activeTabIdRef.current = activeTabId;

    /** Display name of a watched terminal (this window's, else another's). */
    const resolveTerminalName = useCallback(
        (sessionId: string) =>
            sessionsRef.current?.get(sessionId)?.displayName
            ?? linkableByIdRef.current.get(sessionId)?.displayName,
        [],
    );
    // Persist each conversation to a markdown transcript alongside the terminal
    // session logs (same Settings → General → Logging toggle and folder). Placed
    // after the session/linkable refs so the header records terminal display
    // names rather than raw session ids.
    useChatLog({
        paneId,
        messagesByTab,
        tabs: chatState?.tabs ?? [],
        selectedModel,
        provider: activeAiProvider,
        resolveTerminalName,
        loggingEnabled,
        loggingPath,
    });

    /** Resolve a tab's execute-target session id + live-ness (this window or
     *  another). When the AI tagged its execute fence with `target=<alias>`, that
     *  alias (resolved against the tab's watched terminals) wins; otherwise it
     *  falls back to the tab's exec target (last-focused, else first watched). The
     *  auto-exec continuation can complete on a background tab, so it resolves
     *  per-tab rather than from the active tab. */
    const resolveTabTarget = useCallback((tabId: string, preferredAlias?: string) => {
        const tab = chatStateRef.current?.tabs.find((t) => t.id === tabId);
        let sid: string | undefined;
        if (preferredAlias) {
            const entries = buildAliasEntries((tab?.linkedSessions ?? []).map((w) => {
                const rec = sessionsRef.current?.get(w.sessionId);
                const ls = linkableByIdRef.current.get(w.sessionId);
                return { sessionId: w.sessionId, displayName: rec?.displayName ?? ls?.displayName ?? w.sessionId, status: rec?.status ?? ls?.status };
            }));
            sid = resolveAlias(entries, preferredAlias);
        }
        if (!sid) sid = execTargetOf(tab);
        if (!sid) return { sid: undefined as string | undefined, live: false, status: undefined as string | undefined };
        const status = sessionsRef.current?.get(sid)?.status ?? linkableByIdRef.current.get(sid)?.status;
        return { sid, live: status === 'connected', status };
    }, []);
    /** Resolve an execute block's `target=` alias to a display target for the label
     *  under it (active tab). Passed to MessageContent so each block shows the
     *  terminal it will actually run on. */
    const resolveBlockTarget = useCallback((alias?: string) => {
        const { sid, live } = resolveTabTarget(activeTabIdRef.current ?? '', alias);
        const title = sid
            ? (sessionsRef.current?.get(sid)?.displayName ?? linkableByIdRef.current.get(sid)?.displayName)
            : undefined;
        return { title, id: sid, live };
    }, [resolveTabTarget]);
    const autoExecPausedRef = useRef(autoExecPaused);
    autoExecPausedRef.current = autoExecPaused;
    const autoExecCountByTabRef = useRef(autoExecCountByTab);
    autoExecCountByTabRef.current = autoExecCountByTab;
    // A specific tab's current streak (read after the classify await / by the pre-run
    // countdown timer, which fire later than the effect that closed over them).
    const getAutoExecCount = useCallback((tabId: string) => autoExecCountByTabRef.current.get(tabId) ?? 0, []);
    // Mirrors read AFTER the classify await / by the pre-run countdown timer, which
    // fire later than the effect that closed over them.
    const maxConsecutiveAutoExecutionsRef = useRef(maxConsecutiveAutoExecutions);
    maxConsecutiveAutoExecutionsRef.current = maxConsecutiveAutoExecutions;
    const aiAutoExecCountdownSecsRef = useRef(aiAutoExecCountdownSecs);
    aiAutoExecCountdownSecsRef.current = aiAutoExecCountdownSecs;

    // In-flight pre-run countdown timers, keyed by `${tabId} ${blockKey}`. A
    // scheduled auto-run waits out the grace period here before firing; the block's
    // reducer state (status 'scheduled', runAt) drives the on-screen countdown. These
    // must be cleared whenever the owning conversation goes away (New chat / tab close /
    // provider switch / logout / unmount) or the user cancels, so a stale timer can't
    // fire a command into a torn-down or repurposed tab.
    const countdownTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
    const countdownTimerKey = (tabId: string, blockKey: string) => `${tabId} ${blockKey}`;
    const clearCountdownTimer = useCallback((tabId: string, blockKey: string) => {
        const key = countdownTimerKey(tabId, blockKey);
        const timer = countdownTimersRef.current.get(key);
        if (timer) { clearTimeout(timer); countdownTimersRef.current.delete(key); }
    }, []);
    const clearTabCountdownTimers = useCallback((tabId: string) => {
        const prefix = `${tabId} `;
        for (const [key, timer] of countdownTimersRef.current) {
            if (key.startsWith(prefix)) { clearTimeout(timer); countdownTimersRef.current.delete(key); }
        }
    }, []);
    const clearAllCountdownTimers = useCallback(() => {
        for (const timer of countdownTimersRef.current.values()) clearTimeout(timer);
        countdownTimersRef.current.clear();
    }, []);
    // Stop every pending auto-run countdown, reverting each block to manual. Used when
    // the user pauses auto-exec or switches out of auto-execute-safe mode.
    const cancelAllScheduled = useCallback(() => {
        const snapshot = autoExecStateRef.current;
        for (const [tabId, blocks] of snapshot) {
            for (const [blockKey, block] of blocks) {
                if (block.status === 'scheduled') {
                    clearCountdownTimer(tabId, blockKey);
                    applyAutoExec({ type: 'cancelSchedule', tabId, blockKey });
                }
            }
        }
    }, [applyAutoExec, clearCountdownTimer]);

    // Guards against re-opening the consent modal on every effect re-run while a
    // pending message is parked awaiting consent (the send loop below). Cleared
    // when the gate resolves; the loop re-runs on the consent-state flip.
    const consentPromptShownRef = useRef(false);

    const [showClearChatConfirm, setShowClearChatConfirm] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const settingsPopoverRef = useRef<HTMLDivElement>(null);
    const settingsTriggerRef = useRef<HTMLButtonElement>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    // Last dispatched text PER TAB (keyed by tab id): Stop restores the owning tab's
    // own last human message into the textarea. Per-tab so a second concurrent stream
    // can't overwrite the first tab's value before its Stop is pressed.
    const lastSentTextRef = useRef<Map<string, string>>(new Map());
    // Per tab: true only when that tab's last dispatched message was typed by a human
    // (handleSend). Auto-execute feedback (terminal-output envelopes, kickoff/decline
    // notes sent via pendingMessage) sets it false so a Stop/pause cancel never
    // restores that machine text into the human prompt textarea.
    const lastSentWasHumanRef = useRef<Map<string, boolean>>(new Map());
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Model list
    const [availableModels, setAvailableModels] = useState<AIModelInfo[]>([]);
    const [modelLoadError, setModelLoadError] = useState(false);

    // ── Clear conversations on provider change ──
    // (Auth itself is handled window-wide by useAiAuthOwner.)
    const prevProviderRef = useRef(activeAiProvider);
    const paneIdRef = useRef(paneId);
    paneIdRef.current = paneId;

    useEffect(() => {
        if (prevProviderRef.current !== activeAiProvider) {
            prevProviderRef.current = activeAiProvider;
            // Provider switch invalidates all in-progress conversations.
            resetAllStreams();
            setSelectedModel('Unspecified');
            // Messages restart at index 0, so blockKey-based auto-exec tracking must
            // be reset too — otherwise a `3:ls` in the new conversation is treated as
            // already-processed and never classifies/runs, and stale badges linger.
            resetAllTabTrackingRef.current();
            // Histories are keyed per tab now, so clear each tab's session (a bare
            // paneId key no longer exists). Fall back to the paneId if no tabs.
            const tabs = chatStateRef.current?.tabs ?? [];
            if (tabs.length > 0) {
                for (const tb of tabs) {
                    tauriService.aiChatClear(aiBackendSessionId(paneIdRef.current, tb.id)).catch(() => {});
                }
            } else {
                tauriService.aiChatClear(paneIdRef.current).catch(() => {});
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeAiProvider]);


    // ── Real-time System Prompt Update ──
    // `effectiveLanguage` is derived from BOTH the AI-language setting and the app
    // UI language, so a change to either regenerates the instruction — that is what
    // makes an in-progress conversation switch language.
    useEffect(() => {
        const selectedPersona = aiPersonas?.find(p => p.label === selectedExpertise);
        const basePrompt = selectedPersona?.systemPrompt || aiPersonas?.[0]?.systemPrompt || 'You are a helpful assistant.';
        const extraInstructions = buildExecutionRules();
        const langInstruction = languageDirective(effectiveLanguage);
        const newInstruction = `${basePrompt}${extraInstructions}${langInstruction}`;
        setLocalSystemInstruction(newInstruction);
        onChatStateChange?.({ systemInstruction: newInstruction });
        // Arm the one-shot in-band switch notice on an ACTUAL change (never on
        // mount) for EVERY open conversation: each tab is its own backend session
        // with its own replayed history, so each needs the switch marked at its own
        // next turn. Stale tab ids are harmless — they're only ever deleted.
        if (prevEffectiveLangRef.current !== null && prevEffectiveLangRef.current !== effectiveLanguage) {
            langNudgeTabsRef.current = new Set((chatStateRef.current?.tabs ?? []).map(t => t.id));
        }
        prevEffectiveLangRef.current = effectiveLanguage;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedExpertise, effectiveLanguage, aiPersonas]);

    // ── Scroll to bottom on new messages ──
    const prevMessagesLength = useRef(messages.length);
    const lastScrollType = useRef<'streaming-start' | null>(null);

    useEffect(() => {
        if (scrollContainerRef.current) {
            if (messages.length > prevMessagesLength.current) {
                const lastMsg = messages[messages.length - 1];
                if (lastMsg.role === 'model') {
                    const modelMsgs = scrollContainerRef.current.querySelectorAll('.ai-chat-message-model');
                    if (modelMsgs.length > 0) {
                        modelMsgs[modelMsgs.length - 1].scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                } else {
                    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
                }
            } else if (isStreaming && streamingContent) {
                if (lastScrollType.current !== 'streaming-start') {
                    const modelMsgs = scrollContainerRef.current.querySelectorAll('.ai-chat-message-model.streaming');
                    if (modelMsgs.length > 0) {
                        modelMsgs[0].scrollIntoView({ behavior: 'smooth', block: 'start' });
                        lastScrollType.current = 'streaming-start';
                    }
                }
            } else if (!isStreaming) {
                lastScrollType.current = null;
            }
            prevMessagesLength.current = messages.length;
        }
    }, [messages, streamingContent, isStreaming]);

    // ── Auto-send pending messages, up to `maxConcurrentStreams` in flight ──
    // Dispatches queued messages to IDLE tabs, filling the pane's free stream slots
    // (cap − currently-streaming). HUMAN messages (pendingUserMessages — typed while a
    // response was still streaming) win over machine-generated ones (pendingMessages)
    // across all tabs, so a user's message reaches the model as its NEXT thinking turn
    // ahead of e.g. auto-exec terminal output. Results that arrive on a non-active tab
    // still re-run this loop, so it keeps draining across tab switches. Double-dispatch
    // is prevented structurally: dispatching dequeues the message AND marks the tab
    // streaming (both committed), so the next run's slot count / streaming set exclude
    // it; within a single run a local `dispatched` set caps one message per tab.
    useEffect(() => {
        if (!isAuthenticated || !chatState) return;
        const slots = Math.max(0, maxConcurrentStreams - streamingTabIds.size);
        if (slots === 0) return;

        // A freshly-created pane (e.g. opened via Ask AI) hasn't resolved its model
        // yet — the model list loads and auto-selects asynchronously. Leave the queues
        // intact until it settles; this effect re-runs on selectedModel / availableModels
        // / modelLoadError change. (`Unspecified` WITH a loaded list is handled per-pick
        // below as "no model chosen".)
        if (selectedModel === 'Unspecified' && availableModels.length === 0 && !modelLoadError) {
            return;
        }

        // Data-sharing consent gate: pending messages (human sends queued mid-stream,
        // plus machine kickoff / terminal-output envelopes / decline notes) egress
        // terminal data to the provider just like a manual send, so they must clear
        // the same consent. Park the queues (don't dequeue) and prompt once; the effect
        // re-runs when consent flips accepted.
        if (!aiDataConsentAccepted) {
            const hasQueued = chatState.tabs.some(
                (tb) => (tb.pendingUserMessages?.length ?? 0) > 0 || (tb.pendingMessages?.length ?? 0) > 0,
            );
            if (hasQueued && !consentPromptShownRef.current) {
                consentPromptShownRef.current = true;
                void ensureConsent?.().finally(() => { consentPromptShownRef.current = false; });
            }
            return;
        }

        // Select up to `slots` picks: user queues first (tab order), then machine
        // queues. One pick per idle tab (a tab already streaming, or already picked
        // this run, is skipped). Human entries carry optional images; machine entries
        // are plain strings.
        const dispatched = new Set<string>(streamingTabIds);
        const picks: { tab: ChatTab; message: string; images?: ChatImage[]; isHuman: boolean }[] = [];
        const consider = (human: boolean) => {
            for (const tab of chatState.tabs) {
                if (picks.length >= slots) break;
                if (dispatched.has(tab.id)) continue;
                if (human) {
                    const uq = tab.pendingUserMessages;
                    if (!uq || uq.length === 0) continue;
                    picks.push({ tab, message: uq[0].text, images: uq[0].images, isHuman: true });
                } else {
                    const mq = tab.pendingMessages;
                    if (!mq || mq.length === 0) continue;
                    picks.push({ tab, message: mq[0], isHuman: false });
                }
                dispatched.add(tab.id);
            }
        };
        consider(true);
        consider(false);
        if (picks.length === 0) return;

        const sysInstr = chatState.systemInstruction || localSystemInstruction;
        onChatStateChange?.({ systemInstruction: sysInstr });

        for (const { tab, message: pm, images: pmImages, isHuman } of picks) {
            // Append the watched-terminal alias list (per dispatched tab) so a reply to
            // auto-exec output / kickoff can route via `target=<alias>`. Not stored —
            // the stored instruction stays persona+rules+lang; the list is send-only.
            const targetsBlock = buildWatchTargetsBlock(buildAliasEntries((tab.linkedSessions ?? []).map((w) => {
                const rec = sessions?.get(w.sessionId);
                const ls = linkableById.get(w.sessionId);
                return { sessionId: w.sessionId, displayName: rec?.displayName ?? ls?.displayName ?? w.sessionId, status: rec?.status ?? ls?.status };
            })));
            // One-shot language-switch notice for this tab (send-only, never stored
            // or rendered — the transcript keeps the clean text, same convention as
            // the watched-terminal context prefix). Appended at the END so
            // useAiChat.sendMessage's "Terminal Output (Command:" prefix check and
            // the auto-exec envelope parsing both still see an unchanged head.
            const sentPm = langNudgeTabsRef.current.delete(tab.id)
                ? pm + languageSwitchNotice(effectiveLanguage)
                : pm;
            // Remove the head of the queue we're dispatching from.
            if (isHuman) onDequeuePendingUser?.(tab.id);
            else onDequeuePending?.(tab.id);

            if (selectedModel === 'Unspecified') {
                setMessagesByTab((prev) => {
                    const next = new Map(prev);
                    const cur = prev.get(tab.id) ?? [];
                    next.set(tab.id, [
                        ...cur,
                        { role: 'user', content: pm, images: pmImages },
                        { role: 'model', content: t('aiChat.pane.modelNotSelected') },
                    ]);
                    return next;
                });
                continue;
            }

            setMessagesByTab((prev) => {
                const next = new Map(prev);
                const cur = prev.get(tab.id) ?? [];
                next.set(tab.id, [...cur, { role: 'user', content: pm, images: pmImages }]);
                return next;
            });
            lastSentTextRef.current.set(tab.id, pm);
            // Human-queued sends restore to the textarea on Stop (edit/resend), just
            // like a direct manual send; machine messages must never land there.
            lastSentWasHumanRef.current.set(tab.id, isHuman);
            markStreaming(tab.id, true);
            setStreamingForTab(tab.id, '');
            armStreamWatchdog(tab.id);
            tauriService.aiChatSend(aiBackendSessionId(paneId, tab.id), sentPm, selectedModel, sysInstr + targetsBlock, pmImages).catch((err) => {
                logError('AI', 'aiChatSend invoke failed', err);
                clearStreamWatchdog(tab.id);
                markStreaming(tab.id, false);
            });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chatState, isAuthenticated, streamingTabIds, paneId, selectedModel, availableModels, modelLoadError, aiDataConsentAccepted, maxConcurrentStreams]);

    // ── Auto-kickoff: Network Expert start-of-session protocol (multi-device) ──
    // When a Network Expert chat WATCHES one or more LIVE terminals, inject the
    // start-of-session protocol (device ID → paging disable) as a pending message —
    // once PER watched device — WITHOUT the user typing a first message. Requires
    // auth + a model so the auto-send loop can dispatch it.
    //
    // kickedForDeviceRef tracks, per tab, a Map of DEVICE → the session id we last
    // acted on. The device key is the config-derived binding key (host/port/user,
    // serial port, …) when known, else the session id — stable across a reconnect
    // (which mints a new session id for the SAME device), so a reconnect (id changed,
    // key unchanged) is told apart from a genuinely new device.
    //
    // One pending message is enqueued per effect run; the pending/stream guards gate
    // the next device, so devices are prepped SEQUENTIALLY (never colliding on one
    // backend session). Each message is TARGETED at its terminal via `target=<alias>`
    // when several are watched, so the command lands on the right one. Adding a
    // terminal is ADDITIVE — never treated as a device "switch" that clears the
    // conversation (multi-watch keeps every device's context).
    // Behavior per watched device:
    //   - Never kicked → full kickoff (skipped only when the user already typed into
    //     an otherwise-unkicked chat — we never hijack a manual conversation).
    //   - Same device, new session id (reconnect) mid-conversation → lightweight
    //     paging re-disable; an empty conversation just updates tracking.
    const kickedForDeviceRef = useRef<Map<string, Map<string, string>>>(new Map());
    // Now that every per-tab tracking ref exists, wire the forward handle used by
    // the provider-switch and logout effects (declared above these refs).
    resetAllTabTrackingRef.current = () => {
        clearAllCountdownTimers();
        applyAutoExec({ type: 'resetAll' });
        kickedForDeviceRef.current.clear();
    };
    useEffect(() => {
        if (!isNetworkExpert) return;
        if (!isAuthenticated || selectedModel === 'Unspecified') return;
        if (!activeTabId || isStreaming) return;
        if (activeTab?.pendingMessages?.length) return;   // one kickoff in flight at a time
        const watched = activeTab?.linkedSessions ?? [];
        if (watched.length === 0) return;

        // Aliases so a per-device message can name its terminal (target=<alias>); the
        // SAME builder feeds the system-prompt alias list, so the two agree.
        const aliasEntries = buildAliasEntries(watched.map((w) => {
            const rec = sessions?.get(w.sessionId);
            const ls = linkableById.get(w.sessionId);
            return { sessionId: w.sessionId, displayName: rec?.displayName ?? ls?.displayName ?? w.sessionId, status: rec?.status ?? ls?.status };
        }));
        const multi = watched.length >= 2;

        let kicked = kickedForDeviceRef.current.get(activeTabId);
        if (!kicked) { kicked = new Map(); kickedForDeviceRef.current.set(activeTabId, kicked); }

        for (let i = 0; i < watched.length; i++) {
            const w = watched[i];
            const status = sessions?.get(w.sessionId)?.status ?? linkableById.get(w.sessionId)?.status;
            if (status !== 'connected') continue;          // only prep LIVE terminals
            const deviceId = w.bindingKey ?? w.sessionId;
            const alias = aliasEntries[i]?.alias;
            const prevSession = kicked.get(deviceId);

            if (prevSession === undefined) {
                // Never kicked this device. Don't hijack a chat the user started
                // manually (messages exist but nothing was ever auto-kicked here).
                if (messages.length > 0 && kicked.size === 0) return;
                kicked.set(deviceId, w.sessionId);
                resetAutoExecCountForTab(activeTabId);
                onEnqueuePending?.(activeTabId, multi && alias ? withTargetDirective(NETWORK_EXPERT_KICKOFF, alias) : NETWORK_EXPERT_KICKOFF);
                return;                                    // one device per run — the queue drains, then re-run
            }
            if (prevSession !== w.sessionId) {
                // Same device, new session id → reconnect. Remember the new id; only
                // re-prep paging when there is a conversation to preserve.
                kicked.set(deviceId, w.sessionId);
                if (messages.length === 0) return;
                resetAutoExecCountForTab(activeTabId);
                onEnqueuePending?.(activeTabId, multi && alias ? withTargetDirective(NETWORK_EXPERT_RECONNECT_PREP, alias) : NETWORK_EXPERT_RECONNECT_PREP);
                return;
            }
        }
    // sessions/linkableById are read inside but re-runs are driven by the compact
    // watchLivenessKey + the watched set; matches the pattern used by the send loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        isNetworkExpert, isAuthenticated, selectedModel, activeTabId,
        activeTab?.linkedSessions, watchLivenessKey, messages.length, isStreaming,
        activeTab?.pendingMessages?.length, onEnqueuePending,
    ]);


    // ── Clear all conversations on explicit logout only ──
    // Keyed on logoutNonce (bumped solely by the ai-auth-logout broadcast), NOT
    // on the authenticated→false edge — a failed sign-in, provider switch, or a
    // cross-window auto-auth race also drop that flag but must NOT wipe history.
    const prevLogoutNonceRef = useRef(logoutNonce);
    useEffect(() => {
        if (prevLogoutNonceRef.current === logoutNonce) return;
        prevLogoutNonceRef.current = logoutNonce;
        resetAllStreams();
        // Reset per-tab auto-exec/kickoff tracking too, mirroring performClearChat —
        // otherwise stale badges and blockKeys shadow the post-re-login conversation.
        resetAllTabTrackingRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [logoutNonce]);

    // ── Prune per-tab state/refs for closed tabs ──
    // Keyed on the SET of tab ids (not the tabs array, which changes on every
    // pendingMessage enqueue) so a long-running pane doesn't accumulate closed
    // tabs' conversations, streaming buffers, and auto-exec tracking forever.
    const tabIdsKey = (chatState?.tabs ?? []).map((t) => t.id).join(',');
    useEffect(() => {
        const liveIds = new Set((chatStateRef.current?.tabs ?? []).map((t) => t.id));
        const pruneMap = (m: Map<string, unknown>) => {
            for (const id of [...m.keys()]) if (!liveIds.has(id)) m.delete(id);
        };
        applyAutoExec({ type: 'prune', liveTabIds: liveIds });
        // Drop any pending countdown timers owned by tabs that just closed (timer key
        // is `${tabId} ${blockKey}`; a tab id never contains a space).
        for (const [key, timer] of [...countdownTimersRef.current]) {
            const tabId = key.slice(0, key.indexOf(' '));
            if (!liveIds.has(tabId)) { clearTimeout(timer); countdownTimersRef.current.delete(key); }
        }
        pruneMap(kickedForDeviceRef.current as Map<string, unknown>);
        // Per-tab refs the send loop / Stop restore keep for each conversation.
        pruneMap(lastSentTextRef.current as Map<string, unknown>);
        pruneMap(lastSentWasHumanRef.current as Map<string, unknown>);
        // Drop closed tabs' auto-exec streak counters (state, so it re-renders).
        setAutoExecCountByTab((prev) => {
            let changed = false;
            const next = new Map(prev);
            for (const id of [...next.keys()]) if (!liveIds.has(id)) { next.delete(id); changed = true; }
            return changed ? next : prev;
        });
        pruneStreams(liveIds);
    }, [tabIdsKey, applyAutoExec, pruneStreams]);

    // ── Auto-execute safe commands ──
    // Assigned later; the effect calls it via ref (forward reference). Runs a
    // command on a SPECIFIC tab's linked session (auto-exec can complete on a
    // background tab), not the active tab.
    const handleRunCommandForTabRef = useRef<(tabId: string, cmd: string, target?: string) => void>(() => {});
    // Auto-execute, fired by useChatStream's onStreamComplete when a tab's stream
    // ends (replacing the old streamingTabIds Set-diff). Runs post-commit, so the
    // completed model message is already in `tabMessages`. Classifies that message's
    // last execute command and, if judged safe, runs it (immediately or after the
    // pre-run countdown) on the completed tab's linked session — which may be a
    // background tab, hence resolveTabTarget(tabId) rather than the active link.
    // Assigned to the indirection ref each render so the hook invokes the latest
    // closure (current settings). No effect-cleanup aborter is needed: the reserve
    // guard blocks a duplicate, and every run precondition is re-checked post-await.
    const handleStreamComplete = (tabId: string, tabMessages: ChatMessage[]) => {
        if (commandExecutionMode !== 'auto-execute-safe') return;
        const lastMsg = tabMessages[tabMessages.length - 1];
        if (!lastMsg || lastMsg.role !== 'model') return;
        const blocks = extractExecuteBlocks(lastMsg.content);
        if (blocks.length === 0) return;

        const { command, target } = blocks[blocks.length - 1];
        const blockKey = `${tabMessages.length - 1}:${command}`;
        // Reserve the block BEFORE the await so a re-render during classification
        // can't fire a second, duplicate classification/run for the same command.
        // `reserve` marks it "classifying" and no-ops if already reserved; the
        // synchronous ref mirror preserves the pre-reducer guard's timing.
        if (hasBlock(autoExecStateRef.current, tabId, blockKey)) return;
        applyAutoExec({ type: 'reserve', tabId, blockKey, command });

        (async () => {
            let decision: AutoExecDecision;
            try {
                decision = await decideAutoExec(command, {
                    strategy: classifierStrategy,
                    whitelist: whitelistCommands,
                    blacklist: blacklistCommands,
                    model: selectedModelRef.current,
                    providerId: activeAiProvider,
                    confidenceThreshold: aiClassifyConfidenceThreshold,
                });
            } catch {
                decision = { autoExec: false, reason: 'classification error', source: 'fallback' };
            }

            // Record the verdict (classifying → classified). If the user declined
            // during the await, the block is already "declined" and `decide` leaves
            // that status intact — the guard below then bails without auto-running.
            applyAutoExec({ type: 'decide', tabId, blockKey, decision });

            if (!decision.autoExec) return;
            // Re-validate run preconditions against the LATEST state (they may
            // have changed while classification was in flight). Declined is keyed
            // by blockKey so declining THIS block doesn't shadow the same command
            // elsewhere.
            if (getBlock(autoExecStateRef.current, tabId, blockKey)?.status === 'declined') return;
            if (autoExecPausedRef.current) return;
            if (!resolveTabTarget(tabId, target).live) return; // this tab's resolved target, not active
            if (maxConsecutiveAutoExecutionsRef.current > 0
                && getAutoExecCount(tabId) >= maxConsecutiveAutoExecutionsRef.current) return;

            // Grace period: rather than run immediately, arm a cancellable
            // countdown so the user can stop a safe auto-run before it fires.
            // 0s (or an unset/invalid value) preserves the old immediate behaviour.
            const rawCountdown = aiAutoExecCountdownSecsRef.current;
            const countdownSecs = Number.isFinite(rawCountdown) ? Math.max(0, Math.min(10, rawCountdown)) : 0;
            if (countdownSecs <= 0) {
                applyAutoExec({ type: 'execute', tabId, blockKey });
                setAutoExecCountForTab(tabId, prev => prev + 1);
                handleRunCommandForTabRef.current(tabId, command, target);
                return;
            }
            const runAt = Date.now() + countdownSecs * 1000;
            applyAutoExec({ type: 'schedule', tabId, blockKey, runAt });
            const key = countdownTimerKey(tabId, blockKey);
            const timer = setTimeout(() => {
                countdownTimersRef.current.delete(key);
                // Re-validate against the LATEST state — the countdown may have been
                // cancelled/declined/cleared, the link dropped, auto-exec paused, or
                // the streak cap reached while it ran.
                if (getBlock(autoExecStateRef.current, tabId, blockKey)?.status !== 'scheduled') return;
                if (autoExecPausedRef.current || !resolveTabTarget(tabId, target).live
                    || (maxConsecutiveAutoExecutionsRef.current > 0
                        && getAutoExecCount(tabId) >= maxConsecutiveAutoExecutionsRef.current)) {
                    applyAutoExec({ type: 'cancelSchedule', tabId, blockKey });
                    return;
                }
                applyAutoExec({ type: 'execute', tabId, blockKey });
                setAutoExecCountForTab(tabId, prev => prev + 1);
                handleRunCommandForTabRef.current(tabId, command, target);
            }, countdownSecs * 1000);
            countdownTimersRef.current.set(key, timer);
        })();
    };
    streamCompleteHandlerRef.current = handleStreamComplete;

    useEffect(() => {
        if (commandExecutionMode === 'ask-before-execute') {
            setAutoExecPaused(false);
            setAutoExecCountByTab(new Map());   // nothing auto-runs → clear every tab's streak
            // Nothing auto-runs in ask mode → stop any in-flight countdowns.
            cancelAllScheduled();
        }
    }, [commandExecutionMode, cancelAllScheduled]);

    // Pausing auto-exec must also stop pending countdowns (each reverts to a manual
    // Run/Decline) — otherwise a scheduled command would still fire after Pause.
    useEffect(() => {
        if (autoExecPaused) cancelAllScheduled();
    }, [autoExecPaused, cancelAllScheduled]);

    // Belt-and-braces: clear every countdown timer on unmount so a fired timer can't
    // touch a torn-down pane.
    useEffect(() => clearAllCountdownTimers, [clearAllCountdownTimers]);

    // ── Load models when authenticated ──
    // An empty/failed fetch retries with backoff (MODEL_LOAD_RETRY_DELAYS_MS)
    // before surfacing the error banner: startup can race transient conditions
    // (network not yet up, backend token refresh in flight), and this effect is
    // one-shot per sign-in — without retries a single blip pinned the banner
    // until restart. isLoadingModels stays true across the whole retry window.
    useEffect(() => {
        if (!isAuthenticated) return;
        let aborted = false;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        // Bump the shared generation so a region change (handleRegionChange) that
        // starts its own load can invalidate this retry chain — otherwise a late
        // retry could show the failure banner over the region's healthy result.
        const myGen = ++modelLoadGenRef.current;
        const stale = () => aborted || modelLoadGenRef.current !== myGen;
        setIsLoadingModels(true);
        setModelLoadError(false);
        const attempt = async (attemptIdx: number) => {
            try {
                if (activeAiProvider === 'vertexai') {
                    // Sign-in happens in Settings → AI after this pane mounted,
                    // so re-read the region persisted by that sign-in — the
                    // lazy state initializer above may hold a stale value.
                    const storedRegion = localStorage.getItem(STORAGE_KEYS.VERTEXAI_SELECTED_REGION)
                        || localStorage.getItem(STORAGE_KEYS.VERTEXAI_LOCATION)
                        || selectedRegion;
                    if (storedRegion !== selectedRegion) setSelectedRegion(storedRegion);
                    await tauriService.aiSetLocation(storedRegion);
                    tauriService.aiListLocations().then(locations => {
                        if (!aborted && locations.length > 0) setAvailableRegions(locations);
                    }).catch(() => {});
                }
                const models = await tauriService.aiListModels();
                if (stale()) return;
                if (models.length === 0) throw new Error('empty model list');
                setAvailableModels(models);
                setSelectedModel(prev => {
                    const savedModel = localStorage.getItem(STORAGE_KEYS.AI_SELECTED_MODEL_PER_PROVIDER(activeAiProvider));
                    const candidate = prev === 'Unspecified' && savedModel ? savedModel : prev;
                    if (candidate === 'Unspecified') return 'Unspecified';
                    const stillAvailable = models.some(m => m.name === candidate);
                    const resolved = stillAvailable ? candidate : 'Unspecified';
                    if (resolved !== 'Unspecified') {
                        onChatStateChange?.({ selectedModel: resolved });
                    }
                    return resolved;
                });
                setIsLoadingModels(false);
            } catch {
                if (stale()) return;
                const delay = MODEL_LOAD_RETRY_DELAYS_MS[attemptIdx];
                console.debug(`[AI] model list attempt ${attemptIdx + 1} failed${delay !== undefined ? `, retrying in ${delay}ms` : ', giving up'}`);
                if (delay !== undefined) {
                    retryTimer = setTimeout(() => { attempt(attemptIdx + 1); }, delay);
                } else {
                    setModelLoadError(true);
                    setIsLoadingModels(false);
                }
            }
        };
        attempt(0);
        return () => {
            aborted = true;
            if (retryTimer) clearTimeout(retryTimer);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated]);

    // ── Handlers ──
    const handleRegionChange = async (region: string) => {
        // Invalidate any in-flight model-list retry chain so a late retry can't
        // overwrite this region's result with a spurious failure banner.
        modelLoadGenRef.current++;
        setSelectedRegion(region);
        localStorage.setItem(STORAGE_KEYS.VERTEXAI_SELECTED_REGION, region);
        setSelectedModel('Unspecified');
        setAvailableModels([]);
        setModelLoadError(false);
        setIsLoadingModels(true);
        try {
            await tauriService.aiSetLocation(region);
            const models = await tauriService.aiListModels();
            if (models.length > 0) {
                setAvailableModels(models);
                const savedModel = localStorage.getItem(STORAGE_KEYS.AI_SELECTED_MODEL_PER_PROVIDER(activeAiProvider));
                if (savedModel && models.some(m => m.name === savedModel)) {
                    setSelectedModel(savedModel);
                    onChatStateChange?.({ selectedModel: savedModel });
                }
            } else {
                setModelLoadError(true);
            }
        } catch {
            setModelLoadError(true);
        } finally {
            setIsLoadingModels(false);
        }
    };

    // Run a command on a SPECIFIC tab's linked session. Used both by the manual
    // Run button (for the active tab) and by auto-exec (which can complete on a
    // background tab whose linked session differs from the active one).
    const handleRunCommandForTab = (tabId: string, command: string, target?: string) => {
        const { sid, live, status } = resolveTabTarget(tabId, target);
        if (!sid) return;
        const cleanCmd = command.trim();
        // Fail loudly when the linked terminal isn't live. Without this, sending to
        // a dead/stale session is a silent no-op (the backend has no such session,
        // and the send error is swallowed) — the exact symptom after an SSH drop +
        // reconnect where the chat still looks linked. Post a result the model can
        // read so it stops and tells the user to re-link.
        if (!live) {
            onEnqueuePending?.(tabId, notConnectedNote(cleanCmd, status));
            return;
        }
        // Pass the originating tab id so the result is delivered back to the same tab,
        // even if the user switches tabs while the command is executing.
        onRunCommand?.(sid, cleanCmd, tabId);
        // Only steal focus for the tab the user is actually looking at.
        if (tabId === activeTabIdRef.current) {
            tauriService.focusWindow().catch(() => {});
            window.dispatchEvent(new CustomEvent('hotty-focus-session', { detail: { sessionId: sid } }));
        }
    };
    handleRunCommandForTabRef.current = handleRunCommandForTab;
    const handleRunCommand = (command: string, target?: string) => {
        if (!activeTabId) return;
        handleRunCommandForTab(activeTabId, command, target);
    };

    // "Don't Execute": the user declines a suggested command. The app deterministically
    // records the decline (→ "Declined" badge + auto-exec race guard) and feeds the fact
    // back to the model via the existing pending-message pipe so it can acknowledge and
    // offer an alternative. Keyed by blockKey (`${messageIndex}:${command}`) so declining
    // THIS block never mislabels the same command in another message.
    const handleDeclineCommand = (messageIndex: number, command: string) => {
        if (!activeTabId) return;
        // Terminal "declined" state → the block shows the Declined badge and any
        // in-flight classify for it bails instead of auto-running (decline wins).
        applyAutoExec({ type: 'decline', tabId: activeTabId, blockKey: `${messageIndex}:${command}`, command });
        resetAutoExecCountForTab(activeTabId); // a human intervened — reset the auto-run streak
        onEnqueuePending?.(activeTabId, declinedNote(command.trim()));
    };

    // Cancel a pending auto-run countdown: stop the timer and revert the block to a
    // manual Run/Decline (the command is NOT sent, and the model is not notified —
    // unlike Decline, the user hasn't rejected the command, only the automatic run).
    const handleCancelScheduled = (messageIndex: number, command: string) => {
        if (!activeTabId) return;
        const blockKey = `${messageIndex}:${command}`;
        clearCountdownTimer(activeTabId, blockKey);
        applyAutoExec({ type: 'cancelSchedule', tabId: activeTabId, blockKey });
        resetAutoExecCountForTab(activeTabId); // a human intervened — reset the auto-run streak
    };

    const handleHoverTarget = (isHovering: boolean) => {
        if (!lastTargetSessionId) return;
        window.dispatchEvent(new CustomEvent('hotty-highlight-session', {
            detail: { sessionId: lastTargetSessionId, highlighted: isHovering },
        }));
    };

    // Ingest image files (from paste / drop / the attach button) into pendingImages,
    // filtering to the allowed MIME types and enforcing the per-image size and total
    // count caps client-side (fast feedback; the backend re-validates). Returns the
    // number of images actually accepted so the paste handler knows whether to
    // preventDefault (so a text paste is left untouched).
    const addFiles = useCallback(async (files: File[] | FileList): Promise<number> => {
        setAttachError(null);
        const all = Array.from(files);
        const candidates = all.filter(
            (f) => f.type && IMAGE_ALLOWED_MIME_TYPES.includes(f.type.toLowerCase())
        );
        if (candidates.length === 0) {
            // Something was dropped/selected but nothing was an accepted image type.
            if (all.length > 0) setAttachError(t('aiChat.pane.imageTypeUnsupported'));
            return 0;
        }

        const accepted: ChatImage[] = [];
        let rejectedType = false;
        let rejectedSize = false;
        for (const file of candidates) {
            if (file.size > IMAGE_MAX_BYTES) { rejectedSize = true; continue; }
            try {
                accepted.push(await fileToChatImage(file));
            } catch {
                rejectedType = true;
            }
        }
        if (accepted.length > 0) {
            setPendingImages((prev) => {
                const room = Math.max(0, IMAGE_MAX_COUNT - prev.length);
                if (accepted.length > room) rejectedTooMany.current = true;
                return [...prev, ...accepted.slice(0, room)];
            });
        }
        if (rejectedSize) setAttachError(t('aiChat.pane.imageTooLarge'));
        else if (rejectedType) setAttachError(t('aiChat.pane.imageTypeUnsupported'));
        else if (rejectedTooMany.current) { setAttachError(t('aiChat.pane.tooManyImages')); rejectedTooMany.current = false; }
        return accepted.length;
    }, [t]);

    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const imageFiles: File[] = [];
        for (const item of Array.from(e.clipboardData.items)) {
            if (item.kind === 'file' && item.type.toLowerCase().startsWith('image/')) {
                const file = item.getAsFile();
                if (file) imageFiles.push(file);
            }
        }
        if (imageFiles.length > 0) {
            // Consume the paste so an image doesn't also dump its (empty) text into the box.
            e.preventDefault();
            void addFiles(imageFiles);
        }
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        if (e.dataTransfer?.files?.length) {
            e.preventDefault();
            void addFiles(e.dataTransfer.files);
        }
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        // Allow dropping files onto the input area.
        if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) {
            e.preventDefault();
        }
    };

    const removePendingImage = (idx: number) => {
        setPendingImages((prev) => prev.filter((_, i) => i !== idx));
    };

    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.length) void addFiles(e.target.files);
        // Reset so selecting the same file again re-fires onChange.
        e.target.value = '';
    };

    const handleSend = () => {
        const text = inputText.trim();
        const imagesToSend = pendingImages;
        if ((!text && imagesToSend.length === 0) || selectedModel === 'Unspecified') return;

        // Queue (don't dispatch directly) when THIS tab is already mid-stream — a second
        // send on the same backend session would supersede/cancel the live stream — OR
        // when the pane is at its concurrent-stream cap (a slot will free and the
        // auto-send loop dispatches it). The message goes on the ACTIVE tab's PRIORITY
        // (user) queue so it reaches the model as its next thinking turn, ahead of any
        // machine-generated pending messages. Consent is already granted for a session
        // that's mid-stream, and the loop re-checks consent anyway.
        const activeStreaming = activeTabId ? streamingTabIds.has(activeTabId) : false;
        const atCap = streamingTabIds.size >= maxConcurrentStreams;
        if (activeStreaming || atCap) {
            if (activeTabId) {
                onEnqueuePendingUser?.(activeTabId, text, imagesToSend.length > 0 ? imagesToSend : undefined);
                setInputText('');
                setPendingImages([]);
            }
            return;
        }

        const dispatch = () => {
            if (activeTabId) resetAutoExecCountForTab(activeTabId);
            setMessages(prev => [...prev, { role: 'user', content: text, images: imagesToSend.length > 0 ? imagesToSend : undefined }]);
            if (activeTabId) {
                lastSentTextRef.current.set(activeTabId, text);
                lastSentWasHumanRef.current.set(activeTabId, true);
            }
            setInputText('');
            setPendingImages([]);
            setIsStreaming(true);   // marks the ACTIVE tab streaming (per-tab in useChatStream)
            setStreamingContent('');
            if (activeTabId) armStreamWatchdog(activeTabId);

            const images = imagesToSend.length > 0 ? imagesToSend : undefined;
            // One-shot language-switch notice (send-only): the bubble rendered above
            // and lastSentTextRef both keep the user's clean `text`.
            const sentText = activeTabId && langNudgeTabsRef.current.delete(activeTabId)
                ? text + languageSwitchNotice(effectiveLanguage)
                : text;
            if (onSendMessage) {
                onSendMessage(sentText, images);
            } else {
                tauriService.aiChatSend(aiBackendSessionId(paneId, activeTabId), sentText, selectedModel, localSystemInstruction, images).catch((err) => {
                    logError('AI', 'aiChatSend invoke failed', err);
                    if (activeTabId) clearStreamWatchdog(activeTabId);
                    setIsStreaming(false);
                });
            }
        };

        // Gate on data-sharing consent BEFORE mutating any UI. Declining used to
        // leave a phantom "Thinking…" bubble that only the 180s watchdog cleared
        // (or, if accepted after 180s, dropped the real reply). The consent modal
        // is app-modal, so activeTabId can't change while it's open.
        if (ensureConsent) {
            void ensureConsent().then((ok) => { if (ok) dispatch(); });
        } else {
            dispatch();
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const performClearChat = () => {
        // Clear only the active tab's messages and streaming state (clearTabStream
        // also disarms the watchdog if this tab owned the in-flight stream).
        if (activeTabId) {
            clearTabStream(activeTabId);
            // Reset this tab's auto-exec tracking so the new conversation's first
            // command isn't suppressed by a stale blockKey (message indices restart
            // at 0), stale per-command verdicts don't reappear, and the
            // "Auto-executed" badge doesn't linger from the old chat.
            clearTabCountdownTimers(activeTabId);
            applyAutoExec({ type: 'clearTab', tabId: activeTabId });
            resetAutoExecCountForTab(activeTabId);
            // Cancel any in-flight client-side sleep delay for this tab: clearing
            // sleepDelay invalidates the token its timer checks, so it no-ops.
            onUpdateTabById?.(activeTabId, { sleepDelay: null });
        }
        tauriService.aiChatClear(aiBackendSessionId(paneId, activeTabId)).catch(() => {});
    };

    const handleClearChatClick = () => {
        if (messages.length > 0 || streamingContent) {
            setShowClearChatConfirm(true);
        } else {
            performClearChat();
        }
    };

    useEffect(() => {
        if (!settingsOpen) return;
        const onMouseDown = (e: MouseEvent) => {
            const target = e.target as Node;
            if (settingsPopoverRef.current?.contains(target)) return;
            if (settingsTriggerRef.current?.contains(target)) return;
            setSettingsOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setSettingsOpen(false);
        };
        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [settingsOpen]);

    const handleCancel = () => {
        // Stop is shown only when the ACTIVE tab is streaming (isStreaming is
        // active-tab scoped), so it cancels the active tab's own stream. Other tabs
        // keep streaming — their Stop appears when they become active.
        const targetTabId = activeTabId ?? null;
        if (!targetTabId) return;
        clearStreamWatchdog(targetTabId);
        tauriService.aiChatCancel(aiBackendSessionId(paneId, targetTabId)).catch(() => {});
        const partial = streamingByTab.get(targetTabId) ?? '';
        if (partial) {
            setMessagesByTab(prev => {
                const next = new Map(prev);
                const cur = prev.get(targetTabId) ?? [];
                next.set(targetTabId, [...cur, { role: 'model', content: partial + t('aiChat.pane.cancelledSuffix') }]);
                return next;
            });
        }
        setStreamingForTab(targetTabId, '');
        markStreaming(targetTabId, false);
        // Only restore a HUMAN-typed message for editing/resend. Auto-execute
        // feedback (terminal-output envelopes, kickoff/decline notes) must never
        // land in the human prompt textarea, and any text the user was typing
        // during the stream is left untouched.
        if (lastSentWasHumanRef.current.get(targetTabId)) {
            setInputText(lastSentTextRef.current.get(targetTabId) ?? '');
            setTimeout(() => {
                const ta = textareaRef.current;
                if (ta) {
                    ta.focus();
                    ta.selectionStart = ta.selectionEnd = ta.value.length;
                }
            }, 0);
        }
    };

    const effectiveBg = getTransparentColor(terminalBackground || 'var(--bg-primary)');

    return (
        <div className="ai-chat-pane" style={{ backgroundColor: effectiveBg }}>
            {chatState && chatState.tabs.length > 0 && (
                <TabStrip
                    tabs={chatState.tabs}
                    activeTabId={chatState.activeTabId}
                    onSelect={(id) => {
                        onSelectTab?.(id);
                        // Flash the tab's primary watched terminal's pane.
                        const linkedId = chatState.tabs.find((t) => t.id === id)?.linkedSessions[0]?.sessionId;
                        if (linkedId) onFlashSessionPane?.(linkedId);
                    }}
                    onClose={(id) => {
                        // Closing the last remaining tab closes the whole pane
                        // (browser-style); otherwise just close that conversation.
                        if ((chatState?.tabs.length ?? 0) <= 1) onClosePane?.();
                        else onCloseTab?.(id);
                    }}
                    onAdd={() => onAddTab?.()}
                    streamingTabIds={streamingTabIds}
                />
            )}
            {modelLoadError && (
                <div className="ai-chat-auth-error" style={{ margin: '8px 12px' }}>
                    {t('aiChat.pane.modelListError')}
                    <button onClick={() => setModelLoadError(false)} style={{ marginLeft: 8, cursor: 'pointer', background: 'none', border: 'none', color: 'inherit', textDecoration: 'underline' }}>{t('aiChat.pane.dismiss')}</button>
                </div>
            )}
            <div className="ai-chat-header">
                <div className="ai-chat-header-left">
                    <div className="ai-chat-logo">
                        <AIIcon size={24} provider={activeAiProvider} />
                    </div>
                    {/* Watched-terminal control (Phase 2): a wrapping ROW of chips —
                        one per watched terminal (click = jump to it, × = remove,
                        greyed when disconnected) — followed by a "+" picker to watch
                        another terminal (this window or another), excluding those
                        already watched. Adding/removing terminals here is symmetric
                        with the terminal tab's "AI Watch" toggle. */}
                    {isAuthenticated && (watchedTerminals.length > 0 || addLinkGroups.local.length + addLinkGroups.remote.length > 0) && (
                        <div className="ai-chat-link-row">
                            {watchedTerminals.map((w) => {
                                const name = sessions?.get(w.sessionId)?.displayName ?? linkableById.get(w.sessionId)?.displayName;
                                const status = sessions?.get(w.sessionId)?.status ?? linkableById.get(w.sessionId)?.status;
                                const stale = status !== 'connected';
                                const label = name || t('aiChat.pane.terminalFallback');
                                return (
                                    <div
                                        key={w.sessionId}
                                        className={`ai-chat-link${stale ? ' ai-chat-link-stale' : ''}`}
                                        style={activeConvColor ? ({ '--accent-color': activeConvColor } as React.CSSProperties) : undefined}
                                    >
                                        <button
                                            type="button"
                                            className={`ai-chat-linked-chip${stale ? ' ai-chat-linked-chip-stale' : ''}`}
                                            onClick={() => {
                                                tauriService.focusWindow().catch(() => {});
                                                window.dispatchEvent(new CustomEvent('hotty-focus-session', { detail: { sessionId: w.sessionId } }));
                                            }}
                                            onMouseEnter={() => {
                                                window.dispatchEvent(new CustomEvent('hotty-highlight-session', { detail: { sessionId: w.sessionId, highlighted: true } }));
                                            }}
                                            onMouseLeave={() => {
                                                window.dispatchEvent(new CustomEvent('hotty-highlight-session', { detail: { sessionId: w.sessionId, highlighted: false } }));
                                            }}
                                            title={stale
                                                ? t('aiChat.pane.linkedChipTitleStale', { name: label, status: status ?? t('aiChat.pane.statusDisconnected') })
                                                : t('aiChat.pane.linkedChipTitle', { name: label })}
                                            aria-label={stale
                                                ? t('aiChat.pane.linkedChipAriaStale', { name: label, status: status ?? t('aiChat.pane.statusDisconnected') })
                                                : t('aiChat.pane.linkedChipAria', { name: label })}
                                        >
                                            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                                            </svg>
                                            <span className="ai-chat-linked-chip-name">
                                                {label}{stale ? t('aiChat.pane.disconnectedSuffix') : ''}
                                            </span>
                                        </button>
                                        <button
                                            type="button"
                                            className="ai-chat-link-unlink"
                                            title={t('aiChat.pane.linkedChipRemove', { name: label })}
                                            aria-label={t('aiChat.pane.linkedChipRemove', { name: label })}
                                            onClick={() => onRemoveLink?.(w.sessionId)}
                                        >
                                            {/* broken-chain (link-off) icon */}
                                            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                                                <path d="M17 7h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1 0 1.43-.98 2.63-2.31 2.98l1.46 1.46C20.88 15.61 22 13.95 22 12c0-2.76-2.24-5-5-5zm-1 4h-2.19l2 2H16v-2zM2 4.27l3.11 3.11C3.29 8.12 2 9.91 2 12c0 2.76 2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1 0-1.59 1.21-2.9 2.76-3.07L8.73 11H8v2h2.73L13 15.27V17h1.73l4.01 4.01 1.41-1.41L3.41 2.86 2 4.27z" />
                                            </svg>
                                        </button>
                                    </div>
                                );
                            })}
                            {(addLinkGroups.local.length + addLinkGroups.remote.length) > 0 && (
                                <div className="ai-chat-link-attach ai-chat-link-add">
                                    {/* plus icon */}
                                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <line x1="12" y1="5" x2="12" y2="19" />
                                        <line x1="5" y1="12" x2="19" y2="12" />
                                    </svg>
                                    <span className="ai-chat-link-attach-label">{t('aiChat.pane.addTerminal')}</span>
                                    <select
                                        className="ai-chat-link-select"
                                        value=""
                                        title={t('aiChat.pane.addTerminal')}
                                        aria-label={t('aiChat.pane.addTerminal')}
                                        onMouseDown={() => onRefreshSessions?.()}
                                        onFocus={() => onRefreshSessions?.()}
                                        onChange={(e) => { if (e.target.value) onAddLink?.(e.target.value); }}
                                    >
                                        <option value="" disabled>{t('aiChat.pane.addTerminal')}</option>
                                        {addLinkGroups.local.length > 0 && (
                                            <optgroup label={t('aiChat.pane.linkThisWindow')}>
                                                {addLinkGroups.local.map((s) => (
                                                    <option key={s.sessionId} value={s.sessionId}>{s.displayName}</option>
                                                ))}
                                            </optgroup>
                                        )}
                                        {addLinkGroups.remote.map(([label, list]) => (
                                            <optgroup key={label} label={t('aiChat.pane.linkOtherWindow', { label })}>
                                                {list.map((s) => (
                                                    <option key={s.sessionId} value={s.sessionId}>{s.displayName}</option>
                                                ))}
                                            </optgroup>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>
                    )}
                </div>
                {/* One header action, on the right: clearing the conversation. (A
                    separate "New chat" pill used to sit on the left doing the same
                    thing — the tab strip's + is what opens a new conversation.) */}
                {isAuthenticated && (
                    <div className="ai-chat-header-right">
                        <button
                            type="button"
                            className="ai-chat-new-chat-btn"
                            onClick={handleClearChatClick}
                            title={t('aiChat.pane.clearConversationTitle')}
                            aria-label={t('aiChat.pane.clearConversationTitle')}
                        >
                            {/* trash icon */}
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                            <span>{t('aiChat.pane.clearConversation')}</span>
                        </button>
                    </div>
                )}
            </div>

            {!isAuthenticated ? (
                <div className="ai-chat-unauth-state">
                    <div className="ai-chat-empty-icon">
                        <AIIcon size={56} provider={activeAiProvider} />
                    </div>
                    {isAuthLoading ? (
                        // Silent re-auth in flight (startup / provider switch) — don't
                        // invite a redundant manual sign-in while it's still resolving.
                        <h2 className="ai-chat-empty-title">{t('aiChat.pane.signingIn')}</h2>
                    ) : (
                        <>
                            <h2 className="ai-chat-empty-title">{t('aiChat.pane.notSignedInTitle')}</h2>
                            <p className="ai-chat-unauth-body">
                                {t('aiChat.pane.notSignedInBody', { provider: t(aiProviderLabelKey(activeAiProvider)) })}
                            </p>
                            {onOpenSettings && (
                                <button
                                    type="button"
                                    className="ai-chat-unauth-settings-btn"
                                    onClick={onOpenSettings}
                                >
                                    {t('aiChat.pane.openSettings')}
                                </button>
                            )}
                        </>
                    )}
                </div>
            ) : (
                <div className="ai-chat-body">
                    <div className="ai-chat-messages" ref={scrollContainerRef} aria-live="polite" aria-busy={isStreaming}>
                        {messages.length === 0 && !streamingContent && !isStreaming && (
                            <div className="ai-chat-empty-state">
                                <div className="ai-chat-empty-icon">
                                    <AIIcon size={56} provider={activeAiProvider} />
                                </div>
                                <h2 className="ai-chat-empty-title">{t('aiChat.pane.emptyTitle')}</h2>
                                {watchedTerminals.length > 0 ? (
                                    <div className="ai-chat-empty-target">
                                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                                        </svg>
                                        <span>
                                            <Trans
                                                i18nKey="aiChat.pane.emptyWatching"
                                                values={{ names: watchedNamesLabel || t('aiChat.pane.terminalFallback') }}
                                                components={[<strong key="names" />]}
                                            />
                                        </span>
                                    </div>
                                ) : (
                                    <div className="ai-chat-empty-target ai-chat-empty-target--none">
                                        <span>{t('aiChat.pane.emptyNoTerminal')}</span>
                                    </div>
                                )}
                                <div className="ai-chat-empty-suggestions">
                                    {(lastTargetSessionId ? [
                                        // A terminal is linked — offer output-focused prompts.
                                        'aiChat.pane.suggestionOutputMeaning',
                                        'aiChat.pane.suggestionFindIssues',
                                        'aiChat.pane.suggestionExplainLast',
                                    ] : [
                                        // Nothing linked — generic prompts that don't assume
                                        // terminal output exists.
                                        'aiChat.pane.suggestionGenericCapabilities',
                                        'aiChat.pane.suggestionGenericExplainCommand',
                                        'aiChat.pane.suggestionGenericTroubleshoot',
                                    ]).map((promptKey) => {
                                        const prompt = t(promptKey);
                                        return (
                                        <button
                                            key={promptKey}
                                            type="button"
                                            className="ai-chat-empty-suggestion"
                                            onClick={() => {
                                                setInputText(prompt);
                                                setTimeout(() => textareaRef.current?.focus(), 0);
                                            }}
                                            disabled={selectedModel === 'Unspecified' || isStreaming}
                                        >
                                            {prompt}
                                        </button>
                                        );
                                    })}
                                </div>
                                <p className="ai-chat-empty-tip">
                                    <Trans i18nKey="aiChat.pane.emptyTip" components={[<strong key="askai" />]} />
                                </p>
                            </div>
                        )}
                        {messages.map((msg, idx) => {
                            // Build the per-command badge/verdict lookups for this model
                            // message from the auto-exec reducer state (reading `autoExecState`
                            // here is what keeps the lookups fresh as the async classifier
                            // resolves). A command's identity is its message index + text, so
                            // the same command in two messages is tracked independently.
                            let verdictByCommand: Map<string, AutoExecDecision> | undefined;
                            let classifyingCommands: Set<string> | undefined;
                            let autoExecutedCommands: Set<string> | undefined;
                            let declinedCommands: Set<string> | undefined;
                            let scheduledCommands: Map<string, number> | undefined;
                            if (msg.role === 'model' && activeTabId) {
                                const commands = extractExecuteCommands(msg.content);
                                const dec = collectMessageDecorations(autoExecState, activeTabId, idx, commands);
                                // Declined / auto-executed badges apply in any mode.
                                autoExecutedCommands = dec.autoExecuted;
                                declinedCommands = dec.declined;
                                if (commandExecutionMode === 'auto-execute-safe') {
                                    // Verdict + "checking safety" markers + the pre-run countdown
                                    // all come from the async classifier path.
                                    classifyingCommands = dec.classifying;
                                    verdictByCommand = dec.verdicts;
                                    scheduledCommands = dec.scheduled;
                                } else {
                                    // ask-before-execute mode: nothing auto-runs, but still
                                    // surface the free static safety signal (🛑 blacklist /
                                    // ✅ whitelist) so a dangerous command is never shown with
                                    // no warning. No AI call, no tokens — synchronous.
                                    verdictByCommand = new Map<string, AutoExecDecision>();
                                    for (const cmd of commands) {
                                        const sv = classifyStatic(cmd, { whitelist: whitelistCommands, blacklist: blacklistCommands });
                                        if (sv.source === 'blacklist' || sv.source === 'whitelist') {
                                            verdictByCommand.set(cmd, sv);
                                        }
                                    }
                                }
                            }
                            return (
                            <div key={idx} className={`ai-chat-message ai-chat-message-${msg.role}`}>
                                <div className="ai-chat-message-avatar">
                                    {msg.role === 'user' ? '\u{1F464}' : <AIIcon size={18} provider={activeAiProvider} />}
                                </div>
                                <div className={`ai-chat-message-content ${msg.role === 'model' ? 'ai-chat-markdown' : ''}`}>
                                    {msg.role === 'model' ? (
                                        <MessageContent
                                            content={msg.content}
                                            onRun={(cmd, target) => { if (activeTabId) resetAutoExecCountForTab(activeTabId); handleRunCommand(cmd, target); }}
                                            onDecline={(cmd) => handleDeclineCommand(idx, cmd)}
                                            onHoverTarget={handleHoverTarget}
                                            targetTitle={lastTargetSessionTitle}
                                            targetId={lastTargetSessionId}
                                            targetLive={linkedLive}
                                            resolveBlockTarget={resolveBlockTarget}
                                            autoExecutedCommands={autoExecutedCommands}
                                            declinedCommands={declinedCommands}
                                            scheduledCommands={scheduledCommands}
                                            onCancelScheduled={(cmd) => handleCancelScheduled(idx, cmd)}
                                            verdictByCommand={verdictByCommand}
                                            classifyingCommands={classifyingCommands}
                                            limitReached={commandExecutionMode === 'auto-execute-safe' && maxConsecutiveAutoExecutions > 0 && (activeTabId ? (autoExecCountByTab.get(activeTabId) ?? 0) : 0) >= maxConsecutiveAutoExecutions}
                                            sleepDelay={activeTab?.sleepDelay}
                                        />
                                    ) : (() => {
                                        const parsed = parseTerminalOutputMessage(msg.content);
                                        return (
                                            <>
                                                {msg.images && msg.images.length > 0 && (
                                                    <div className="ai-chat-message-images">
                                                        {msg.images.map((img, i) => (
                                                            <img
                                                                key={i}
                                                                className="ai-chat-message-image"
                                                                src={`data:${img.mimeType};base64,${img.dataBase64}`}
                                                                alt={t('aiChat.pane.imageAlt')}
                                                            />
                                                        ))}
                                                    </div>
                                                )}
                                                {msg.content && (parsed
                                                    ? <TerminalOutputBlock cmd={parsed.cmd} output={parsed.output} />
                                                    : <pre>{msg.content}</pre>)}
                                            </>
                                        );
                                    })()}
                                </div>
                                {msg.role === 'model' && (
                                    <button
                                        type="button"
                                        className="ai-chat-msg-copy-btn"
                                        title={t('aiChat.pane.copyMessage')}
                                        aria-label={t('aiChat.pane.copyMessage')}
                                        onClick={() => { void navigator.clipboard?.writeText(msg.content).catch(() => {}); }}
                                    >
                                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                        </svg>
                                    </button>
                                )}
                            </div>
                            );
                        })}
                        {streamingContent && (
                            <div className="ai-chat-message ai-chat-message-model">
                                <div className="ai-chat-message-avatar"><AIIcon size={18} provider={activeAiProvider} /></div>
                                <div className="ai-chat-message-content ai-chat-markdown streaming">
                                    <MessageContent
                                        content={streamingContent}
                                        onRun={handleRunCommand}
                                        onHoverTarget={handleHoverTarget}
                                        targetTitle={lastTargetSessionTitle}
                                        targetId={lastTargetSessionId}
                                        targetLive={linkedLive}
                                        resolveBlockTarget={resolveBlockTarget}
                                    />
                                </div>
                            </div>
                        )}
                        {isStreaming && !streamingContent && (
                            <div className="ai-chat-message ai-chat-message-model">
                                <div className="ai-chat-message-avatar"><AIIcon size={18} provider={activeAiProvider} /></div>
                                <div className="ai-chat-message-content">
                                    <span className="ai-chat-thinking">
                                        {t('aiChat.pane.thinking')}
                                        <span className="ai-chat-thinking-dots" aria-hidden="true">
                                            <span>.</span><span>.</span><span>.</span>
                                        </span>
                                    </span>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    <div
                        className="ai-chat-resize-handle"
                        role="separator"
                        aria-orientation="horizontal"
                        aria-label={t('aiChat.pane.resizeInput')}
                        tabIndex={0}
                        onKeyDown={(e) => {
                            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                e.preventDefault();
                                const base = textareaHeight > 0 ? textareaHeight : (textareaRef.current?.offsetHeight || 40);
                                const delta = e.key === 'ArrowUp' ? 20 : -20;
                                setTextareaHeight(Math.min(500, Math.max(20, base + delta)));
                            }
                        }}
                        onMouseDown={(e) => {
                        e.preventDefault();
                        const startY = e.clientY;
                        const startHeight = textareaHeight > 0 ? textareaHeight : (textareaRef.current?.offsetHeight || 40);
                        const onMouseMove = (ev: MouseEvent) => {
                            const delta = startY - ev.clientY;
                            setTextareaHeight(Math.min(500, Math.max(20, startHeight + delta)));
                        };
                        const onMouseUp = () => {
                            document.removeEventListener('mousemove', onMouseMove);
                            document.removeEventListener('mouseup', onMouseUp);
                        };
                        document.addEventListener('mousemove', onMouseMove);
                        document.addEventListener('mouseup', onMouseUp);
                    }} />

                    <div className="ai-chat-input-area" onDrop={handleDrop} onDragOver={handleDragOver}>
                        {(activeTab?.pendingUserMessages?.length ?? 0) > 0 && (
                            <div className="ai-chat-queued-pill" role="status">
                                {t('aiChat.pane.queuedCount', { count: activeTab!.pendingUserMessages!.length })}
                            </div>
                        )}
                        {attachError && (
                            <div className="ai-chat-attach-error" role="alert">{attachError}</div>
                        )}
                        {pendingImages.length > 0 && (
                            <div className="ai-chat-attach-strip">
                                {pendingImages.map((img, i) => (
                                    <div key={i} className="ai-chat-thumb">
                                        <img
                                            className="ai-chat-thumb-img"
                                            src={`data:${img.mimeType};base64,${img.dataBase64}`}
                                            alt={t('aiChat.pane.imageAlt')}
                                        />
                                        <button
                                            type="button"
                                            className="ai-chat-thumb-remove"
                                            title={t('aiChat.pane.removeImage')}
                                            aria-label={t('aiChat.pane.removeImage')}
                                            onClick={() => removePendingImage(i)}
                                        >×</button>
                                    </div>
                                ))}
                            </div>
                        )}
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/gif"
                            multiple
                            style={{ display: 'none' }}
                            onChange={handleFileInputChange}
                        />
                        <textarea
                            ref={textareaRef}
                            className="ai-chat-textarea"
                            rows={1}
                            style={{ height: textareaHeight > 0 ? `${textareaHeight}px` : 'auto' }}
                            value={inputText}
                            onChange={(e) => setInputText(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onPaste={handlePaste}
                            placeholder={selectedModel === 'Unspecified' ? t('aiChat.pane.inputPlaceholderSelectModel') : t('aiChat.pane.inputPlaceholder')}
                        />
                        <div className="ai-chat-input-toolbar">
                            <div className="ai-chat-settings-wrap">
                                <button
                                    ref={settingsTriggerRef}
                                    type="button"
                                    className={`ai-chat-settings-btn${settingsOpen ? ' open' : ''}`}
                                    onClick={() => setSettingsOpen(o => !o)}
                                    title={t('aiChat.pane.aiSettings')}
                                    aria-label={t('aiChat.pane.aiSettings')}
                                    aria-haspopup="dialog"
                                    aria-expanded={settingsOpen}
                                >
                                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <circle cx="12" cy="12" r="3" />
                                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                                    </svg>
                                    <span className="ai-chat-settings-btn-label">{selectedModel === 'Unspecified' ? t('aiChat.pane.settingsButtonSelectModel') : (availableModels.find(m => m.name === selectedModel)?.displayName || selectedModel)}</span>
                                </button>
                                {settingsOpen && (
                                    <div ref={settingsPopoverRef} className="ai-chat-settings-popover" role="dialog" aria-label={t('aiChat.pane.settingsPopoverAriaLabel')}>
                                        <div className="ai-chat-settings-popover-section">
                                            <label className="ai-chat-settings-popover-label">{t('aiChat.pane.labelModel')}</label>
                                            <select
                                                className="ai-chat-settings-popover-select"
                                                value={selectedModel}
                                                onChange={(e) => {
                                                    const model = e.target.value;
                                                    setSelectedModel(model);
                                                    localStorage.setItem(STORAGE_KEYS.AI_SELECTED_MODEL, model);
                                                    localStorage.setItem(STORAGE_KEYS.AI_SELECTED_MODEL_PER_PROVIDER(activeAiProvider), model);
                                                    onChatStateChange?.({ selectedModel: model });
                                                }}
                                                // Changing the model applies to the NEXT message; the
                                                // in-flight stream keeps its own model, so this is safe
                                                // mid-response (important for the auto-exec loop).
                                                disabled={isLoadingModels}
                                            >
                                                {selectedModel === 'Unspecified' && <option value="Unspecified">{isLoadingModels ? t('aiChat.pane.modelLoading') : t('aiChat.pane.modelSelectPlaceholder')}</option>}
                                                {availableModels.map(m => (
                                                    <option key={m.name} value={m.name}>{m.displayName}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="ai-chat-settings-popover-section">
                                            <label className="ai-chat-settings-popover-label">{t('aiChat.pane.labelPersona')}</label>
                                            <div className="ai-chat-settings-popover-persona-row">
                                                <select
                                                    className="ai-chat-settings-popover-select"
                                                    value={selectedExpertise}
                                                    onChange={(e) => setSelectedExpertise(e.target.value)}
                                                >
                                                    {aiPersonas?.map(persona => (
                                                        <option key={persona.id} value={persona.label}>{persona.label}</option>
                                                    ))}
                                                </select>
                                                <button
                                                    type="button"
                                                    className="ai-chat-settings-popover-link-btn"
                                                    onClick={() => { setSettingsOpen(false); setShowPromptModal(true); }}
                                                >
                                                    {t('aiChat.pane.viewPrompt')}
                                                </button>
                                            </div>
                                        </div>
                                        <div className="ai-chat-settings-popover-section">
                                            <label className="ai-chat-settings-popover-label">{t('aiChat.pane.labelLanguage')}</label>
                                            <select
                                                className="ai-chat-settings-popover-select"
                                                value={aiResponseLanguage}
                                                onChange={(e) => updateSetting('aiResponseLanguage', e.target.value)}
                                            >
                                                {/* Option VALUES are the prompt vocabulary interpolated into
                                                    languageDirective, so they stay untranslated English names.
                                                    Only Auto's LABEL is localized, and it names the app UI
                                                    language it currently resolves to. */}
                                                {[AUTO_LANGUAGE, 'English', 'Japanese', 'Chinese', 'Korean', 'Spanish', 'French', 'German', 'Russian'].map(lang => (
                                                    <option key={lang} value={lang}>
                                                        {lang === AUTO_LANGUAGE
                                                            ? t('aiChat.pane.languageAuto', {
                                                                lang: SUPPORTED_LANGUAGES.find(l => l.id === appLanguage)?.label ?? 'English',
                                                            })
                                                            : lang}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        {activeAiProvider === 'vertexai' && (
                                            <div className="ai-chat-settings-popover-section">
                                                <label className="ai-chat-settings-popover-label">{t('aiChat.pane.labelRegion')}</label>
                                                <select
                                                    className="ai-chat-settings-popover-select"
                                                    value={selectedRegion}
                                                    onChange={(e) => handleRegionChange(e.target.value)}
                                                    disabled={isStreaming || isLoadingModels}
                                                >
                                                    {(availableRegions.length > 0 ? availableRegions : [selectedRegion]).map(r => (
                                                        <option key={r} value={r}>{r}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                            <button
                                type="button"
                                className="ai-chat-attach-btn"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={pendingImages.length >= IMAGE_MAX_COUNT}
                                title={t('aiChat.pane.attachImage')}
                                aria-label={t('aiChat.pane.attachImage')}
                            >
                                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                                </svg>
                            </button>
                            <span className="ai-chat-input-toolbar-spacer" />
                            <ExecutionModeBar
                                paused={autoExecPaused}
                                onPausedChange={(next) => {
                                    setAutoExecPaused(next);
                                    if (next && isStreaming) {
                                        handleCancel();
                                    }
                                }}
                                onOpenSettings={onOpenSettings}
                            />
                            {isStreaming && <button className="ai-chat-cancel-btn" onClick={handleCancel} title={t('aiChat.pane.stop')} aria-label={t('aiChat.pane.stop')}>&#x25A0;</button>}
                            <button
                                className="ai-chat-send-btn"
                                onClick={handleSend}
                                disabled={(!inputText.trim() && pendingImages.length === 0) || selectedModel === 'Unspecified'}
                                aria-label={t('aiChat.pane.sendTitle')}
                                title={
                                    selectedModel === 'Unspecified'
                                        ? t('aiChat.pane.sendTitleSelectModel')
                                        : (!inputText.trim() && pendingImages.length === 0)
                                        ? t('aiChat.pane.sendTitleEmpty')
                                        : (isStreaming || streamingTabIds.size >= maxConcurrentStreams)
                                        ? t('aiChat.pane.sendTitleQueue')
                                        : t('aiChat.pane.sendTitle')
                                }
                            >&#x27A4;</button>
                        </div>
                    </div>
                    {selectedModel === 'Unspecified' && !isLoadingModels && availableModels.length > 0 && (
                        <div className="ai-chat-input-hint">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
                                <path d="M12 2L1 21h22L12 2zm0 4l8.53 14.5H3.47L12 6zm-1 5v5h2v-5h-2zm0 7v2h2v-2h-2z" />
                            </svg>
                            <span>{t('aiChat.pane.selectModelHint')}</span>
                        </div>
                    )}
                    {(inputText.length > 0 || isStreaming || totalInputTokens > 0 || totalOutputTokens > 0) && (
                        <div className="ai-token-status">
                            {isStreaming ? (
                                streamingContent.length > 0 ? (
                                    <span>{t('aiChat.pane.tokenReceiving', { tokens: Math.ceil(streamingContent.length / 4).toLocaleString() })}</span>
                                ) : (
                                    <span>{t('aiChat.pane.tokenWaiting')}</span>
                                )
                            ) : (
                                <>
                                    {(totalInputTokens > 0 || totalOutputTokens > 0) && (
                                        <span>{t('aiChat.pane.tokenInOut', { in: totalInputTokens.toLocaleString(), out: totalOutputTokens.toLocaleString() })}</span>
                                    )}
                                    {totalCost !== null && (
                                        <>
                                            <span className="ai-token-status-sep">&middot;</span>
                                            <span>{t('aiChat.pane.tokenCost', { cost: formatAICost(totalCost) })}</span>
                                        </>
                                    )}
                                    {inputText.length > 0 && (
                                        <>
                                            {(totalInputTokens > 0 || totalOutputTokens > 0) && <span className="ai-token-status-sep">&middot;</span>}
                                            <span>{t('aiChat.pane.tokenToSend', { tokens: Math.ceil(inputText.length / 4).toLocaleString() })}</span>
                                        </>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}
            {showPromptModal && (
                <SystemPromptModal
                    personaLabel={selectedExpertise}
                    systemInstruction={localSystemInstruction}
                    onClose={() => setShowPromptModal(false)}
                />
            )}
            {showClearChatConfirm && (
                <ConfirmModal
                    title={t('aiChat.pane.clearConversationConfirmTitle')}
                    message={t('aiChat.pane.clearConversationConfirmMessage')}
                    confirmLabel={t('aiChat.pane.clearConversationConfirmButton')}
                    onConfirm={() => {
                        setShowClearChatConfirm(false);
                        performClearChat();
                    }}
                    onCancel={() => setShowClearChatConfirm(false)}
                />
            )}
        </div>
    );
});
