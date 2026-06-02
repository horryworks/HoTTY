import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { marked } from 'marked';
import { getTransparentColor } from '../../utils/colorUtils';
import { sanitizeHtml } from '../../utils/htmlUtils';
import { classifyCommand } from '../../utils/commandClassifier';
import { STORAGE_KEYS } from '../../constants/storage';
import { calcAICost, formatAICost } from '../../constants/aiPricing';
import { buildExecutionRules, languageDirective, AUTO_LANGUAGE } from '../../constants/aiPrompts';
import { AuthenticationPanel } from './AuthenticationPanel';
import { VertexAIAuthPanel } from './VertexAIAuthPanel';
import { OpenAIAuthPanel } from './OpenAIAuthPanel';
import { AnthropicAuthPanel } from './AnthropicAuthPanel';
import { ExecutionModeBar } from './ExecutionModeBar';
import { TerminalOutputBlock } from './TerminalOutputBlock';
import { parseTerminalOutputMessage } from './terminalOutputUtils';
import { SystemPromptModal } from '../SystemPromptModal/SystemPromptModal';
import { ConfirmModal } from '../ConfirmModal/ConfirmModal';
import { useSettingsStore } from '../../stores/settingsStore';
import { tauriService } from '../../services/tauriService';
import { logError } from '../../utils/logger';
import type { AiChatState, ChatTab } from '../../hooks/useAiChat';
import { getActiveTab } from '../../hooks/useAiChat';
import type { SessionRecord } from '../../hooks/useSessionManager';
import type { PersonaDefinition, AIModelInfo } from '../../types/appTypes';
import { TabStrip } from './TabStrip';
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

// ── Extract execute commands from message content ──
function extractExecuteCommands(content: string): string[] {
    const parts = content.split(/(^```+[\s\S]*?^```+)/gm);
    const commands: string[] = [];
    for (const part of parts) {
        const match = part.match(/^```+(\w*)\s*\n?([\s\S]*?)\n?```+$/);
        if (match) {
            const lang = match[1].toLowerCase();
            let command = match[2].trim();
            const startsWithExecute = command.startsWith('execute\n') || command.startsWith('execute ');
            const isExecute = lang === 'execute' || (lang === '' && startsWithExecute) || ((lang === 'bash' || lang === 'sh' || lang === 'shell') && startsWithExecute);
            if (isExecute) {
                if (startsWithExecute) {
                    command = command.replace(/^execute\s+/, '').trim();
                }
                commands.push(command);
            }
        }
    }
    return commands;
}

// ── Message Content Component with Execution Support ──
const MessageContent: React.FC<{
    content: string;
    onRun?: (cmd: string) => void;
    onHoverTarget?: (hovered: boolean) => void;
    targetTitle?: string;
    targetId?: string;
    autoExecutedCommands?: Set<string>;
    classificationReason?: string;
    limitReached?: boolean;
}> = ({ content, onRun, onHoverTarget, targetTitle, targetId, autoExecutedCommands, classificationReason, limitReached }) => {
    const parts = content.split(/(^```+[\s\S]*?^```+)/gm);

    return (
        <>
            {parts.map((part, i) => {
                const match = part.match(/^```+(\w*)\s*\n?([\s\S]*?)\n?```+$/);
                if (match) {
                    const lang = match[1].toLowerCase();
                    let command = match[2].trim();
                    const startsWithExecute = command.startsWith('execute\n') || command.startsWith('execute ');
                    const isExecute = lang === 'execute' || (lang === '' && startsWithExecute) || ((lang === 'bash' || lang === 'sh' || lang === 'shell') && startsWithExecute);

                    if (isExecute) {
                        if (startsWithExecute) {
                            command = command.replace(/^execute\s+/, '').trim();
                        }
                        const wasAutoExecuted = autoExecutedCommands?.has(command);
                        return (
                            <div key={i} className={`ai-execute-block${wasAutoExecuted ? ' ai-execute-auto' : ''}`}>
                                <pre><code>{command}</code></pre>
                                <div className="ai-execute-actions">
                                    {wasAutoExecuted ? (
                                        <span className="ai-execute-auto-badge">
                                            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                                                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                                            </svg>
                                            Auto-executed
                                        </span>
                                    ) : (
                                        <button
                                            className="ai-run-btn"
                                            onClick={() => onRun?.(command)}
                                            onMouseEnter={() => onHoverTarget?.(true)}
                                            onMouseLeave={() => onHoverTarget?.(false)}
                                        >
                                            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                                                <path d="M8 5v14l11-7z" />
                                            </svg>
                                            Run in Terminal
                                        </button>
                                    )}
                                    {targetId ? (
                                        <span className="ai-run-target">Target: {targetTitle || 'Unnamed Terminal'}</span>
                                    ) : (
                                        <span className="ai-run-target no-target">No Terminal Targeted</span>
                                    )}
                                </div>
                                {!wasAutoExecuted && classificationReason && (
                                    <div className="ai-execute-unsafe-note">Manual: {classificationReason}</div>
                                )}
                                {!wasAutoExecuted && limitReached && (
                                    <div className="ai-execute-paused-banner">Auto-execution paused (limit reached). Click Run to continue.</div>
                                )}
                            </div>
                        );
                    }
                }
                return (
                    <div
                        key={i}
                        className="ai-chat-markdown-inline"
                        dangerouslySetInnerHTML={{ __html: sanitizeHtml(marked.parse(part, { async: false }) as string) }}
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
}) => {
    // Derive active tab from chatState (Phase 1: tabs[] + activeTabId, single linkedSessionId per tab)
    const activeTab = chatState ? getActiveTab(chatState) : undefined;
    const activeTabId = activeTab?.id;
    // Auth state
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isAuthLoading, setIsAuthLoading] = useState(false);
    const [clientId, setClientId] = useState('');
    const [clientSecret, setClientSecret] = useState('');

    // Vertex AI auth state
    const [vertexProjectId, setVertexProjectId] = useState(
        () => localStorage.getItem(STORAGE_KEYS.VERTEXAI_PROJECT_ID) || ''
    );
    const [vertexLocation, setVertexLocation] = useState(
        () => localStorage.getItem(STORAGE_KEYS.VERTEXAI_LOCATION) || ''
    );
    const [vertexAuthType, setVertexAuthType] = useState<'adc' | 'service_account'>(
        () => (localStorage.getItem(STORAGE_KEYS.VERTEXAI_AUTH_TYPE) as 'adc' | 'service_account') || 'adc'
    );
    const [vertexKeyFilePath, setVertexKeyFilePath] = useState(
        () => localStorage.getItem(STORAGE_KEYS.VERTEXAI_KEY_FILE_PATH) || ''
    );
    const [selectedRegion, setSelectedRegion] = useState(
        () => localStorage.getItem(STORAGE_KEYS.VERTEXAI_SELECTED_REGION) || localStorage.getItem(STORAGE_KEYS.VERTEXAI_LOCATION) || ''
    );
    const [availableRegions, setAvailableRegions] = useState<string[]>([]);
    const [isLoadingModels, setIsLoadingModels] = useState(false);

    const activeAiProvider = useSettingsStore(s => s.activeAiProvider);
    const commandExecutionMode = useSettingsStore(s => s.commandExecutionMode);
    const customSafeCommands = useSettingsStore(s => s.customSafeCommands);
    const maxConsecutiveAutoExecutions = useSettingsStore(s => s.maxConsecutiveAutoExecutions);

    // Auto-execute state
    const [consecutiveAutoExecCount, setConsecutiveAutoExecCount] = useState(0);
    const [autoExecutedCommands] = useState(() => new Set<string>());
    const autoExecProcessedRef = useRef(new Set<string>());
    const [autoExecPaused, setAutoExecPaused] = useState(false);

    // OpenAI auth state
    const [openaiApiKey, setOpenaiApiKey] = useState('');
    // Anthropic auth state
    const [anthropicApiKey, setAnthropicApiKey] = useState('');

    // Per-tab chat state (Phase 1: messages stored locally keyed by tabId so tab switch
    // swaps history without losing in-flight conversations).
    const [messagesByTab, setMessagesByTab] = useState<Map<string, ChatMessage[]>>(() => new Map());
    const [streamingByTab, setStreamingByTab] = useState<Map<string, string>>(() => new Map());
    const [streamingTabIds, setStreamingTabIds] = useState<Set<string>>(() => new Set());
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
    const [textareaHeight, setTextareaHeight] = useState(0);
    const [localSystemInstruction, setLocalSystemInstruction] = useState(chatState?.systemInstruction || 'You are a helpful assistant.');
    const [showPromptModal, setShowPromptModal] = useState(false);

    // Target session info derived from the active tab
    const lastTargetSessionId = activeTab?.linkedSessionId;
    const lastTargetSessionTitle = lastTargetSessionId ? (sessions?.get(lastTargetSessionId)?.displayName) : undefined;

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
    const [overflowMenuOpen, setOverflowMenuOpen] = useState(false);
    const overflowMenuRef = useRef<HTMLDivElement>(null);
    const overflowTriggerRef = useRef<HTMLButtonElement>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const settingsPopoverRef = useRef<HTMLDivElement>(null);
    const settingsTriggerRef = useRef<HTMLButtonElement>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const lastSentTextRef = useRef('');
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Model list
    const [authError, setAuthError] = useState<string | null>(null);
    const [availableModels, setAvailableModels] = useState<AIModelInfo[]>([]);
    const [modelLoadError, setModelLoadError] = useState(false);
    const authTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── Load credentials and auto-auth on mount / provider change ──
    const prevProviderRef = useRef(activeAiProvider);
    const paneIdRef = useRef(paneId);
    paneIdRef.current = paneId;

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
            tauriService.aiChatClear(paneIdRef.current).catch(() => {});
        }

        setIsAuthenticated(false);

        if (localStorage.getItem(STORAGE_KEYS.AI_EXPLICIT_LOGOUT)) {
            localStorage.removeItem(STORAGE_KEYS.AI_EXPLICIT_LOGOUT);
            return;
        }

        const load = async () => {
            try {
                if (activeAiProvider === 'vertexai') {
                    const projectId = localStorage.getItem(STORAGE_KEYS.VERTEXAI_PROJECT_ID) || '';
                    const location = localStorage.getItem(STORAGE_KEYS.VERTEXAI_LOCATION) || '';
                    if (projectId && location) {
                        setIsAuthLoading(true);
                        try {
                            await tauriService.aiSetProvider('vertexai');
                            const success = await tauriService.aiAuthAuto({ projectId, location });
                            setIsAuthenticated(success);
                        } finally {
                            setIsAuthLoading(false);
                        }
                    }
                    return;
                }

                if (activeAiProvider === 'openai') {
                    setIsAuthLoading(true);
                    try {
                        await tauriService.aiSetProvider('openai');
                        const success = await tauriService.aiAuthAuto({});
                        setIsAuthenticated(success);
                    } finally {
                        setIsAuthLoading(false);
                    }
                    return;
                }

                if (activeAiProvider === 'anthropic') {
                    setIsAuthLoading(true);
                    try {
                        await tauriService.aiSetProvider('anthropic');
                        const success = await tauriService.aiAuthAuto({});
                        setIsAuthenticated(success);
                    } finally {
                        setIsAuthLoading(false);
                    }
                    return;
                }

                // Gemini (Google AI Studio) auth
                const encId = localStorage.getItem(STORAGE_KEYS.GEMINI_CLIENT_ID) || '';
                const encSecret = localStorage.getItem(STORAGE_KEYS.GEMINI_CLIENT_SECRET) || '';

                let decryptedId = '';
                let decryptedSecret = '';

                if (encId) {
                    decryptedId = await tauriService.dpapiDecrypt(encId);
                    setClientId(decryptedId);
                }
                if (encSecret) {
                    decryptedSecret = await tauriService.dpapiDecrypt(encSecret);
                    setClientSecret(decryptedSecret);
                }

                if (decryptedId && decryptedSecret) {
                    setIsAuthLoading(true);
                    try {
                        await tauriService.aiSetProvider('gemini');
                        const success = await tauriService.aiAuthAuto({ clientId: decryptedId, clientSecret: decryptedSecret });
                        setIsAuthenticated(success);
                    } finally {
                        setIsAuthLoading(false);
                    }
                }
            } catch (err) {
                logError('AI', 'Failed to auto-auth', err);
                setIsAuthLoading(false);
            }
        };
        load();
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
                        { role: 'model', content: 'AI model not selected. Please select a model from the dropdown at the top right of the screen.' },
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
            streamingForTabIdRef.current = tab.id;
            markStreaming(tab.id, true);
            setStreamingForTab(tab.id, '');
            armStreamWatchdog();
            tauriService.aiChatSend(paneId, pm, selectedModel, sysInstr).catch((err) => {
                logError('AI', 'aiChatSend invoke failed', err);
                clearStreamWatchdog();
                markStreaming(tab.id, false);
                streamingForTabIdRef.current = null;
            });
            break;
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chatState, isAuthenticated, streamingTabIds, paneId, selectedModel]);

    // Watchdog: if no chunk arrives for STREAM_IDLE_TIMEOUT_MS while a stream
    // is in flight, cancel the request and surface an error. Backstop against
    // hung HTTP connections / unresponsive providers; complements the backend
    // request timeout.
    const STREAM_IDLE_TIMEOUT_MS = 180_000;
    const streamWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const clearStreamWatchdog = useCallback(() => {
        if (streamWatchdogRef.current) {
            clearTimeout(streamWatchdogRef.current);
            streamWatchdogRef.current = null;
        }
    }, []);
    const armStreamWatchdog = useCallback(() => {
        clearStreamWatchdog();
        streamWatchdogRef.current = setTimeout(() => {
            const targetTabId = streamingForTabIdRef.current;
            if (!targetTabId) return;
            tauriService.aiChatCancel(paneId).catch(() => {});
            setMessagesByTab(prev => {
                const next = new Map(prev);
                const cur = prev.get(targetTabId) ?? [];
                const partial = streamingByTab.get(targetTabId) ?? '';
                const body = partial
                    ? `${partial}\n\n[Error: AI stream idle for ${Math.round(STREAM_IDLE_TIMEOUT_MS / 1000)}s — request cancelled]`
                    : `Error: AI stream idle for ${Math.round(STREAM_IDLE_TIMEOUT_MS / 1000)}s — request cancelled`;
                next.set(targetTabId, [...cur, { role: 'model', content: body }]);
                return next;
            });
            setStreamingForTab(targetTabId, '');
            markStreaming(targetTabId, false);
            streamingForTabIdRef.current = null;
            streamWatchdogRef.current = null;
        }, STREAM_IDLE_TIMEOUT_MS);
    }, [clearStreamWatchdog, paneId, setStreamingForTab, markStreaming, streamingByTab]);

    // ��─ Listen for chat response events ──
    useEffect(() => {
        let cancelled = false;
        let unlisten: (() => void) | undefined;

        tauriService.onAiChatResponse((data) => {
            if (cancelled) return;
            if (data.sessionId !== paneId) return;

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

    // ── Listen for auth result events ──
    useEffect(() => {
        let cancelled = false;
        let unlisten: (() => void) | undefined;

        tauriService.onAiAuthResult((result) => {
            if (cancelled) return;
            if (authTimeoutRef.current) {
                clearTimeout(authTimeoutRef.current);
                authTimeoutRef.current = null;
            }
            setIsAuthLoading(false);
            setIsAuthenticated(result.success);
            if (!result.success) {
                setAuthError('Authentication failed. Please try again.');
            }
        }).then(fn => {
            if (cancelled) { fn(); } else { unlisten = fn; }
        }).catch(e => logError('AI', 'Auth result listener setup failed', e));

        return () => { cancelled = true; unlisten?.(); };
    }, []);

    // ── Auto-execute safe commands ──
    const handleRunCommandRef = useRef<(cmd: string) => void>(() => {});
    const prevIsStreamingRef = useRef(isStreaming);
    useEffect(() => {
        const wasStreaming = prevIsStreamingRef.current;
        prevIsStreamingRef.current = isStreaming;

        if (wasStreaming && !isStreaming && commandExecutionMode === 'auto-execute-safe') {
            if (autoExecPaused) return;
            const lastMsg = messages[messages.length - 1];
            if (!lastMsg || lastMsg.role !== 'model') return;
            if (!lastTargetSessionId) return;

            if (maxConsecutiveAutoExecutions > 0 && consecutiveAutoExecCount >= maxConsecutiveAutoExecutions) return;

            const commands = extractExecuteCommands(lastMsg.content);
            if (commands.length === 0) return;

            const command = commands[commands.length - 1];
            const blockKey = `${messages.length - 1}:${command}`;
            if (autoExecProcessedRef.current.has(blockKey)) return;

            const classification = classifyCommand(command, customSafeCommands);
            if (!classification.safe) return;

            autoExecProcessedRef.current.add(blockKey);
            autoExecutedCommands.add(command);
            setConsecutiveAutoExecCount(prev => prev + 1);
            handleRunCommandRef.current(command);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isStreaming, messages, commandExecutionMode, lastTargetSessionId, customSafeCommands, maxConsecutiveAutoExecutions, consecutiveAutoExecCount, autoExecPaused]);

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
                        await tauriService.aiSetLocation(selectedRegion);
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

    const handleLogin = async () => {
        setIsAuthLoading(true);
        setAuthError(null);
        authTimeoutRef.current = setTimeout(() => {
            setIsAuthLoading(false);
            setAuthError('Authentication timed out. Please try again.');
            authTimeoutRef.current = null;
        }, 30000);

        if (activeAiProvider === 'vertexai') {
            localStorage.setItem(STORAGE_KEYS.VERTEXAI_PROJECT_ID, vertexProjectId);
            localStorage.setItem(STORAGE_KEYS.VERTEXAI_LOCATION, vertexLocation);
            localStorage.setItem(STORAGE_KEYS.VERTEXAI_AUTH_TYPE, vertexAuthType);
            localStorage.setItem(STORAGE_KEYS.VERTEXAI_KEY_FILE_PATH, vertexKeyFilePath);
            setSelectedRegion(vertexLocation);
            localStorage.setItem(STORAGE_KEYS.VERTEXAI_SELECTED_REGION, vertexLocation);
            await tauriService.aiSetProvider('vertexai');
            await tauriService.aiAuthStart({
                projectId: vertexProjectId,
                location: vertexLocation,
                authType: vertexAuthType,
                keyFilePath: vertexKeyFilePath || undefined,
            });
            return;
        }

        if (activeAiProvider === 'openai') {
            if (!openaiApiKey) {
                if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current);
                setIsAuthLoading(false);
                return;
            }
            await tauriService.aiSetProvider('openai');
            await tauriService.aiAuthStart({ apiKey: openaiApiKey });
            return;
        }

        if (activeAiProvider === 'anthropic') {
            if (!anthropicApiKey) {
                if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current);
                setIsAuthLoading(false);
                return;
            }
            await tauriService.aiSetProvider('anthropic');
            await tauriService.aiAuthStart({ apiKey: anthropicApiKey });
            return;
        }

        if (!clientId || !clientSecret) {
            if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current);
            setIsAuthLoading(false);
            return;
        }
        try {
            const encId = await tauriService.dpapiEncrypt(clientId);
            const encSecret = await tauriService.dpapiEncrypt(clientSecret);
            localStorage.setItem(STORAGE_KEYS.GEMINI_CLIENT_ID, encId);
            localStorage.setItem(STORAGE_KEYS.GEMINI_CLIENT_SECRET, encSecret);
        } catch (err) {
            logError('AI', 'Failed to encrypt Gemini credentials', err);
        }
        await tauriService.aiSetProvider('gemini');
        await tauriService.aiAuthStart({ clientId, clientSecret });
    };

    const handleLogout = () => {
        clearStreamWatchdog();
        localStorage.setItem(STORAGE_KEYS.AI_EXPLICIT_LOGOUT, '1');
        tauriService.aiAuthLogout().catch(() => {});
        setIsAuthenticated(false);
        // Logout clears all in-progress conversations across all tabs.
        setMessagesByTab(new Map());
        setStreamingByTab(new Map());
        setStreamingTabIds(new Set());
        streamingForTabIdRef.current = null;
    };

    const handleRunCommand = (command: string) => {
        if (!lastTargetSessionId || !activeTabId) return;
        const cleanCmd = command.trim();
        // Pass the originating tab id so the result is delivered back to the same tab,
        // even if the user switches tabs while the command is executing.
        onRunCommand?.(lastTargetSessionId, cleanCmd, activeTabId);
        tauriService.focusWindow().catch(() => {});
        window.dispatchEvent(new CustomEvent('hotty-focus-session', { detail: { sessionId: lastTargetSessionId } }));
    };
    handleRunCommandRef.current = handleRunCommand;

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
        setInputText('');
        // Capture which tab owns this stream so chunks land in the right tab even after a tab switch.
        streamingForTabIdRef.current = activeTabId ?? null;
        setIsStreaming(true);
        setStreamingContent('');
        armStreamWatchdog();

        if (onSendMessage) {
            onSendMessage(text);
        } else {
            tauriService.aiChatSend(paneId, text, selectedModel, localSystemInstruction).catch((err) => {
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
        }
        setTotalInputTokens(0);
        setTotalOutputTokens(0);
        setTotalCost(null);
        tauriService.aiChatClear(paneId).catch(() => {});
    };

    const handleNewChatClick = () => {
        if (messages.length > 0 || streamingContent) {
            setShowNewChatConfirm(true);
        } else {
            performNewChat();
        }
    };

    useEffect(() => {
        if (!overflowMenuOpen) return;
        const onMouseDown = (e: MouseEvent) => {
            const target = e.target as Node;
            if (overflowMenuRef.current?.contains(target)) return;
            if (overflowTriggerRef.current?.contains(target)) return;
            setOverflowMenuOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOverflowMenuOpen(false);
        };
        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [overflowMenuOpen]);

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
        tauriService.aiChatCancel(paneId).catch(() => {});
        // Append the partial content + [cancelled] to the tab that owns the in-flight stream.
        const targetTabId = streamingForTabIdRef.current ?? activeTabId ?? null;
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
        setInputText(lastSentTextRef.current);
        setTimeout(() => {
            const ta = textareaRef.current;
            if (ta) {
                ta.focus();
                ta.selectionStart = ta.selectionEnd = ta.value.length;
            }
        }, 0);
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
                    Failed to retrieve the AI model list. Please check your authentication and network connection.
                    <button onClick={() => setModelLoadError(false)} style={{ marginLeft: 8, cursor: 'pointer', background: 'none', border: 'none', color: 'inherit', textDecoration: 'underline' }}>Dismiss</button>
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
                            title="Start a new chat"
                            aria-label="Start a new chat"
                        >
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <line x1="12" y1="5" x2="12" y2="19" />
                                <line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                            <span>New chat</span>
                        </button>
                    )}
                    {isAuthenticated && lastTargetSessionId && (
                        <button
                            type="button"
                            className="ai-chat-linked-chip"
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
                            title={`Linked to ${lastTargetSessionTitle || 'terminal'}. Click to focus.`}
                            aria-label={`Linked terminal: ${lastTargetSessionTitle || 'unknown'}`}
                        >
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                            </svg>
                            <span className="ai-chat-linked-chip-name">{lastTargetSessionTitle || 'terminal'}</span>
                        </button>
                    )}
                </div>
                <div className="ai-chat-header-right">
                    {isAuthenticated && (
                        <>
                            <div className="ai-chat-overflow-wrap">
                                <button
                                    ref={overflowTriggerRef}
                                    type="button"
                                    className="ai-chat-header-btn ai-chat-overflow-btn"
                                    onClick={() => setOverflowMenuOpen(o => !o)}
                                    title="More options"
                                    aria-label="More options"
                                    aria-haspopup="menu"
                                    aria-expanded={overflowMenuOpen}
                                >
                                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
                                        <circle cx="12" cy="5" r="1.6" />
                                        <circle cx="12" cy="12" r="1.6" />
                                        <circle cx="12" cy="19" r="1.6" />
                                    </svg>
                                </button>
                                {overflowMenuOpen && (
                                    <div ref={overflowMenuRef} className="ai-chat-overflow-menu" role="menu">
                                        <button
                                            type="button"
                                            className="ai-chat-overflow-item"
                                            role="menuitem"
                                            onClick={() => {
                                                setOverflowMenuOpen(false);
                                                handleLogout();
                                            }}
                                        >
                                            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                                                <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
                                            </svg>
                                            <span>Logout</span>
                                        </button>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>

            {!isAuthenticated ? (
                activeAiProvider === 'vertexai' ? (
                    <VertexAIAuthPanel
                        projectId={vertexProjectId}
                        setProjectId={setVertexProjectId}
                        location={vertexLocation}
                        setLocation={setVertexLocation}
                        authType={vertexAuthType}
                        setAuthType={setVertexAuthType}
                        keyFilePath={vertexKeyFilePath}
                        setKeyFilePath={setVertexKeyFilePath}
                        isAuthLoading={isAuthLoading}
                        onLogin={handleLogin}
                        authError={authError}
                    />
                ) : activeAiProvider === 'openai' ? (
                    <OpenAIAuthPanel
                        apiKey={openaiApiKey}
                        setApiKey={setOpenaiApiKey}
                        isAuthLoading={isAuthLoading}
                        onLogin={handleLogin}
                        authError={authError}
                    />
                ) : activeAiProvider === 'anthropic' ? (
                    <AnthropicAuthPanel
                        apiKey={anthropicApiKey}
                        setApiKey={setAnthropicApiKey}
                        isAuthLoading={isAuthLoading}
                        onLogin={handleLogin}
                        authError={authError}
                    />
                ) : (
                    <AuthenticationPanel
                        clientId={clientId}
                        setClientId={setClientId}
                        clientSecret={clientSecret}
                        setClientSecret={setClientSecret}
                        isAuthLoading={isAuthLoading}
                        onLogin={handleLogin}
                        authError={authError}
                    />
                )
            ) : (
                <div className="ai-chat-body">
                    <div className="ai-chat-messages" ref={scrollContainerRef}>
                        {messages.length === 0 && !streamingContent && !isStreaming && (
                            <div className="ai-chat-empty-state">
                                <div className="ai-chat-empty-icon">
                                    <AIIcon size={56} />
                                </div>
                                <h2 className="ai-chat-empty-title">How can I help?</h2>
                                {lastTargetSessionId ? (
                                    <div className="ai-chat-empty-target">
                                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                                        </svg>
                                        <span>Linked to <strong>{lastTargetSessionTitle || 'terminal'}</strong></span>
                                    </div>
                                ) : (
                                    <div className="ai-chat-empty-target ai-chat-empty-target--none">
                                        <span>No terminal linked yet — open a session to enable command execution</span>
                                    </div>
                                )}
                                <div className="ai-chat-empty-suggestions">
                                    {[
                                        'What does this terminal output mean?',
                                        'Find any issues in the recent output',
                                        "Explain the last command's result",
                                    ].map((prompt) => (
                                        <button
                                            key={prompt}
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
                                    ))}
                                </div>
                                <p className="ai-chat-empty-tip">
                                    Tip: right-click on terminal text to use <strong>Ask AI</strong> with the selection.
                                </p>
                            </div>
                        )}
                        {messages.map((msg, idx) => (
                            <div key={idx} className={`ai-chat-message ai-chat-message-${msg.role}`}>
                                <div className="ai-chat-message-avatar">
                                    {msg.role === 'user' ? '\u{1F464}' : <AIIcon size={18} />}
                                </div>
                                <div className={`ai-chat-message-content ${msg.role === 'model' ? 'ai-chat-markdown' : ''}`}>
                                    {msg.role === 'model' ? (
                                        <MessageContent
                                            content={msg.content}
                                            onRun={(cmd) => { setConsecutiveAutoExecCount(0); handleRunCommand(cmd); }}
                                            onHoverTarget={handleHoverTarget}
                                            targetTitle={lastTargetSessionTitle}
                                            targetId={lastTargetSessionId}
                                            autoExecutedCommands={autoExecutedCommands}
                                            classificationReason={commandExecutionMode === 'auto-execute-safe' ? (() => {
                                                const cmds = extractExecuteCommands(msg.content);
                                                if (cmds.length === 0) return undefined;
                                                const c = classifyCommand(cmds[cmds.length - 1], customSafeCommands);
                                                return c.safe ? undefined : c.reason;
                                            })() : undefined}
                                            limitReached={commandExecutionMode === 'auto-execute-safe' && maxConsecutiveAutoExecutions > 0 && consecutiveAutoExecCount >= maxConsecutiveAutoExecutions}
                                        />
                                    ) : (() => {
                                        const parsed = parseTerminalOutputMessage(msg.content);
                                        return parsed
                                            ? <TerminalOutputBlock cmd={parsed.cmd} output={parsed.output} />
                                            : <pre>{msg.content}</pre>;
                                    })()}
                                </div>
                            </div>
                        ))}
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
                                    />
                                </div>
                            </div>
                        )}
                        {isStreaming && !streamingContent && (
                            <div className="ai-chat-message ai-chat-message-model">
                                <div className="ai-chat-message-avatar"><AIIcon size={18} /></div>
                                <div className="ai-chat-message-content">
                                    <span className="ai-chat-thinking">
                                        Thinking
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
                            placeholder={selectedModel === 'Unspecified' ? 'Select a model to start...' : 'Type a message...'}
                            disabled={isStreaming}
                        />
                        <div className="ai-chat-input-toolbar">
                            <div className="ai-chat-settings-wrap">
                                <button
                                    ref={settingsTriggerRef}
                                    type="button"
                                    className={`ai-chat-settings-btn${settingsOpen ? ' open' : ''}`}
                                    onClick={() => setSettingsOpen(o => !o)}
                                    title="AI settings"
                                    aria-label="AI settings"
                                    aria-haspopup="dialog"
                                    aria-expanded={settingsOpen}
                                >
                                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <circle cx="12" cy="12" r="3" />
                                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                                    </svg>
                                    <span className="ai-chat-settings-btn-label">{selectedModel === 'Unspecified' ? 'Select model' : (availableModels.find(m => m.name === selectedModel)?.displayName || selectedModel)}</span>
                                </button>
                                {settingsOpen && (
                                    <div ref={settingsPopoverRef} className="ai-chat-settings-popover" role="dialog" aria-label="AI settings">
                                        <div className="ai-chat-settings-popover-section">
                                            <label className="ai-chat-settings-popover-label">Model</label>
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
                                                {selectedModel === 'Unspecified' && <option value="Unspecified">{isLoadingModels ? 'Loading...' : 'Select a model...'}</option>}
                                                {availableModels.map(m => (
                                                    <option key={m.name} value={m.name}>{m.displayName}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="ai-chat-settings-popover-section">
                                            <label className="ai-chat-settings-popover-label">Persona</label>
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
                                                    View prompt
                                                </button>
                                            </div>
                                        </div>
                                        <div className="ai-chat-settings-popover-section">
                                            <label className="ai-chat-settings-popover-label">Language</label>
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
                                                <label className="ai-chat-settings-popover-label">Region</label>
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
                                        ? 'Select a model first'
                                        : !inputText.trim()
                                        ? 'Type a message first'
                                        : isStreaming
                                        ? 'Streaming…'
                                        : 'Send'
                                }
                            >&#x27A4;</button>
                        </div>
                    </div>
                    {selectedModel === 'Unspecified' && (
                        <div className="ai-chat-input-hint">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
                                <path d="M12 2L1 21h22L12 2zm0 4l8.53 14.5H3.47L12 6zm-1 5v5h2v-5h-2zm0 7v2h2v-2h-2z" />
                            </svg>
                            <span>Select a model in the header to send messages</span>
                        </div>
                    )}
                    {(inputText.length > 0 || isStreaming || totalInputTokens > 0 || totalOutputTokens > 0) && (
                        <div className="ai-token-status">
                            {isStreaming ? (
                                streamingContent.length > 0 ? (
                                    <span>Receiving &middot; {Math.ceil(streamingContent.length / 4).toLocaleString()} tokens</span>
                                ) : (
                                    <span>Waiting for response&hellip;</span>
                                )
                            ) : (
                                <>
                                    {(totalInputTokens > 0 || totalOutputTokens > 0) && (
                                        <span>{totalInputTokens.toLocaleString()} in / {totalOutputTokens.toLocaleString()} out tokens</span>
                                    )}
                                    {totalCost !== null && (
                                        <>
                                            <span className="ai-token-status-sep">&middot;</span>
                                            <span>~{formatAICost(totalCost)}</span>
                                        </>
                                    )}
                                    {inputText.length > 0 && (
                                        <>
                                            {(totalInputTokens > 0 || totalOutputTokens > 0) && <span className="ai-token-status-sep">&middot;</span>}
                                            <span>~{Math.ceil(inputText.length / 4).toLocaleString()} tokens to send</span>
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
                    title="Start a new chat?"
                    message="The current conversation will be cleared. This cannot be undone."
                    confirmLabel="Start new chat"
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
