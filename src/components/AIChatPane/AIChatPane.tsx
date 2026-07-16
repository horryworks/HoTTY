import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { marked } from 'marked';
import { getTransparentColor } from '../../utils/colorUtils';
import { sanitizeHtml, externalLinkFromClick } from '../../utils/htmlUtils';
import { decideAutoExec, type AutoExecDecision } from '../../utils/aiCommandClassifier';
import { STORAGE_KEYS } from '../../constants/storage';
import { aiProviderLabelKey } from '../../constants/aiProviders';
import { calcAICost, formatAICost } from '../../constants/aiPricing';
import { buildExecutionRules, languageDirective, AUTO_LANGUAGE, NETWORK_EXPERT_KICKOFF, NETWORK_EXPERT_RECONNECT_PREP } from '../../constants/aiPrompts';
import { ExecutionModeBar } from './ExecutionModeBar';
import { TerminalOutputBlock } from './TerminalOutputBlock';
import { parseTerminalOutputMessage, notConnectedNote, declinedNote } from './terminalOutputUtils';
import { segmentMessageContent, extractExecuteCommands } from './executeBlockUtils';
import { streamTimeoutMessage, STREAM_IDLE_TIMEOUT_MS, STREAM_HARD_CAP_MS } from './streamWatchdog';
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
import './AIChatPane.css';

interface ChatMessage {
    role: 'user' | 'model';
    content: string;
}

interface AIChatPaneProps {
    paneId: string;
    active: boolean;
    chatState?: AiChatState;
    onChatStateChange?: (newState: Partial<AiChatState>) => void;
    onUpdateTabById?: (tabId: string, partial: Partial<ChatTab>) => void;
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
}

// ── AI Icon Component ──
const AIIcon: React.FC<{ size?: number; className?: string }> = ({ size = 24, className = '' }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className={className}
        style={{ flexShrink: 0 }}
    >
        <path d="M12 2L14.8 9.2L22 12L14.8 14.8L12 22L9.2 14.8L2 12L9.2 9.2L12 2Z" fill="url(#ai-gradient)" />
        <defs>
            <linearGradient id="ai-gradient" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                <stop stopColor="var(--provider-gemini-1)" />
                <stop offset="0.5" stopColor="var(--provider-gemini-2)" />
                <stop offset="1" stopColor="var(--provider-gemini-3)" />
            </linearGradient>
        </defs>
    </svg>
);

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
    verdictByCommand?: Map<string, AutoExecDecision>;
    classifyingCommands?: Set<string>;
    limitReached?: boolean;
    sleepDelay?: ChatTab['sleepDelay'];
}> = ({ content, onRun, onDecline, onHoverTarget, targetTitle, targetId, targetLive = true, autoExecutedCommands, declinedCommands, verdictByCommand, classifyingCommands, limitReached, sleepDelay }) => {
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
                    return (
                        <div key={part.key} className={`ai-execute-block${wasAutoExecuted ? ' ai-execute-auto' : ''}${wasDeclined ? ' ai-execute-declined' : ''}`}>
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
                                sleepDelay && sleepDelay.command === command ? (
                                    <SleepCountdown delay={sleepDelay} />
                                ) : (
                                    <VerdictNote
                                        classifying={classifyingCommands?.has(command)}
                                        verdict={verdictByCommand?.get(command)}
                                    />
                                )
                            )}
                            {!wasAutoExecuted && !wasDeclined && limitReached && (
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
    const classifierStrategy = useSettingsStore(s => s.classifierStrategy);
    const aiClassifyConfidenceThreshold = useSettingsStore(s => s.aiClassifyConfidenceThreshold);

    // Auto-execute state. The de-dup guard and the executed-command badge set are
    // tracked PER TAB: their keys (blockKey = messageIndex:command, and command text)
    // are only unique within a single conversation. Clearing a tab's messages on
    // "New chat" resets the message indices to 0,1,2…, so a pane-global set would
    // mistake the new chat's first command for one already processed and suppress it.
    const [consecutiveAutoExecCount, setConsecutiveAutoExecCount] = useState(0);
    const autoExecutedByTabRef = useRef(new Map<string, Set<string>>());
    const autoExecProcessedByTabRef = useRef(new Map<string, Set<string>>());
    // Commands the user explicitly declined ("Don't Execute"), tracked per tab and
    // keyed by command text (mirrors autoExecutedByTabRef). Drives the "Declined"
    // badge and lets the auto-exec async bail if a command is declined mid-classify.
    const declinedByTabRef = useRef(new Map<string, Set<string>>());
    const getTabSet = useCallback((map: Map<string, Set<string>>, tabId: string) => {
        let set = map.get(tabId);
        if (!set) { set = new Set<string>(); map.set(tabId, set); }
        return set;
    }, []);
    const [autoExecPaused, setAutoExecPaused] = useState(false);
    const autoExecutedCommands = activeTabId ? autoExecutedByTabRef.current.get(activeTabId) : undefined;
    // Kept fresh across re-renders by the `bumpDecisions()` bump in handleDeclineCommand.
    const declinedCommands = activeTabId ? declinedByTabRef.current.get(activeTabId) : undefined;

    // Per-command safety verdicts (and in-flight "classifying" markers), tracked
    // per tab and keyed by `${messageIndex}:${command}` so the UI can show WHY
    // each command was (or wasn't) auto-executed. `decisionsVersion` bumps to
    // force a re-render when these refs mutate (refs alone don't trigger one).
    const decisionsByTabRef = useRef(new Map<string, Map<string, AutoExecDecision>>());
    const classifyingByTabRef = useRef(new Map<string, Set<string>>());
    const [decisionsVersion, setDecisionsVersion] = useState(0);
    const bumpDecisions = useCallback(() => setDecisionsVersion(v => v + 1), []);
    const getTabMap = useCallback((map: Map<string, Map<string, AutoExecDecision>>, tabId: string) => {
        let m = map.get(tabId);
        if (!m) { m = new Map<string, AutoExecDecision>(); map.set(tabId, m); }
        return m;
    }, []);

    // Per-tab chat state (Phase 1: messages stored locally keyed by tabId so tab switch
    // swaps history without losing in-flight conversations).
    const [messagesByTab, setMessagesByTab] = useState<Map<string, ChatMessage[]>>(() => new Map());
    const [streamingByTab, setStreamingByTab] = useState<Map<string, string>>(() => new Map());
    const [streamingTabIds, setStreamingTabIds] = useState<Set<string>>(() => new Set());
    // Render-phase mirror so the watchdog timeout callback can read the latest partial
    // content WITHOUT closing over `streamingByTab` state. Keeping streamingByTab out of
    // armStreamWatchdog's deps is what lets the response listener subscribe once for the
    // pane's lifetime instead of tearing down and re-arming on every chunk.
    const streamingByTabRef = useRef(streamingByTab);
    streamingByTabRef.current = streamingByTab;
    const messages = useMemo<ChatMessage[]>(
        () => (activeTabId ? (messagesByTab.get(activeTabId) ?? []) : []),
        [activeTabId, messagesByTab],
    );
    const setMessages = useCallback((updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
        if (!activeTabId) return;
        setMessagesByTab((prev) => {
            const next = new Map(prev);
            const cur = prev.get(activeTabId) ?? [];
            next.set(activeTabId, typeof updater === 'function' ? (updater as (p: ChatMessage[]) => ChatMessage[])(cur) : updater);
            return next;
        });
    }, [activeTabId]);
    const [inputText, setInputText] = useState('');
    const [selectedModel, setSelectedModel] = useState(chatState?.selectedModel || 'Unspecified');
    const selectedModelRef = useRef(selectedModel);
    selectedModelRef.current = selectedModel;
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
    const autoExecPausedRef = useRef(autoExecPaused);
    autoExecPausedRef.current = autoExecPaused;
    const consecutiveAutoExecCountRef = useRef(consecutiveAutoExecCount);
    consecutiveAutoExecCountRef.current = consecutiveAutoExecCount;

    // De-dup guard: tabId → last pendingMessage text we already started processing.
    // Prevents re-firing the same auto-send while the parent state is mid-update.
    const recentlyProcessedRef = useRef<Map<string, string>>(new Map());

    // Per-tab streaming state. Streamed chunks are routed to whichever tab was active
    // when the request was sent (captured in streamingForTabIdRef), so a tab switch
    // mid-stream does not drop chunks into the wrong tab.
    const streamingForTabIdRef = useRef<string | null>(null);
    const streamingContent = activeTabId ? (streamingByTab.get(activeTabId) ?? '') : '';
    const isStreaming = activeTabId ? streamingTabIds.has(activeTabId) : false;
    const setStreamingForTab = useCallback((tabId: string, value: string | ((prev: string) => string)) => {
        setStreamingByTab((prev) => {
            const next = new Map(prev);
            const cur = prev.get(tabId) ?? '';
            const v = typeof value === 'function' ? (value as (p: string) => string)(cur) : value;
            if (v === '') next.delete(tabId); else next.set(tabId, v);
            return next;
        });
    }, []);
    const markStreaming = useCallback((tabId: string, on: boolean) => {
        setStreamingTabIds((prev) => {
            if (on) {
                if (prev.has(tabId)) return prev;
                const next = new Set(prev); next.add(tabId); return next;
            }
            if (!prev.has(tabId)) return prev;
            const next = new Set(prev); next.delete(tabId); return next;
        });
    }, []);
    const setStreamingContent = useCallback((updater: string | ((prev: string) => string)) => {
        if (!activeTabId) return;
        setStreamingForTab(activeTabId, updater);
    }, [activeTabId, setStreamingForTab]);
    const setIsStreaming = useCallback((b: boolean | ((prev: boolean) => boolean)) => {
        if (!activeTabId) return;
        const v = typeof b === 'function' ? b(isStreaming) : b;
        markStreaming(activeTabId, v);
    }, [activeTabId, isStreaming, markStreaming]);
    const [totalInputTokens, setTotalInputTokens] = useState(0);
    const [totalOutputTokens, setTotalOutputTokens] = useState(0);
    const [totalCost, setTotalCost] = useState<number | null>(null);
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
    // Mirror of the current chatState so the provider-switch effect can clear
    // every tab's per-tab backend history without taking chatState as a dep.
    const chatStateRef = useRef(chatState);
    chatStateRef.current = chatState;

    useEffect(() => {
        if (prevProviderRef.current !== activeAiProvider) {
            prevProviderRef.current = activeAiProvider;
            // Provider switch invalidates all in-progress conversations.
            setMessagesByTab(new Map());
            setStreamingByTab(new Map());
            setStreamingTabIds(new Set());
            streamingForTabIdRef.current = null;
            setTotalInputTokens(0);
            setTotalOutputTokens(0);
            setTotalCost(null);
            setSelectedModel('Unspecified');
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

    // Prune `recentlyProcessedRef` entries for tabs that have been closed so
    // the de-dup map doesn't grow unbounded over a long-running session.
    useEffect(() => {
        if (!chatState) return;
        const liveIds = new Set(chatState.tabs.map((t) => t.id));
        for (const id of recentlyProcessedRef.current.keys()) {
            if (!liveIds.has(id)) {
                recentlyProcessedRef.current.delete(id);
            }
        }
    }, [chatState]);

    // ── Auto-send pending message for ANY tab (one stream at a time per pane) ──
    // Scans every tab for a pending message; processes the first one that isn't
    // currently streaming. Results that arrive on a non-active tab still trigger
    // the next AI request, so the loop keeps running across tab switches.
    useEffect(() => {
        if (!isAuthenticated || !chatState) return;
        // Backend uses paneId as the stream session id, so only one in-flight stream
        // per pane is safe regardless of tab.
        if (streamingTabIds.size > 0) return;

        for (const tab of chatState.tabs) {
            const pm = tab.pendingMessage;
            if (!pm) continue;
            if (recentlyProcessedRef.current.get(tab.id) === pm) continue;

            // A freshly-created pane (e.g. opened via Ask AI) hasn't resolved its
            // model yet — the model list loads and auto-selects asynchronously.
            // Rather than rejecting the message with "model not selected", wait:
            // leave the pending message intact until the model settles. This
            // effect re-runs when selectedModel / availableModels / modelLoadError
            // change, at which point the message is sent below (or, once loading
            // has finished with no usable model, the not-selected notice shows).
            if (selectedModel === 'Unspecified' && availableModels.length === 0 && !modelLoadError) {
                return;
            }

            recentlyProcessedRef.current.set(tab.id, pm);

            const sysInstr = chatState.systemInstruction || localSystemInstruction;

            // Clear the pending message on this tab and persist the system instruction.
            onUpdateTabById?.(tab.id, { pendingMessage: undefined });
            onChatStateChange?.({ systemInstruction: sysInstr });

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
    }, [chatState, isAuthenticated, streamingTabIds, paneId, selectedModel, availableModels, modelLoadError]);

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
    const performNewChatRef = useRef<() => void>(() => {});
    useEffect(() => {
        if (!isNetworkExpert) return;
        if (!isAuthenticated || selectedModel === 'Unspecified') return;
        if (!activeTabId || isStreaming) return;
        if (activeTab?.pendingMessage) return;
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
            onUpdateTabById?.(activeTabId, { pendingMessage: NETWORK_EXPERT_RECONNECT_PREP });
            return;
        }

        // Different device (or first link).
        const isSwitch = kickedFor !== undefined;          // managed a different device before
        if (messages.length > 0 && !isSwitch) return;      // don't hijack a manual same-device chat
        if (messages.length > 0) performNewChatRef.current(); // genuine device switch → fresh context first

        kickedForDeviceRef.current.set(activeTabId, device);
        lastSessionForDeviceRef.current.set(activeTabId, lastTargetSessionId);
        setConsecutiveAutoExecCount(0);
        onUpdateTabById?.(activeTabId, { pendingMessage: NETWORK_EXPERT_KICKOFF });
    }, [
        isNetworkExpert, isAuthenticated, selectedModel, activeTabId, lastTargetSessionId,
        linkedLive, messages.length, isStreaming, activeTab?.pendingMessage,
        activeTab?.linkBindingKey, onUpdateTabById,
    ]);

    // Watchdog: guard an in-flight stream with two timers (see streamWatchdog.ts).
    //   - idle timer: re-armed on every chunk; fires after STREAM_IDLE_TIMEOUT_MS of
    //     silence (hung connection, unresponsive provider, dropped `done`).
    //   - hard cap: armed once per stream and NOT reset by chunks; fires after
    //     STREAM_HARD_CAP_MS so a runaway provider that streams endlessly (which keeps
    //     re-arming the idle timer forever) is still cancelled.
    // Both finalize via finalizeStuckStream, which reads the partial from a ref so this
    // logic never depends on streamingByTab state — keeping armStreamWatchdog stable so
    // the response listener subscribes once instead of resubscribing (and clearing the
    // just-armed timer) on every chunk.
    const streamIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const streamHardCapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const clearStreamWatchdog = useCallback(() => {
        if (streamIdleTimerRef.current) {
            clearTimeout(streamIdleTimerRef.current);
            streamIdleTimerRef.current = null;
        }
        if (streamHardCapTimerRef.current) {
            clearTimeout(streamHardCapTimerRef.current);
            streamHardCapTimerRef.current = null;
        }
    }, []);
    const finalizeStuckStream = useCallback((ms: number, kind: 'idle' | 'hardcap') => {
        const targetTabId = streamingForTabIdRef.current;
        if (!targetTabId) return;
        tauriService.aiChatCancel(aiBackendSessionId(paneId, targetTabId)).catch(() => {});
        const partial = streamingByTabRef.current.get(targetTabId) ?? '';
        const body = streamTimeoutMessage(partial, ms, kind);
        setMessagesByTab(prev => {
            const next = new Map(prev);
            const cur = prev.get(targetTabId) ?? [];
            next.set(targetTabId, [...cur, { role: 'model', content: body }]);
            return next;
        });
        setStreamingForTab(targetTabId, '');
        markStreaming(targetTabId, false);
        streamingForTabIdRef.current = null;
        clearStreamWatchdog();
    }, [paneId, setStreamingForTab, markStreaming, clearStreamWatchdog]);
    const armStreamWatchdog = useCallback(() => {
        // Idle timer resets on every call (stream start + each chunk).
        if (streamIdleTimerRef.current) clearTimeout(streamIdleTimerRef.current);
        streamIdleTimerRef.current = setTimeout(() => {
            streamIdleTimerRef.current = null;
            finalizeStuckStream(STREAM_IDLE_TIMEOUT_MS, 'idle');
        }, STREAM_IDLE_TIMEOUT_MS);
        // Hard cap armed once per stream; left running across chunks. A finalize/done/
        // error/cancel clears it, so it is null again before the next stream starts.
        if (!streamHardCapTimerRef.current) {
            streamHardCapTimerRef.current = setTimeout(() => {
                streamHardCapTimerRef.current = null;
                finalizeStuckStream(STREAM_HARD_CAP_MS, 'hardcap');
            }, STREAM_HARD_CAP_MS);
        }
    }, [finalizeStuckStream]);

    // ��─ Listen for chat response events ──
    useEffect(() => {
        let cancelled = false;
        let unlisten: (() => void) | undefined;

        tauriService.onAiChatResponse((data) => {
            if (cancelled) return;
            // Session ids are per-tab now (`paneId::tabId`); accept any that belong
            // to this pane. The bare paneId is still accepted for back-compat.
            if (data.sessionId !== paneId && !data.sessionId.startsWith(`${paneId}::`)) return;

            // Route chunks/done/error to the tab that initiated this request, not necessarily the currently active tab.
            const targetTabId = streamingForTabIdRef.current;
            if (!targetTabId) return;

            if (data.responseType === 'chunk') {
                setStreamingForTab(targetTabId, prev => prev + data.content);
                armStreamWatchdog();
            } else if (data.responseType === 'done') {
                clearStreamWatchdog();
                setMessagesByTab(prev => {
                    const next = new Map(prev);
                    const cur = prev.get(targetTabId) ?? [];
                    next.set(targetTabId, [...cur, { role: 'model', content: data.content }]);
                    return next;
                });
                setStreamingForTab(targetTabId, '');
                markStreaming(targetTabId, false);
                streamingForTabIdRef.current = null;
                if (data.usageMetadata) {
                    const inTokens = data.usageMetadata.promptTokenCount || 0;
                    const outTokens = data.usageMetadata.candidatesTokenCount || 0;
                    setTotalInputTokens(prev => prev + inTokens);
                    setTotalOutputTokens(prev => prev + outTokens);
                    const responseCost = calcAICost(inTokens, outTokens, selectedModelRef.current);
                    if (responseCost !== null) {
                        setTotalCost(prev => (prev ?? 0) + responseCost);
                    }
                }
            } else if (data.responseType === 'error') {
                clearStreamWatchdog();
                setMessagesByTab(prev => {
                    const next = new Map(prev);
                    const cur = prev.get(targetTabId) ?? [];
                    next.set(targetTabId, [...cur, { role: 'model', content: `Error: ${data.content}` }]);
                    return next;
                });
                setStreamingForTab(targetTabId, '');
                markStreaming(targetTabId, false);
                streamingForTabIdRef.current = null;
            }
        }).then(fn => {
            if (cancelled) { fn(); } else { unlisten = fn; }
        }).catch(e => logError('AI', 'Response listener setup failed', e));

        return () => { cancelled = true; unlisten?.(); clearStreamWatchdog(); };
    }, [paneId, setStreamingForTab, markStreaming, armStreamWatchdog, clearStreamWatchdog]);

    // ── Clear all conversations on explicit logout only ──
    // Keyed on logoutNonce (bumped solely by the ai-auth-logout broadcast), NOT
    // on the authenticated→false edge — a failed sign-in, provider switch, or a
    // cross-window auto-auth race also drop that flag but must NOT wipe history.
    const prevLogoutNonceRef = useRef(logoutNonce);
    useEffect(() => {
        if (prevLogoutNonceRef.current === logoutNonce) return;
        prevLogoutNonceRef.current = logoutNonce;
        clearStreamWatchdog();
        setMessagesByTab(new Map());
        setStreamingByTab(new Map());
        setStreamingTabIds(new Set());
        streamingForTabIdRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [logoutNonce]);

    // ── Auto-execute safe commands ──
    const handleRunCommandRef = useRef<(cmd: string) => void>(() => {});
    const prevIsStreamingRef = useRef(isStreaming);
    useEffect(() => {
        const wasStreaming = prevIsStreamingRef.current;
        prevIsStreamingRef.current = isStreaming;

        if (!(wasStreaming && !isStreaming && commandExecutionMode === 'auto-execute-safe')) return;
        if (!activeTabId) return;
        const lastMsg = messages[messages.length - 1];
        if (!lastMsg || lastMsg.role !== 'model') return;
        const commands = extractExecuteCommands(lastMsg.content);
        if (commands.length === 0) return;

        const command = commands[commands.length - 1];
        const blockKey = `${messages.length - 1}:${command}`;
        const processedSet = getTabSet(autoExecProcessedByTabRef.current, activeTabId);
        // Reserve the block BEFORE the await so a re-render during classification
        // can't fire a second, duplicate classification/run for the same command.
        if (processedSet.has(blockKey)) return;
        processedSet.add(blockKey);

        const tabId = activeTabId;
        let aborted = false;
        const classifyingSet = getTabSet(classifyingByTabRef.current, tabId);
        classifyingSet.add(blockKey);
        bumpDecisions();

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
            if (aborted) return;

            classifyingSet.delete(blockKey);
            getTabMap(decisionsByTabRef.current, tabId).set(blockKey, decision);
            bumpDecisions();

            if (!decision.autoExec) return;
            // Re-validate run preconditions against the LATEST state (they may have
            // changed while classification was in flight). The verdict is still
            // recorded above, so the UI shows the reason even when we don't run.
            // The user may have clicked "Don't Execute" during the classify window —
            // honor that and never auto-run a declined command.
            if (getTabSet(declinedByTabRef.current, tabId).has(command)) return;
            if (autoExecPausedRef.current) return;
            if (!linkedLiveRef.current) return;
            if (maxConsecutiveAutoExecutions > 0
                && consecutiveAutoExecCountRef.current >= maxConsecutiveAutoExecutions) return;

            getTabSet(autoExecutedByTabRef.current, tabId).add(command);
            setConsecutiveAutoExecCount(prev => prev + 1);
            handleRunCommandRef.current(command);
        })();

        return () => { aborted = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isStreaming, messages, commandExecutionMode, whitelistCommands, blacklistCommands, classifierStrategy, activeAiProvider, aiClassifyConfidenceThreshold, maxConsecutiveAutoExecutions, activeTabId]);

    useEffect(() => {
        if (commandExecutionMode === 'ask-before-execute') {
            setAutoExecPaused(false);
            setConsecutiveAutoExecCount(0);
        }
    }, [commandExecutionMode]);

    // ── Load models when authenticated ──
    useEffect(() => {
        if (isAuthenticated) {
            setIsLoadingModels(true);
            setModelLoadError(false);
            const load = async () => {
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
                            if (locations.length > 0) setAvailableRegions(locations);
                        }).catch(() => {});
                    }
                    const models = await tauriService.aiListModels();
                    if (models.length > 0) {
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
                    } else {
                        setModelLoadError(true);
                    }
                } catch {
                    setModelLoadError(true);
                } finally {
                    setIsLoadingModels(false);
                }
            };
            load();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated]);

    // ── Handlers ──
    const handleRegionChange = async (region: string) => {
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

    const handleRunCommand = (command: string) => {
        if (!lastTargetSessionId || !activeTabId) return;
        const cleanCmd = command.trim();
        // Fail loudly when the linked terminal isn't live. Without this, sending to
        // a dead/stale session is a silent no-op (the backend has no such session,
        // and the send error is swallowed) — the exact symptom after an SSH drop +
        // reconnect where the chat still looks linked. Post a result the model can
        // read so it stops and tells the user to re-link.
        if (!linkedLive) {
            onUpdateTabById?.(activeTabId, {
                pendingMessage: notConnectedNote(cleanCmd, lastTargetStatus),
            });
            return;
        }
        // Pass the originating tab id so the result is delivered back to the same tab,
        // even if the user switches tabs while the command is executing.
        onRunCommand?.(lastTargetSessionId, cleanCmd, activeTabId);
        tauriService.focusWindow().catch(() => {});
        window.dispatchEvent(new CustomEvent('hotty-focus-session', { detail: { sessionId: lastTargetSessionId } }));
    };
    handleRunCommandRef.current = handleRunCommand;

    // "Don't Execute": the user declines a suggested command. The app deterministically
    // records the decline (→ "Declined" badge + auto-exec race guard) and feeds the fact
    // back to the model via the existing pending-message pipe so it can acknowledge and
    // offer an alternative. Scope is this one command only — other commands' auto-exec is
    // unaffected. `command` is the raw block text (matches the render-time lookup set).
    const handleDeclineCommand = (command: string) => {
        if (!activeTabId) return;
        getTabSet(declinedByTabRef.current, activeTabId).add(command);
        setConsecutiveAutoExecCount(0); // a human intervened — reset the auto-run streak
        bumpDecisions();                // re-render so the block shows the Declined badge
        onUpdateTabById?.(activeTabId, { pendingMessage: declinedNote(command.trim()) });
    };

    const handleHoverTarget = (isHovering: boolean) => {
        if (!lastTargetSessionId) return;
        window.dispatchEvent(new CustomEvent('hotty-highlight-session', {
            detail: { sessionId: lastTargetSessionId, highlighted: isHovering },
        }));
    };

    const handleSend = () => {
        const text = inputText.trim();
        if (!text || isStreaming || selectedModel === 'Unspecified') return;
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

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const performNewChat = () => {
        // Clear only the active tab's messages and streaming state.
        if (activeTabId) {
            setMessagesByTab(prev => {
                const next = new Map(prev);
                next.delete(activeTabId);
                return next;
            });
            setStreamingByTab(prev => {
                const next = new Map(prev);
                next.delete(activeTabId);
                return next;
            });
            setStreamingTabIds(prev => {
                if (!prev.has(activeTabId)) return prev;
                const next = new Set(prev);
                next.delete(activeTabId);
                return next;
            });
            if (streamingForTabIdRef.current === activeTabId) streamingForTabIdRef.current = null;
            // Reset this tab's auto-exec tracking so the new conversation's first
            // command isn't suppressed by a stale blockKey (message indices restart
            // at 0) and the "Auto-executed" badge doesn't linger from the old chat.
            autoExecProcessedByTabRef.current.delete(activeTabId);
            autoExecutedByTabRef.current.delete(activeTabId);
            // Drop stale per-command verdicts so they don't reappear against the
            // new conversation's commands (which restart at message index 0).
            decisionsByTabRef.current.delete(activeTabId);
            classifyingByTabRef.current.delete(activeTabId);
            bumpDecisions();
            setConsecutiveAutoExecCount(0);
            // Cancel any in-flight client-side sleep delay for this tab: clearing
            // sleepDelay invalidates the token its timer checks, so it no-ops.
            onUpdateTabById?.(activeTabId, { sleepDelay: null });
        }
        setTotalInputTokens(0);
        setTotalOutputTokens(0);
        setTotalCost(null);
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
                    next.set(targetTabId, [...cur, { role: 'model', content: partial + ' [cancelled]' }]);
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
                        <AIIcon size={24} />
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
                        <AIIcon size={56} />
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
                    <div className="ai-chat-messages" ref={scrollContainerRef}>
                        {messages.length === 0 && !streamingContent && !isStreaming && (
                            <div className="ai-chat-empty-state">
                                <div className="ai-chat-empty-icon">
                                    <AIIcon size={56} />
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
                                    {[
                                        'aiChat.pane.suggestionOutputMeaning',
                                        'aiChat.pane.suggestionFindIssues',
                                        'aiChat.pane.suggestionExplainLast',
                                    ].map((promptKey) => {
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
                            // Build the per-command verdict/classifying lookups for this
                            // model message from the tab-scoped decision refs. Reading
                            // `decisionsVersion` here keeps the lookups fresh as the async
                            // classifier resolves. Only meaningful in auto-execute-safe mode.
                            void decisionsVersion;
                            let verdictByCommand: Map<string, AutoExecDecision> | undefined;
                            let classifyingCommands: Set<string> | undefined;
                            if (msg.role === 'model' && commandExecutionMode === 'auto-execute-safe' && activeTabId) {
                                const decMap = decisionsByTabRef.current.get(activeTabId);
                                const clsSet = classifyingByTabRef.current.get(activeTabId);
                                verdictByCommand = new Map<string, AutoExecDecision>();
                                classifyingCommands = new Set<string>();
                                for (const cmd of extractExecuteCommands(msg.content)) {
                                    const bk = `${idx}:${cmd}`;
                                    const d = decMap?.get(bk);
                                    if (d) verdictByCommand.set(cmd, d);
                                    if (clsSet?.has(bk)) classifyingCommands.add(cmd);
                                }
                            }
                            return (
                            <div key={idx} className={`ai-chat-message ai-chat-message-${msg.role}`}>
                                <div className="ai-chat-message-avatar">
                                    {msg.role === 'user' ? '\u{1F464}' : <AIIcon size={18} />}
                                </div>
                                <div className={`ai-chat-message-content ${msg.role === 'model' ? 'ai-chat-markdown' : ''}`}>
                                    {msg.role === 'model' ? (
                                        <MessageContent
                                            content={msg.content}
                                            onRun={(cmd) => { setConsecutiveAutoExecCount(0); handleRunCommand(cmd); }}
                                            onDecline={handleDeclineCommand}
                                            onHoverTarget={handleHoverTarget}
                                            targetTitle={lastTargetSessionTitle}
                                            targetId={lastTargetSessionId}
                                            targetLive={linkedLive}
                                            autoExecutedCommands={autoExecutedCommands}
                                            declinedCommands={declinedCommands}
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
                            </div>
                            );
                        })}
                        {streamingContent && (
                            <div className="ai-chat-message ai-chat-message-model">
                                <div className="ai-chat-message-avatar"><AIIcon size={18} /></div>
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
                                <div className="ai-chat-message-avatar"><AIIcon size={18} /></div>
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

                    <div className="ai-chat-resize-handle" onMouseDown={(e) => {
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
                                                disabled={isStreaming || isLoadingModels}
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
                                                    disabled={isStreaming}
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
                                                disabled={isStreaming}
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
                            />
                            {isStreaming && <button className="ai-chat-cancel-btn" onClick={handleCancel}>&#x25A0;</button>}
                            <button
                                className="ai-chat-send-btn"
                                onClick={handleSend}
                                disabled={!inputText.trim() || isStreaming || selectedModel === 'Unspecified'}
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
