import React, { useState, useEffect, useRef, useReducer, useCallback, useMemo } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { marked } from 'marked';
import { getTransparentColor } from '../../utils/colorUtils';
import { sanitizeHtml, externalLinkFromClick } from '../../utils/htmlUtils';
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
import { buildExecutionRules, languageDirective, AUTO_LANGUAGE, NETWORK_EXPERT_KICKOFF, NETWORK_EXPERT_RECONNECT_PREP } from '../../constants/aiPrompts';
import { ExecutionModeBar } from './ExecutionModeBar';
import { TerminalOutputBlock } from './TerminalOutputBlock';
import { parseTerminalOutputMessage, notConnectedNote, declinedNote } from './terminalOutputUtils';
import { segmentMessageContent, extractExecuteCommands } from './executeBlockUtils';
import { SystemPromptModal } from '../SystemPromptModal/SystemPromptModal';
import { ConfirmModal } from '../ConfirmModal/ConfirmModal';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAiAuthStore } from '../../stores/aiAuthStore';
import { tauriService } from '../../services/tauriService';
import { logError } from '../../utils/logger';
import type { AiChatState, ChatTab } from '../../hooks/useAiChat';
import { getActiveTab, aiBackendSessionId } from '../../hooks/useAiChat';
import type { SessionRecord } from '../../hooks/useSessionManager';
import type { PersonaDefinition, AIModelInfo, LinkableSession } from '../../types/appTypes';
import { TabStrip } from './TabStrip';
import { groupLinkableSessions } from './linkPicker';
import { MODEL_LOAD_RETRY_DELAYS_MS } from './modelLoadRetry';
import { useChatStream, type ChatMessage } from '../../hooks/useChatStream';
import './AIChatPane.css';

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
    onAddTab?: (initialLinkSessionId?: string) => void;
    onCloseTab?: (tabId: string) => void;
    onSelectTab?: (tabId: string) => void;
    onFlashSessionPane?: (sessionId: string) => void;
    sessions?: Map<string, SessionRecord>;
    onRunCommand?: (sessionId: string, command: string, originatingTabId: string) => void;
    onSendMessage?: (text: string) => void;
    aiPersonas: PersonaDefinition[];
    terminalBackground?: string;
    /** Sessions selectable in the link picker (this window + other windows). */
    linkableSessions?: LinkableSession[];
    /** Link the active tab to a session (any window) or unlink (undefined). */
    onLinkSession?: (sessionId: string | undefined) => void;
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

const VerdictNote: React.FC<{ classifying?: boolean; verdict?: AutoExecDecision }> = ({ classifying, verdict }) => {
    const { t } = useTranslation();
    if (classifying) {
        return <div className="ai-execute-verdict ai-execute-verdict-checking">{t('aiChat.message.checkingSafety')}</div>;
    }
    if (!verdict) return null;

    // Tone: red for blocked, warning for "modifies / uncertain / unverified",
    // success for "will/ did auto-run".
    let tone: 'safe' | 'warn' | 'danger' = 'warn';
    if (verdict.source === 'blacklist') tone = 'danger';
    else if (verdict.autoExec) tone = 'safe';

    const label = t(VERDICT_LABEL_KEY[verdict.source]);
    const confidence = verdict.source === 'ai' && typeof verdict.confidence === 'number'
        ? t('aiChat.message.verdictConfidence', { percent: Math.round(verdict.confidence * 100) })
        : '';

    return (
        <div className={`ai-execute-verdict ai-execute-verdict-${tone}`}>
            <strong>{label}{confidence}:</strong> {verdict.reason || (verdict.autoExec ? t('aiChat.message.verdictReasonReadOnly') : t('aiChat.message.verdictReasonRunManually'))}
        </div>
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
    onRun?: (cmd: string) => void;
    onDecline?: (cmd: string) => void;
    onHoverTarget?: (hovered: boolean) => void;
    targetTitle?: string;
    targetId?: string;
    targetLive?: boolean;
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
}> = ({ content, onRun, onDecline, onHoverTarget, targetTitle, targetId, targetLive = true, autoExecutedCommands, declinedCommands, scheduledCommands, onCancelScheduled, verdictByCommand, classifyingCommands, limitReached, sleepDelay }) => {
    const { t } = useTranslation();
    const parts = segmentMessageContent(content);
    const targetLabel = targetId
        ? (targetLive
            ? <span className="ai-run-target">{t('aiChat.message.target', { title: targetTitle || t('aiChat.message.unnamedTerminal') })}</span>
            : <span className="ai-run-target ai-run-target-stale">{t('aiChat.message.targetStale', { title: targetTitle || t('aiChat.message.unnamedTerminal') })}</span>)
        : <span className="ai-run-target no-target">{t('aiChat.message.noTarget')}</span>;

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
                                {targetLabel}
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
                    return (
                        <div key={part.key} className={`ai-execute-block${wasAutoExecuted ? ' ai-execute-auto' : ''}${wasDeclined ? ' ai-execute-declined' : ''}${isScheduled ? ' ai-execute-scheduled' : ''}`}>
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
                                            onClick={() => onRun?.(command)}
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
                                {targetLabel}
                            </div>
                            {!wasDeclined && (
                                isScheduled ? (
                                    <AutoRunCountdown runAt={scheduledAt} />
                                ) : sleepDelay && sleepDelay.command === command ? (
                                    <SleepCountdown delay={sleepDelay} />
                                ) : (
                                    <VerdictNote
                                        classifying={classifyingCommands?.has(command)}
                                        verdict={verdictByCommand?.get(command)}
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
                    <div
                        key={part.key}
                        className="ai-chat-markdown-inline"
                        onClick={(e) => {
                            // AI-authored links are untrusted; never let them
                            // navigate this privileged window in place. Route
                            // external links through the vetted opener instead.
                            const url = externalLinkFromClick(e.target);
                            if (url) {
                                e.preventDefault();
                                void tauriService.openExternal(url).catch(() => {});
                            }
                        }}
                        dangerouslySetInnerHTML={{ __html: sanitizeHtml(marked.parse(part.text, { async: false }) as string) }}
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
    ensureConsent,
    onAddTab,
    onCloseTab,
    onSelectTab,
    onFlashSessionPane,
    sessions,
    onRunCommand,
    onSendMessage,
    aiPersonas,
    terminalBackground,
    linkableSessions,
    onLinkSession,
    onRefreshSessions,
    onOpenSettings,
}) => {
    const { t } = useTranslation();
    // Derive active tab from chatState (Phase 1: tabs[] + activeTabId, single linkedSessionId per tab)
    const activeTab = chatState ? getActiveTab(chatState) : undefined;
    const activeTabId = activeTab?.id;
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
    const classifierStrategy = useSettingsStore(s => s.classifierStrategy);
    const aiClassifyConfidenceThreshold = useSettingsStore(s => s.aiClassifyConfidenceThreshold);
    const aiDataConsentAccepted = useSettingsStore(s => s.aiDataConsentAccepted);

    // Auto-execute state. The de-dup guard and the executed-command badge set are
    // tracked PER TAB: their keys (blockKey = messageIndex:command, and command text)
    // are only unique within a single conversation. Clearing a tab's messages on
    // "New chat" resets the message indices to 0,1,2…, so a pane-global set would
    // mistake the new chat's first command for one already processed and suppress it.
    const [consecutiveAutoExecCount, setConsecutiveAutoExecCount] = useState(0);
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
        setMessagesByTab,
        streamingByTab, streamingTabIds, streamingForTabIdRef,
        messages, streamingContent, isStreaming,
        setStreamingForTab, markStreaming, setStreamingContent, setIsStreaming, setMessages,
        armStreamWatchdog, clearStreamWatchdog,
        totalInputTokens, totalOutputTokens, totalCost, resetTokens,
        resetAllStreams, pruneStreams, clearTabStream,
    } = useChatStream({
        paneId,
        activeTabId,
        selectedModelRef,
        onStreamComplete: (tabId, msgs) => streamCompleteHandlerRef.current(tabId, msgs),
    });
    const [selectedLanguage, setSelectedLanguage] = useState(() => {
        const saved = localStorage.getItem(STORAGE_KEYS.GEMINI_LANGUAGE);
        // Migrate the legacy '日本語' value (which never matched the 'Japanese'
        // <option>, leaving the select with no selected option) to the canonical
        // option value.
        if (saved) return saved === '日本語' ? 'Japanese' : saved;
        // First run: derive from the OS locale so a Japanese-locale user
        // doesn't have to switch from English manually every time they
        // install on a new machine. Must be a real <option> value ('Japanese',
        // not '日本語') or the select renders with nothing selected.
        return navigator.language?.toLowerCase().startsWith('ja') ? 'Japanese' : 'English';
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

    // Group selectable sessions for the link picker: this window's own, then one
    // group per other window.
    const linkGroups = useMemo(() => groupLinkableSessions(linkableSessions), [linkableSessions]);

    // Target session info derived from the active tab. Prefer the local session
    // record; fall back to the cross-window linkable list for remote links.
    const lastTargetSessionId = activeTab?.linkedSessionId;
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
    const linkedStale = !!lastTargetSessionId && !linkedLive;

    // Mirrors of values the async auto-exec effect must re-check AFTER its await
    // (state captured at effect-run time may be stale by the time classification
    // resolves). Updated every render.
    const linkedLiveRef = useRef(linkedLive);
    linkedLiveRef.current = linkedLive;
    // Mirror of the current chatState so refs/effects can read tabs without taking
    // chatState as a dependency.
    const chatStateRef = useRef(chatState);
    chatStateRef.current = chatState;
    // Refs the async auto-exec continuation reads to resolve/re-check a SPECIFIC
    // tab's linked session (auto-exec can complete on a background tab whose link
    // differs from the active tab's). Updated every render.
    const sessionsRef = useRef(sessions);
    sessionsRef.current = sessions;
    const linkableByIdRef = useRef(linkableById);
    linkableByIdRef.current = linkableById;
    const activeTabIdRef = useRef(activeTabId);
    activeTabIdRef.current = activeTabId;
    /** Resolve a tab's linked session id + live-ness (this window or another). */
    const resolveTabTarget = useCallback((tabId: string) => {
        const tab = chatStateRef.current?.tabs.find((t) => t.id === tabId);
        const sid = tab?.linkedSessionId;
        if (!sid) return { sid: undefined as string | undefined, live: false, status: undefined as string | undefined };
        const status = sessionsRef.current?.get(sid)?.status ?? linkableByIdRef.current.get(sid)?.status;
        return { sid, live: status === 'connected', status };
    }, []);
    const autoExecPausedRef = useRef(autoExecPaused);
    autoExecPausedRef.current = autoExecPaused;
    const consecutiveAutoExecCountRef = useRef(consecutiveAutoExecCount);
    consecutiveAutoExecCountRef.current = consecutiveAutoExecCount;
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

    const [showNewChatConfirm, setShowNewChatConfirm] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const settingsPopoverRef = useRef<HTMLDivElement>(null);
    const settingsTriggerRef = useRef<HTMLButtonElement>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const lastSentTextRef = useRef('');
    // True only when the last dispatched message was typed by a human (handleSend).
    // Auto-execute feedback (terminal-output envelopes, kickoff/decline notes sent
    // via pendingMessage) sets it false so a Stop/pause cancel never restores that
    // machine text into the human prompt textarea.
    const lastSentWasHumanRef = useRef(false);
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
    useEffect(() => {
        const selectedPersona = aiPersonas?.find(p => p.label === selectedExpertise);
        const basePrompt = selectedPersona?.systemPrompt || aiPersonas?.[0]?.systemPrompt || 'You are a helpful assistant.';
        const extraInstructions = buildExecutionRules();
        const langInstruction = languageDirective(selectedLanguage);
        const newInstruction = `${basePrompt}${extraInstructions}${langInstruction}`;
        setLocalSystemInstruction(newInstruction);
        onChatStateChange?.({ systemInstruction: newInstruction });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedExpertise, selectedLanguage, aiPersonas]);

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

    // ── Auto-send pending messages for ANY tab (one stream at a time per pane) ──
    // Scans every tab for a queued pending message; dispatches the first tab's
    // head-of-queue that isn't currently streaming. Results that arrive on a
    // non-active tab still trigger the next request, so the loop keeps running
    // across tab switches. Double-dispatch is prevented structurally: dispatching
    // dequeues the message AND marks the tab streaming (both batched), so the next
    // effect run bails on the streaming guard — no de-dup-by-text needed.
    useEffect(() => {
        if (!isAuthenticated || !chatState) return;
        // Only one in-flight stream per pane (single streamingForTabIdRef).
        if (streamingTabIds.size > 0) return;

        for (const tab of chatState.tabs) {
            const queue = tab.pendingMessages;
            if (!queue || queue.length === 0) continue;
            const pm = queue[0];

            // A freshly-created pane (e.g. opened via Ask AI) hasn't resolved its
            // model yet — the model list loads and auto-selects asynchronously.
            // Leave the queue intact until the model settles; this effect re-runs
            // when selectedModel / availableModels / modelLoadError change.
            if (selectedModel === 'Unspecified' && availableModels.length === 0 && !modelLoadError) {
                return;
            }

            // Data-sharing consent gate: machine-generated pending messages
            // (kickoff, terminal-output envelopes, decline/not-connected notes)
            // egress terminal data to the provider just like a manual send, so
            // they must clear the same consent. Park the queue (don't dequeue)
            // and prompt once; the effect re-runs when consent flips accepted.
            if (!aiDataConsentAccepted) {
                if (!consentPromptShownRef.current) {
                    consentPromptShownRef.current = true;
                    void ensureConsent?.().finally(() => { consentPromptShownRef.current = false; });
                }
                return;
            }

            const sysInstr = chatState.systemInstruction || localSystemInstruction;
            onChatStateChange?.({ systemInstruction: sysInstr });
            // Remove the head of the queue now that we're dispatching it.
            onDequeuePending?.(tab.id);

            if (selectedModel === 'Unspecified') {
                setMessagesByTab((prev) => {
                    const next = new Map(prev);
                    const cur = prev.get(tab.id) ?? [];
                    next.set(tab.id, [
                        ...cur,
                        { role: 'user', content: pm },
                        { role: 'model', content: t('aiChat.pane.modelNotSelected') },
                    ]);
                    return next;
                });
                continue;
            }

            setMessagesByTab((prev) => {
                const next = new Map(prev);
                const cur = prev.get(tab.id) ?? [];
                next.set(tab.id, [...cur, { role: 'user', content: pm }]);
                return next;
            });
            lastSentTextRef.current = pm;
            lastSentWasHumanRef.current = false;
            streamingForTabIdRef.current = tab.id;
            markStreaming(tab.id, true);
            setStreamingForTab(tab.id, '');
            armStreamWatchdog();
            tauriService.aiChatSend(aiBackendSessionId(paneId, tab.id), pm, selectedModel, sysInstr).catch((err) => {
                logError('AI', 'aiChatSend invoke failed', err);
                clearStreamWatchdog();
                markStreaming(tab.id, false);
                streamingForTabIdRef.current = null;
            });
            break;
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chatState, isAuthenticated, streamingTabIds, paneId, selectedModel, availableModels, modelLoadError, aiDataConsentAccepted]);

    // ── Auto-kickoff: Network Expert start-of-session protocol ──
    // When a Network Expert chat has a LIVE linked terminal, inject the kickoff as
    // the active tab's pending message so the mandatory protocol (device ID → paging
    // disable) runs WITHOUT the user typing a first message. Requires auth + a model
    // so the auto-send loop can actually dispatch it.
    //
    // kickedForDeviceRef tracks, per tab, the DEVICE the current conversation was
    // kicked for — keyed on the config-derived binding key (host/port/user, serial
    // port, …), NOT the session id. A reconnect mints a new session id for the SAME
    // device, so keying on the binding key is what tells a true device switch apart
    // from a reconnect. lastSessionForDeviceRef remembers the session id we last
    // acted on so a same-device reconnect (id changed, key unchanged) is detectable.
    // Behavior:
    //   - First live link, empty conversation → full kickoff in place.
    //   - Link changes to a DIFFERENT device → clear the old conversation AND its
    //     backend history (auto "New chat") first, then full kickoff, so the old
    //     device's output can't pollute the new device's context.
    //   - Reconnect to the SAME device (new session id, same binding key) DURING an
    //     ongoing conversation → keep the chat, inject only a lightweight paging
    //     re-disable (the model still knows the vendor from context). An empty
    //     conversation needs nothing — the persona protocol re-preps on the user's
    //     next message.
    //   - Same link re-render / tab re-show → no-op.
    //   - A conversation the user typed into on a device we never managed is left
    //     untouched (we never hijack a manual chat).
    const kickedForDeviceRef = useRef<Map<string, string>>(new Map());
    const lastSessionForDeviceRef = useRef<Map<string, string>>(new Map());
    // Now that every per-tab tracking ref exists, wire the forward handle used by
    // the provider-switch and logout effects (declared above these refs).
    resetAllTabTrackingRef.current = () => {
        clearAllCountdownTimers();
        applyAutoExec({ type: 'resetAll' });
        kickedForDeviceRef.current.clear();
        lastSessionForDeviceRef.current.clear();
    };
    const performNewChatRef = useRef<() => void>(() => {});
    useEffect(() => {
        if (!isNetworkExpert) return;
        if (!isAuthenticated || selectedModel === 'Unspecified') return;
        if (!activeTabId || isStreaming) return;
        if (activeTab?.pendingMessages?.length) return;
        if (!lastTargetSessionId || !linkedLive) return;   // need a live linked target right now

        // Stable device identity (survives reconnect); fall back to the session id
        // only if a binding key was never recorded for this link.
        const device = activeTab?.linkBindingKey ?? lastTargetSessionId;
        const kickedFor = kickedForDeviceRef.current.get(activeTabId);

        if (kickedFor === device) {
            // Same device we already kicked. Only react to a SESSION id change, i.e.
            // a reconnect (new SSH session ⇒ paging reset).
            if (lastSessionForDeviceRef.current.get(activeTabId) === lastTargetSessionId) return;
            lastSessionForDeviceRef.current.set(activeTabId, lastTargetSessionId);
            if (messages.length === 0) return;             // nothing to preserve; persona re-preps on next msg
            setConsecutiveAutoExecCount(0);
            onEnqueuePending?.(activeTabId, NETWORK_EXPERT_RECONNECT_PREP);
            return;
        }

        // Different device (or first link).
        const isSwitch = kickedFor !== undefined;          // managed a different device before
        if (messages.length > 0 && !isSwitch) return;      // don't hijack a manual same-device chat
        if (messages.length > 0) performNewChatRef.current(); // genuine device switch → fresh context first

        kickedForDeviceRef.current.set(activeTabId, device);
        lastSessionForDeviceRef.current.set(activeTabId, lastTargetSessionId);
        setConsecutiveAutoExecCount(0);
        onEnqueuePending?.(activeTabId, NETWORK_EXPERT_KICKOFF);
    }, [
        isNetworkExpert, isAuthenticated, selectedModel, activeTabId, lastTargetSessionId,
        linkedLive, messages.length, isStreaming, activeTab?.pendingMessages?.length,
        activeTab?.linkBindingKey, onEnqueuePending,
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
        // Reset per-tab auto-exec/kickoff tracking too, mirroring performNewChat —
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
        pruneMap(lastSessionForDeviceRef.current as Map<string, unknown>);
        pruneStreams(liveIds);
    }, [tabIdsKey, applyAutoExec, pruneStreams]);

    // ── Auto-execute safe commands ──
    // Assigned later; the effect calls it via ref (forward reference). Runs a
    // command on a SPECIFIC tab's linked session (auto-exec can complete on a
    // background tab), not the active tab.
    const handleRunCommandForTabRef = useRef<(tabId: string, cmd: string) => void>(() => {});
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
        const commands = extractExecuteCommands(lastMsg.content);
        if (commands.length === 0) return;

        const command = commands[commands.length - 1];
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
            if (!resolveTabTarget(tabId).live) return; // this tab's link, not active
            if (maxConsecutiveAutoExecutionsRef.current > 0
                && consecutiveAutoExecCountRef.current >= maxConsecutiveAutoExecutionsRef.current) return;

            // Grace period: rather than run immediately, arm a cancellable
            // countdown so the user can stop a safe auto-run before it fires.
            // 0s (or an unset/invalid value) preserves the old immediate behaviour.
            const rawCountdown = aiAutoExecCountdownSecsRef.current;
            const countdownSecs = Number.isFinite(rawCountdown) ? Math.max(0, Math.min(10, rawCountdown)) : 0;
            if (countdownSecs <= 0) {
                applyAutoExec({ type: 'execute', tabId, blockKey });
                setConsecutiveAutoExecCount(prev => prev + 1);
                handleRunCommandForTabRef.current(tabId, command);
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
                if (autoExecPausedRef.current || !resolveTabTarget(tabId).live
                    || (maxConsecutiveAutoExecutionsRef.current > 0
                        && consecutiveAutoExecCountRef.current >= maxConsecutiveAutoExecutionsRef.current)) {
                    applyAutoExec({ type: 'cancelSchedule', tabId, blockKey });
                    return;
                }
                applyAutoExec({ type: 'execute', tabId, blockKey });
                setConsecutiveAutoExecCount(prev => prev + 1);
                handleRunCommandForTabRef.current(tabId, command);
            }, countdownSecs * 1000);
            countdownTimersRef.current.set(key, timer);
        })();
    };
    streamCompleteHandlerRef.current = handleStreamComplete;

    useEffect(() => {
        if (commandExecutionMode === 'ask-before-execute') {
            setAutoExecPaused(false);
            setConsecutiveAutoExecCount(0);
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
    const handleRunCommandForTab = (tabId: string, command: string) => {
        const { sid, live, status } = resolveTabTarget(tabId);
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
    const handleRunCommand = (command: string) => {
        if (!activeTabId) return;
        handleRunCommandForTab(activeTabId, command);
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
        setConsecutiveAutoExecCount(0); // a human intervened — reset the auto-run streak
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
        setConsecutiveAutoExecCount(0); // a human intervened — reset the auto-run streak
    };

    const handleHoverTarget = (isHovering: boolean) => {
        if (!lastTargetSessionId) return;
        window.dispatchEvent(new CustomEvent('hotty-highlight-session', {
            detail: { sessionId: lastTargetSessionId, highlighted: isHovering },
        }));
    };

    const handleSend = () => {
        const text = inputText.trim();
        // Block while ANY tab in this pane is streaming (only one in-flight stream
        // per pane — a single streamingForTabIdRef). Guarding on the active tab's
        // isStreaming alone let a send from a second tab hijack the first's stream.
        if (!text || streamingTabIds.size > 0 || selectedModel === 'Unspecified') return;

        const dispatch = () => {
            setConsecutiveAutoExecCount(0);
            setMessages(prev => [...prev, { role: 'user', content: text }]);
            lastSentTextRef.current = text;
            lastSentWasHumanRef.current = true;
            setInputText('');
            // Capture which tab owns this stream so chunks land in the right tab even after a tab switch.
            streamingForTabIdRef.current = activeTabId ?? null;
            setIsStreaming(true);
            setStreamingContent('');
            armStreamWatchdog();

            if (onSendMessage) {
                onSendMessage(text);
            } else {
                tauriService.aiChatSend(aiBackendSessionId(paneId, activeTabId), text, selectedModel, localSystemInstruction).catch((err) => {
                    logError('AI', 'aiChatSend invoke failed', err);
                    clearStreamWatchdog();
                    setIsStreaming(false);
                    streamingForTabIdRef.current = null;
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

    const performNewChat = () => {
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
            setConsecutiveAutoExecCount(0);
            // Cancel any in-flight client-side sleep delay for this tab: clearing
            // sleepDelay invalidates the token its timer checks, so it no-ops.
            onUpdateTabById?.(activeTabId, { sleepDelay: null });
        }
        resetTokens();
        tauriService.aiChatClear(aiBackendSessionId(paneId, activeTabId)).catch(() => {});
    };
    // Stable handle so the Network Expert auto-kickoff effect can start a fresh chat
    // on a device switch without taking performNewChat as a (churning) dependency.
    performNewChatRef.current = performNewChat;

    const handleNewChatClick = () => {
        if (messages.length > 0 || streamingContent) {
            setShowNewChatConfirm(true);
        } else {
            performNewChat();
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
        clearStreamWatchdog();
        // Cancel on the tab that owns the in-flight stream (per-tab backend session),
        // and append its partial content + [cancelled] to that same tab.
        const targetTabId = streamingForTabIdRef.current ?? activeTabId ?? null;
        tauriService.aiChatCancel(aiBackendSessionId(paneId, targetTabId)).catch(() => {});
        if (targetTabId) {
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
        }
        streamingForTabIdRef.current = null;
        // Only restore a HUMAN-typed message for editing/resend. Auto-execute
        // feedback (terminal-output envelopes, kickoff/decline notes) must never
        // land in the human prompt textarea, and any text the user was typing
        // during the stream is left untouched.
        if (lastSentWasHumanRef.current) {
            setInputText(lastSentTextRef.current);
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
                        const linkedId = chatState.tabs.find((t) => t.id === id)?.linkedSessionId;
                        if (linkedId) onFlashSessionPane?.(linkedId);
                    }}
                    onClose={(id) => onCloseTab?.(id)}
                    onAdd={() => onAddTab?.()}
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
                    {isAuthenticated && (
                        <button
                            type="button"
                            className="ai-chat-new-chat-btn"
                            onClick={handleNewChatClick}
                            title={t('aiChat.pane.newChatTitle')}
                            aria-label={t('aiChat.pane.newChatTitle')}
                        >
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <line x1="12" y1="5" x2="12" y2="19" />
                                <line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                            <span>{t('aiChat.pane.newChat')}</span>
                        </button>
                    )}
                    {isAuthenticated && lastTargetSessionId && (
                        <button
                            type="button"
                            className={`ai-chat-linked-chip${linkedStale ? ' ai-chat-linked-chip-stale' : ''}`}
                            onClick={() => {
                                tauriService.focusWindow().catch(() => {});
                                window.dispatchEvent(new CustomEvent('hotty-focus-session', { detail: { sessionId: lastTargetSessionId } }));
                            }}
                            onMouseEnter={() => {
                                window.dispatchEvent(new CustomEvent('hotty-highlight-session', { detail: { sessionId: lastTargetSessionId, highlighted: true } }));
                            }}
                            onMouseLeave={() => {
                                window.dispatchEvent(new CustomEvent('hotty-highlight-session', { detail: { sessionId: lastTargetSessionId, highlighted: false } }));
                            }}
                            title={linkedStale
                                ? t('aiChat.pane.linkedChipTitleStale', { name: lastTargetSessionTitle || t('aiChat.pane.terminalFallback'), status: lastTargetStatus ?? t('aiChat.pane.statusDisconnected') })
                                : t('aiChat.pane.linkedChipTitle', { name: lastTargetSessionTitle || t('aiChat.pane.terminalFallback') })}
                            aria-label={linkedStale
                                ? t('aiChat.pane.linkedChipAriaStale', { name: lastTargetSessionTitle || t('aiChat.pane.unknownTerminal'), status: lastTargetStatus ?? t('aiChat.pane.statusDisconnected') })
                                : t('aiChat.pane.linkedChipAria', { name: lastTargetSessionTitle || t('aiChat.pane.unknownTerminal') })}
                        >
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                            </svg>
                            <span className="ai-chat-linked-chip-name">
                                {lastTargetSessionTitle || t('aiChat.pane.terminalFallback')}{linkedStale ? t('aiChat.pane.disconnectedSuffix') : ''}
                            </span>
                        </button>
                    )}
                    {isAuthenticated && (linkableSessions?.length ?? 0) > 0 && (
                        <select
                            className="ai-chat-link-select"
                            value={lastTargetSessionId ?? ''}
                            title={t('aiChat.pane.linkPickerTitle')}
                            aria-label={t('aiChat.pane.linkPickerTitle')}
                            onMouseDown={() => onRefreshSessions?.()}
                            onFocus={() => onRefreshSessions?.()}
                            onChange={(e) => onLinkSession?.(e.target.value || undefined)}
                        >
                            <option value="">{t('aiChat.pane.linkNone')}</option>
                            {/* Keep the current (possibly now-gone) link selectable so the
                                control stays consistent and React doesn't warn. */}
                            {lastTargetSessionId && !linkableById.has(lastTargetSessionId) && (
                                <option value={lastTargetSessionId}>
                                    {lastTargetSessionTitle || lastTargetSessionId}
                                </option>
                            )}
                            {linkGroups.local.length > 0 && (
                                <optgroup label={t('aiChat.pane.linkThisWindow')}>
                                    {linkGroups.local.map((s) => (
                                        <option key={s.sessionId} value={s.sessionId}>{s.displayName}</option>
                                    ))}
                                </optgroup>
                            )}
                            {linkGroups.remote.map(([label, list]) => (
                                <optgroup key={label} label={t('aiChat.pane.linkOtherWindow', { label })}>
                                    {list.map((s) => (
                                        <option key={s.sessionId} value={s.sessionId}>{s.displayName}</option>
                                    ))}
                                </optgroup>
                            ))}
                        </select>
                    )}
                </div>
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
                                {lastTargetSessionId ? (
                                    <div className="ai-chat-empty-target">
                                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                                        </svg>
                                        <span>
                                            <Trans
                                                i18nKey="aiChat.pane.emptyLinkedTo"
                                                values={{ name: lastTargetSessionTitle || t('aiChat.pane.terminalFallback') }}
                                                components={[<strong key="name" />]}
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
                                            onRun={(cmd) => { setConsecutiveAutoExecCount(0); handleRunCommand(cmd); }}
                                            onDecline={(cmd) => handleDeclineCommand(idx, cmd)}
                                            onHoverTarget={handleHoverTarget}
                                            targetTitle={lastTargetSessionTitle}
                                            targetId={lastTargetSessionId}
                                            targetLive={linkedLive}
                                            autoExecutedCommands={autoExecutedCommands}
                                            declinedCommands={declinedCommands}
                                            scheduledCommands={scheduledCommands}
                                            onCancelScheduled={(cmd) => handleCancelScheduled(idx, cmd)}
                                            verdictByCommand={verdictByCommand}
                                            classifyingCommands={classifyingCommands}
                                            limitReached={commandExecutionMode === 'auto-execute-safe' && maxConsecutiveAutoExecutions > 0 && consecutiveAutoExecCount >= maxConsecutiveAutoExecutions}
                                            sleepDelay={activeTab?.sleepDelay}
                                        />
                                    ) : (() => {
                                        const parsed = parseTerminalOutputMessage(msg.content);
                                        return parsed
                                            ? <TerminalOutputBlock cmd={parsed.cmd} output={parsed.output} />
                                            : <pre>{msg.content}</pre>;
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

                    <div className="ai-chat-input-area">
                        <textarea
                            ref={textareaRef}
                            className="ai-chat-textarea"
                            rows={1}
                            style={{ height: textareaHeight > 0 ? `${textareaHeight}px` : 'auto' }}
                            value={inputText}
                            onChange={(e) => setInputText(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={selectedModel === 'Unspecified' ? t('aiChat.pane.inputPlaceholderSelectModel') : t('aiChat.pane.inputPlaceholder')}
                            disabled={isStreaming}
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
                                                value={selectedLanguage}
                                                onChange={(e) => {
                                                    const lang = e.target.value;
                                                    setSelectedLanguage(lang);
                                                    localStorage.setItem(STORAGE_KEYS.GEMINI_LANGUAGE, lang);
                                                }}
                                            >
                                                {[AUTO_LANGUAGE, 'English', 'Japanese', 'Chinese', 'Korean', 'Spanish', 'French', 'German', 'Russian'].map(lang => (
                                                    <option key={lang} value={lang}>{lang}</option>
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
                                disabled={!inputText.trim() || streamingTabIds.size > 0 || selectedModel === 'Unspecified'}
                                aria-label={t('aiChat.pane.sendTitle')}
                                title={
                                    selectedModel === 'Unspecified'
                                        ? t('aiChat.pane.sendTitleSelectModel')
                                        : !inputText.trim()
                                        ? t('aiChat.pane.sendTitleEmpty')
                                        : isStreaming
                                        ? t('aiChat.pane.sendTitleStreaming')
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
            {showNewChatConfirm && (
                <ConfirmModal
                    title={t('aiChat.pane.newChatConfirmTitle')}
                    message={t('aiChat.pane.newChatConfirmMessage')}
                    confirmLabel={t('aiChat.pane.newChatConfirmButton')}
                    onConfirm={() => {
                        setShowNewChatConfirm(false);
                        performNewChat();
                    }}
                    onCancel={() => setShowNewChatConfirm(false)}
                />
            )}
        </div>
    );
});
