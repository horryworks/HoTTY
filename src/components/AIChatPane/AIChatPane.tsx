import React, { useState, useEffect, useRef } from 'react';
import { marked } from 'marked';
import { getTransparentColor } from '../../utils/colorUtils';
import { STORAGE_KEYS } from '../../constants/storage';
import { calcAICost } from '../../constants/aiPricing';
import { buildExecutionRules } from '../../constants/aiPrompts';
import { AuthenticationPanel } from './AuthenticationPanel';
import { VertexAIAuthPanel } from './VertexAIAuthPanel';
import { OpenAIAuthPanel } from './OpenAIAuthPanel';
import { AnthropicAuthPanel } from './AnthropicAuthPanel';
import { MessageModal } from '../MessageModal/MessageModal';
import { useSettingsStore } from '../../stores/settingsStore';
import * as electronService from '../../services/electronService';
import { classifyCommand } from '../../utils/commandClassifier';
import './AIChatPane.css';

interface ChatMessage {
    role: 'user' | 'model';
    content: string;
}

interface AIChatPaneProps {
    sessionId: string;
    initialState?: {
        messages: ChatMessage[];
        inputText: string;
        selectedModel: string;
        selectedLanguage: string;
        selectedExpertise?: string;
        pendingMessage?: string;
        systemInstruction?: string;
        textareaHeight: number;
        scrollTop?: number;
        lastTargetSessionId?: string;
        lastTargetSessionTitle?: string;
        isWaitingForTerminal?: boolean;
    };
    aiPersona?: string;
    onStateChange?: (state: {
        messages: ChatMessage[];
        inputText: string;
        selectedModel: string;
        selectedLanguage: string;
        selectedExpertise?: string;
        pendingMessage?: string;
        systemInstruction?: string;
        textareaHeight: number;
        scrollTop?: number;
        lastTargetSessionId?: string;
        lastTargetSessionTitle?: string;
        isWaitingForTerminal?: boolean;
    }) => void;
    onRunCommand?: (sessionId: string, command: string) => void;
    onShowPromptMenu?: () => void;
    onSendMessage?: (text: string) => void;
    showSystemPrompt: boolean;
    askAiCommands: { id: string; label: string; promptTemplate: string }[];
    aiPersonas: { id: string; label: string; systemPrompt: string }[];
    fontSize?: number;
    isActive?: boolean;
    terminalBackground?: string;
    terminalBackgroundInactive?: string;
    lastTerminalSessionId?: string | null;
    lastTerminalSessionTitle?: string | null;
    interactiveSessionTracking?: {
        buffer: string;
        startTime: number;
    };
}

// ── Gemini Icon Component ──
const GeminiIcon: React.FC<{ size?: number; className?: string }> = ({ size = 24, className = "" }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className={className}
        style={{ flexShrink: 0 }}
    >
        <path d="M12 2L14.8 9.2L22 12L14.8 14.8L12 22L9.2 14.8L2 12L9.2 9.2L12 2Z" fill="url(#gemini-gradient)" />
        <defs>
            <linearGradient id="gemini-gradient" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                <stop stopColor="#4E77FF" />
                <stop offset="0.5" stopColor="#A87FF4" />
                <stop offset="1" stopColor="#FF76AB" />
            </linearGradient>
        </defs>
    </svg>
);

import { sanitizeHtml } from '../../utils/htmlUtils';

import { extractExecuteCommands } from './extractExecuteCommands';

// ── Custom Message Component with Execution Support ──
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
    // We split the content by any code blocks (3 or more backticks).
    const parts = content.split(/(^```+[\s\S]*?^```+)/gm);

    return (
        <>
            {parts.map((part, i) => {
                const match = part.match(/^```+(\w*)\s*\n?([\s\S]*?)\n?```+$/);
                if (match) {
                    const lang = match[1].toLowerCase();
                    let command = match[2].trim();

                    // Check if it's an explicit execute block or a generic one starting with 'execute'
                    // Also check for 'bash' or 'sh' if the first line is 'execute'
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
                // Fallback to standard markdown for other parts (including non-execute code blocks)
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

export const AIChatPane: React.FC<AIChatPaneProps> = React.memo(({
    sessionId,
    initialState,
    onStateChange,
    showSystemPrompt,
    aiPersonas,
    fontSize,
    terminalBackground,
    lastTerminalSessionId: lastTerminalSessionIdProp,
    lastTerminalSessionTitle: lastTerminalSessionTitleProp,
    onRunCommand,
    onShowPromptMenu,
    onSendMessage,
    interactiveSessionTracking
}) => {
    // Auth state
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isAuthLoading, setIsAuthLoading] = useState(false);
    const [clientId, setClientId] = useState<string>('');
    const [clientSecret, setClientSecret] = useState<string>('');

    // Vertex AI auth state
    const [vertexProjectId, setVertexProjectId] = useState<string>(
        () => localStorage.getItem(STORAGE_KEYS.VERTEXAI_PROJECT_ID) || ''
    );
    const [vertexLocation, setVertexLocation] = useState<string>(
        () => localStorage.getItem(STORAGE_KEYS.VERTEXAI_LOCATION) || ''
    );
    const [vertexAuthType, setVertexAuthType] = useState<'adc' | 'service_account'>(
        () => (localStorage.getItem(STORAGE_KEYS.VERTEXAI_AUTH_TYPE) as 'adc' | 'service_account') || 'adc'
    );
    const [vertexKeyFilePath, setVertexKeyFilePath] = useState<string>(
        () => localStorage.getItem(STORAGE_KEYS.VERTEXAI_KEY_FILE_PATH) || ''
    );
    const [selectedRegion, setSelectedRegion] = useState<string>(
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

    // OpenAI auth state
    const [openaiApiKey, setOpenaiApiKey] = useState<string>('');

    // Anthropic auth state
    const [anthropicApiKey, setAnthropicApiKey] = useState<string>('');

    // Load credentials and attempt auto-auth on mount / provider change
    const prevProviderRef = useRef(activeAiProvider);
    const sessionIdRef = useRef(sessionId);
    sessionIdRef.current = sessionId;
    useEffect(() => {
        // Clear chat when provider changes (not on initial mount)
        if (prevProviderRef.current !== activeAiProvider) {
            prevProviderRef.current = activeAiProvider;
            setMessages([]);
            setStreamingContent('');
            setTotalInputTokens(0);
            setTotalOutputTokens(0);
            setTotalCost(null);
            setSelectedModel('Unspecified');
            if (sessionIdRef.current) {
                electronService.aiChatClear(sessionIdRef.current);
            }
        }

        setIsAuthenticated(false);

        // Skip auto-auth if the user explicitly logged out
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
                            await electronService.aiSetProvider('vertexai');
                            const success = await electronService.aiAuthAuto({ projectId, location });
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
                        await electronService.aiSetProvider('openai');
                        const success = await electronService.aiAuthAuto({});
                        setIsAuthenticated(success);
                    } finally {
                        setIsAuthLoading(false);
                    }
                    return;
                }

                if (activeAiProvider === 'anthropic') {
                    setIsAuthLoading(true);
                    try {
                        await electronService.aiSetProvider('anthropic');
                        const success = await electronService.aiAuthAuto({});
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
                    decryptedId = await electronService.decryptSecret(encId);
                    setClientId(decryptedId);
                }
                if (encSecret) {
                    decryptedSecret = await electronService.decryptSecret(encSecret);
                    setClientSecret(decryptedSecret);
                }

                if (decryptedId && decryptedSecret) {
                    setIsAuthLoading(true);
                    try {
                        await electronService.aiSetProvider('gemini');
                        const success = await electronService.aiAuthAuto({ clientId: decryptedId, clientSecret: decryptedSecret });
                        setIsAuthenticated(success);
                    } finally {
                        setIsAuthLoading(false);
                    }
                }
            } catch (err) {
                console.error('Failed to auto-auth:', err);
                setIsAuthLoading(false);
            }
        };
        load();
    }, [activeAiProvider]);

    // Chat state - initialize from props if available
    const [messages, setMessages] = useState<ChatMessage[]>(initialState?.messages || []);
    const [inputText, setInputText] = useState(initialState?.inputText || '');
    const [selectedModel, setSelectedModel] = useState(initialState?.selectedModel || 'Unspecified');
    const selectedModelRef = useRef(selectedModel);
    selectedModelRef.current = selectedModel;
    const [selectedLanguage, setSelectedLanguage] = useState(initialState?.selectedLanguage || 'English');
    const defaultExpertise = aiPersonas?.[0]?.label || 'Network Expert';
    const [selectedExpertise, setSelectedExpertise] = useState(initialState?.selectedExpertise || defaultExpertise);
    const [textareaHeight, setTextareaHeight] = useState(initialState?.textareaHeight || 0);
    const [localSystemInstruction, setLocalSystemInstruction] = useState(initialState?.systemInstruction || 'You are a helpful assistant.');

    // Target session info
    const [lastTargetSessionId, setLastTargetSessionId] = useState(initialState?.lastTargetSessionId);
    const [lastTargetSessionTitle, setLastTargetSessionTitle] = useState(initialState?.lastTargetSessionTitle);

    // Interactive flow state
    const [isWaitingForTerminal, setIsWaitingForTerminal] = useState(initialState?.isWaitingForTerminal || false);

    // Initialize target from props if empty and available
    useEffect(() => {
        if (!lastTargetSessionId && lastTerminalSessionIdProp) {
            setLastTargetSessionId(lastTerminalSessionIdProp);
            setLastTargetSessionTitle(lastTerminalSessionTitleProp || 'Unnamed Terminal');
        }
    }, [lastTerminalSessionIdProp, lastTerminalSessionTitleProp, lastTargetSessionId]);

    // Manage pending message locally to avoid sync race conditions
    const [localPendingMessage, setLocalPendingMessage] = useState(initialState?.pendingMessage);

    // Sync pending message from props if it arrives later or changes
    useEffect(() => {
        if (initialState?.pendingMessage !== undefined && initialState.pendingMessage !== processedPendingMessageRef.current) {
            setLocalPendingMessage(initialState.pendingMessage);
        }
        if (initialState?.lastTargetSessionId !== undefined) {
            setLastTargetSessionId(initialState.lastTargetSessionId);
        }
        if (initialState?.lastTargetSessionTitle !== undefined) {
            setLastTargetSessionTitle(initialState.lastTargetSessionTitle);
        }
        if (initialState?.isWaitingForTerminal !== undefined) {
            setIsWaitingForTerminal(initialState.isWaitingForTerminal);
        }
    }, [initialState?.pendingMessage, initialState?.lastTargetSessionId, initialState?.lastTargetSessionTitle, initialState?.isWaitingForTerminal]);

    const [isStreaming, setIsStreaming] = useState(false);
    const [streamingContent, setStreamingContent] = useState('');
    const [totalInputTokens, setTotalInputTokens] = useState(0);
    const [totalOutputTokens, setTotalOutputTokens] = useState(0);
    const [totalCost, setTotalCost] = useState<number | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const lastSentTextRef = useRef<string>('');
    const processedPendingMessageRef = useRef<string | undefined>(undefined);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Real-time System Prompt Update
    useEffect(() => {
        let basePrompt = '';

        // Find selected persona from props
        const selectedPersona = aiPersonas?.find(p => p.label === selectedExpertise);

        if (selectedPersona) {
            basePrompt = selectedPersona.systemPrompt;
        } else {
            // Fallback to first persona or default if not found
            basePrompt = aiPersonas?.[0]?.systemPrompt || 'You are a helpful assistant.';
        }

        let langInstruction = '';
        if (selectedLanguage !== 'English') {
            langInstruction = ` Answer in ${selectedLanguage}.`;
        }

        // Add execution instruction and proactive instruction
        const extraInstructions = buildExecutionRules();
        setLocalSystemInstruction(`${basePrompt}${langInstruction}${extraInstructions}`);

    }, [selectedExpertise, selectedLanguage, aiPersonas]);


    // Initialize scroll position
    useEffect(() => {
        if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
        }
    }, [messages]);

    // Auto-send pending message if authenticated
    useEffect(() => {
        if (isAuthenticated && localPendingMessage && !isStreaming) {
            const text = localPendingMessage;
            const sysInstr = initialState?.systemInstruction || localSystemInstruction;

            setLocalPendingMessage(undefined);
            processedPendingMessageRef.current = text; // Mark as processed

            // CRITICAL: Clear pendingMessage in central state as well
            if (onStateChangeRef.current) {
                onStateChangeRef.current({
                    messages: [...messages, { role: 'user', content: text }],
                    inputText: '',
                    selectedModel,
                    selectedLanguage,
                    selectedExpertise,
                    textareaHeight,
                    scrollTop: scrollContainerRef.current?.scrollTop || 0,
                    pendingMessage: undefined, // Clear it!
                    systemInstruction: sysInstr,
                    lastTargetSessionId,
                    lastTargetSessionTitle,
                    isWaitingForTerminal: true
                });
            }

            if (selectedModel === 'Unspecified') {
                setMessages(prev => [
                    ...prev,
                    { role: 'user', content: text },
                    { role: 'model', content: '⚠️ AI model not selected. Please select a model from the dropdown at the top right of the screen.' }
                ]);
                return;
            }

            setMessages(prev => [...prev, { role: 'user', content: text }]);
            lastSentTextRef.current = text;
            setIsStreaming(true);
            setStreamingContent('');
            electronService.aiChatSend(sessionId, text, selectedModel, sysInstr);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated, localPendingMessage, isStreaming, sessionId, selectedModel, initialState?.systemInstruction, localSystemInstruction, messages, lastTargetSessionId, lastTargetSessionTitle, textareaHeight]);

    // Keep ref to onStateChange to avoid effect re-triggering
    const onStateChangeRef = useRef(onStateChange);
    useEffect(() => {
        onStateChangeRef.current = onStateChange;
    }, [onStateChange]);

    // Sync state back to parent
    useEffect(() => {
        if (onStateChangeRef.current) {
            onStateChangeRef.current({
                messages,
                inputText,
                selectedModel,
                selectedLanguage,
                selectedExpertise,
                textareaHeight,
                scrollTop: scrollContainerRef.current?.scrollTop,
                pendingMessage: localPendingMessage,
                systemInstruction: localSystemInstruction,
                lastTargetSessionId,
                lastTargetSessionTitle,
                isWaitingForTerminal
            });
        }
    }, [messages, inputText, selectedModel, selectedLanguage, selectedExpertise, textareaHeight, localSystemInstruction, localPendingMessage, lastTargetSessionId, lastTargetSessionTitle, isWaitingForTerminal]);

    useEffect(() => {
        electronService.aiAuthStatus().then(setIsAuthenticated);
    }, []);

    useEffect(() => {
        const removeListener = electronService.onAiChatResponse((data) => {
            if (data.sessionId !== sessionId) return;

            if (data.type === 'chunk') {
                setStreamingContent(prev => prev + data.content);
            } else if (data.type === 'done') {
                setMessages(prev => [...prev, { role: 'model', content: data.content }]);
                setStreamingContent('');
                setIsStreaming(false);
                if (data.usageMetadata) {
                    const inTokens = data.usageMetadata!.promptTokenCount || 0;
                    const outTokens = data.usageMetadata!.candidatesTokenCount || 0;
                    setTotalInputTokens(prev => prev + inTokens);
                    setTotalOutputTokens(prev => prev + outTokens);
                    const responseCost = calcAICost(inTokens, outTokens, selectedModelRef.current);
                    if (responseCost !== null) {
                        setTotalCost(prev => (prev ?? 0) + responseCost);
                    }
                }
            } else if (data.type === 'error') {
                setMessages(prev => [...prev, { role: 'model', content: `⚠️ ${data.content}` }]);
                setStreamingContent('');
                setIsStreaming(false);
            }
        });
        return () => removeListener();
    }, [sessionId]);

    // ── Auto-execute safe commands ──
    const handleRunCommandRef = useRef<(cmd: string) => void>(() => {});
    const prevIsStreamingRef = useRef(isStreaming);
    useEffect(() => {
        const wasStreaming = prevIsStreamingRef.current;
        prevIsStreamingRef.current = isStreaming;

        // Only trigger when streaming just finished
        if (wasStreaming && !isStreaming && commandExecutionMode === 'auto-execute-safe') {
            const lastMsg = messages[messages.length - 1];
            if (!lastMsg || lastMsg.role !== 'model') return;
            if (!lastTargetSessionId) return;

            // Check consecutive limit (0 = unlimited)
            if (maxConsecutiveAutoExecutions > 0 && consecutiveAutoExecCount >= maxConsecutiveAutoExecutions) return;

            const commands = extractExecuteCommands(lastMsg.content);
            if (commands.length === 0) return;

            // Auto-execute the last command in the message
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
    }, [isStreaming, messages, commandExecutionMode, lastTargetSessionId, customSafeCommands, maxConsecutiveAutoExecutions, consecutiveAutoExecCount]);

    const [authError, setAuthError] = useState<string | null>(null);
    const [availableModels, setAvailableModels] = useState<{ name: string; displayName: string }[]>([]);
    const [modelLoadError, setModelLoadError] = useState(false);

    const authTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const removeListener = electronService.onAiAuthResult((result) => {
            if (authTimeoutRef.current) {
                clearTimeout(authTimeoutRef.current);
                authTimeoutRef.current = null;
            }
            setIsAuthLoading(false);
            setIsAuthenticated(result.success);
            if (!result.success) {
                setAuthError('Authentication failed. Please try again.');
            }
        });
        return () => removeListener();
    }, []);

    const prevMessagesLength = useRef(messages.length);
    const lastScrollType = useRef<'user' | 'model' | 'streaming-start' | null>(null);

    useEffect(() => {
        if (scrollContainerRef.current) {
            // Check if messages length increased
            if (messages.length > prevMessagesLength.current) {
                const lastMsg = messages[messages.length - 1];
                if (lastMsg.role === 'model') {
                    // Completed AI response: ensure the start is visible
                    const modelMsgs = scrollContainerRef.current.querySelectorAll('.ai-chat-message-model');
                    if (modelMsgs.length > 0) {
                        modelMsgs[modelMsgs.length - 1].scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                } else {
                    // User message added: scroll to bottom
                    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
                }
            } else if (isStreaming && streamingContent) {
                // During streaming: ONLY scroll to top of the message when it starts
                // or keep near bottom if it's short.
                // However, the user specifically asked for "beginning of latest response"
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

    const handleScroll = () => {
        if (onStateChangeRef.current && scrollContainerRef.current) {
            onStateChangeRef.current({
                messages,
                inputText,
                selectedModel,
                selectedLanguage,
                selectedExpertise,
                textareaHeight,
                scrollTop: scrollContainerRef.current.scrollTop,
                pendingMessage: localPendingMessage,
                systemInstruction: localSystemInstruction,
                lastTargetSessionId,
                lastTargetSessionTitle,
                isWaitingForTerminal
            });
        }
    };

    useEffect(() => {
        if (isAuthenticated) {
            setIsLoadingModels(true);
            setModelLoadError(false);
            const load = async () => {
                try {
                    if (activeAiProvider === 'vertexai') {
                        await electronService.aiSetLocation(selectedRegion);
                        // Fetch available regions in background
                        electronService.aiListLocations().then(locations => {
                            if (locations.length > 0) setAvailableRegions(locations);
                        }).catch(() => { /* ignore — fallback to selectedRegion only */ });
                    }
                    const models = await electronService.aiListModels();
                    if (models.length > 0) {
                        setAvailableModels(models);
                        // Restore last-used model for this provider, or keep current if still available
                        setSelectedModel(prev => {
                            // If switching providers, try to restore the saved model for the new provider
                            const savedModel = localStorage.getItem(STORAGE_KEYS.AI_SELECTED_MODEL_PER_PROVIDER(activeAiProvider));
                            const candidate = prev === 'Unspecified' && savedModel ? savedModel : prev;
                            if (candidate === 'Unspecified') return 'Unspecified';
                            const stillAvailable = models.some(m => m.name === candidate);
                            return stillAvailable ? candidate : 'Unspecified';
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

    const handleRegionChange = async (region: string) => {
        setSelectedRegion(region);
        localStorage.setItem(STORAGE_KEYS.VERTEXAI_SELECTED_REGION, region);
        setSelectedModel('Unspecified');
        setAvailableModels([]);
        setModelLoadError(false);
        setIsLoadingModels(true);
        try {
            await electronService.aiSetLocation(region);
            const models = await electronService.aiListModels();
            if (models.length > 0) {
                setAvailableModels(models);
                // Restore last-used model for this provider if available
                const savedModel = localStorage.getItem(STORAGE_KEYS.AI_SELECTED_MODEL_PER_PROVIDER(activeAiProvider));
                if (savedModel && models.some(m => m.name === savedModel)) {
                    setSelectedModel(savedModel);
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
            // Set auth location as default region
            setSelectedRegion(vertexLocation);
            localStorage.setItem(STORAGE_KEYS.VERTEXAI_SELECTED_REGION, vertexLocation);
            await electronService.aiSetProvider('vertexai');
            await electronService.aiAuthStart({
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
            await electronService.aiSetProvider('openai');
            await electronService.aiAuthStart({ apiKey: openaiApiKey });
            return;
        }

        if (activeAiProvider === 'anthropic') {
            if (!anthropicApiKey) {
                if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current);
                setIsAuthLoading(false);
                return;
            }
            await electronService.aiSetProvider('anthropic');
            await electronService.aiAuthStart({ apiKey: anthropicApiKey });
            return;
        }

        if (!clientId || !clientSecret) {
            if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current);
            setIsAuthLoading(false);
            return;
        }
        try {
            const encId = await electronService.encryptSecret(clientId);
            const encSecret = await electronService.encryptSecret(clientSecret);
            localStorage.setItem(STORAGE_KEYS.GEMINI_CLIENT_ID, encId);
            localStorage.setItem(STORAGE_KEYS.GEMINI_CLIENT_SECRET, encSecret);
        } catch (err) {
            console.error('Failed to encrypt Gemini credentials:', err);
        }
        await electronService.aiSetProvider('gemini');
        await electronService.aiAuthStart({ clientId, clientSecret });
    };

    const handleLogout = () => {
        localStorage.setItem(STORAGE_KEYS.AI_EXPLICIT_LOGOUT, '1');
        electronService.aiAuthLogout();
        setIsAuthenticated(false);
        setMessages([]);
    };

    const handleRunCommand = (command: string) => {
        if (!lastTargetSessionId) return;

        // Strictly trim and use \r for execution (standard for terminals)
        const cleanCmd = command.trim();

        // Notify parent to start monitoring this session
        if (onRunCommand) {
            onRunCommand(lastTargetSessionId, cleanCmd);
        }

        setIsWaitingForTerminal(true);

        // Sync state back to parent
        onStateChange?.({
            messages,
            inputText,
            selectedModel,
            selectedLanguage,
            selectedExpertise,
            textareaHeight,
            scrollTop: scrollContainerRef.current?.scrollTop || 0,
            lastTargetSessionId,
            lastTargetSessionTitle,
            isWaitingForTerminal: true
        });

        // Split multi-line commands and send each line individually
        // (network devices only accept one command per line)
        const lines = cleanCmd.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const targetId = lastTargetSessionId;
        lines.forEach((line, index) => {
            setTimeout(() => {
                electronService.sendInput(targetId, line + '\r');
            }, index * 150);
        });
        electronService.focusWindow();
        window.dispatchEvent(new CustomEvent('hotty-focus-session', { detail: { sessionId: lastTargetSessionId } }));
    };
    handleRunCommandRef.current = handleRunCommand;

    const handleStopWaiting = () => {
        setIsWaitingForTerminal(false);

        // Dispatch cancel event to stop tracking in App.tsx
        if (lastTargetSessionId) {
            window.dispatchEvent(new CustomEvent('hotty-interactive-cancel', {
                detail: { sessionId: lastTargetSessionId }
            }));
        }

        onStateChange?.({
            messages,
            inputText,
            selectedModel,
            selectedLanguage,
            selectedExpertise,
            textareaHeight,
            scrollTop: scrollContainerRef.current?.scrollTop || 0,
            lastTargetSessionId,
            lastTargetSessionTitle,
            isWaitingForTerminal: false
        });
    };

    const handleSendBufferNow = () => {
        if (!interactiveSessionTracking) return;

        // Dispatch custom event to App.tsx to trigger manual completion
        window.dispatchEvent(new CustomEvent('hotty-interactive-manual-send', {
            detail: {
                sessionId: lastTargetSessionId,
                aiSessionId: sessionId
            }
        }));
    };

    const handleHoverTarget = (isHovering: boolean) => {
        if (!lastTargetSessionId) return;
        window.dispatchEvent(new CustomEvent('hotty-highlight-session', {
            detail: { sessionId: lastTargetSessionId, highlighted: isHovering }
        }));
    };

    const handleSend = () => {
        const text = inputText.trim();
        if (!text || isStreaming || selectedModel === 'Unspecified') return;

        // Reset auto-exec counter on manual user interaction
        setConsecutiveAutoExecCount(0);

        setMessages(prev => [...prev, { role: 'user', content: text }]);
        lastSentTextRef.current = text;
        setInputText('');
        setIsStreaming(true);
        setStreamingContent('');

        if (onSendMessage) {
            onSendMessage(text);
        } else {
            electronService.aiChatSend(sessionId, text, selectedModel, localSystemInstruction);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleClearChat = () => {
        setMessages([]);
        setStreamingContent('');
        setTotalInputTokens(0);
        setTotalOutputTokens(0);
        setTotalCost(null);
        electronService.aiChatClear(sessionId);
    };


    const handleCancel = () => {
        electronService.aiChatCancel(sessionId);
        if (streamingContent) {
            setMessages(prev => [...prev, { role: 'model', content: streamingContent + ' [cancelled]' }]);
        }
        setStreamingContent('');
        setIsStreaming(false);
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
        <div className="ai-chat-pane" style={{ fontSize: `${fontSize}px`, backgroundColor: effectiveBg }}>
            {modelLoadError && (
                <MessageModal
                    type="error"
                    title="Model List Unavailable"
                    message="Failed to retrieve the AI model list. Please check your authentication and network connection, then try reconnecting."
                    onClose={() => setModelLoadError(false)}
                />
            )}
            <div className="ai-chat-header">
                <div className="ai-chat-header-left">
                    <div className="ai-chat-logo">
                        <GeminiIcon size={24} />
                    </div>
                </div>
                <div className="ai-chat-header-right">
                    {isAuthenticated && (
                        <>
                            <div className="ai-chat-header-item">
                                <svg className="ai-chat-header-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <title>Persona</title>
                                    <path d="M22 10L12 5L2 10L12 15L22 10Z" />
                                    <path d="M6 12V17C8.5 19.5 15.5 19.5 18 17V12" />
                                </svg>
                                <select
                                    className="ai-chat-model-select"
                                    style={{ width: '140px' }}
                                    value={selectedExpertise}
                                    onChange={(e) => {
                                        setSelectedExpertise(e.target.value);
                                        const persona = aiPersonas?.find(p => p.label === e.target.value);
                                        if (persona) {
                                            const langInstr = selectedLanguage !== 'English' ? ` Answer in ${selectedLanguage}.` : '';
                                            setLocalSystemInstruction(`${persona.systemPrompt}${langInstr}${buildExecutionRules()}`);
                                            // Sync global active persona for context menus
                                            useSettingsStore.getState().updateActivePersonaId(persona.id);
                                        }
                                    }}
                                    disabled={isStreaming}
                                >
                                    {aiPersonas?.map(persona => (
                                        <option key={persona.id} value={persona.label}>{persona.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="ai-chat-header-item">
                                <svg className="ai-chat-header-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <title>Language</title>
                                    <circle cx="12" cy="12" r="10" />
                                    <line x1="2" y1="12" x2="22" y2="12" />
                                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                                </svg>
                                <select
                                    className="ai-chat-model-select"
                                    style={{ width: '100px' }}
                                    value={selectedLanguage}
                                    onChange={(e) => {
                                        const lang = e.target.value;
                                        setSelectedLanguage(lang);
                                        localStorage.setItem(STORAGE_KEYS.GEMINI_LANGUAGE, lang);
                                    }}
                                    disabled={isStreaming}
                                >
                                    {['Auto', 'English', 'Japanese', 'Chinese', 'Korean', 'Spanish', 'French', 'German', 'Russian'].map(lang => (
                                        <option key={lang} value={lang}>{lang}</option>
                                    ))}
                                </select>
                            </div>
                            {activeAiProvider === 'vertexai' && (
                                <div className="ai-chat-header-item">
                                    <svg className="ai-chat-header-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <title>Region</title>
                                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                                        <circle cx="12" cy="10" r="3" />
                                    </svg>
                                    <select
                                        className="ai-chat-model-select"
                                        style={{ width: '130px' }}
                                        value={selectedRegion}
                                        onChange={(e) => handleRegionChange(e.target.value)}
                                        disabled={isStreaming || isLoadingModels}
                                    >
                                        {(availableRegions.length > 0
                                            ? availableRegions
                                            : [selectedRegion]
                                        ).map(r => (
                                            <option key={r} value={r}>{r}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            <div className="ai-chat-header-item">
                                <select
                                    className="ai-chat-model-select"
                                    style={{ width: '150px' }}
                                    value={selectedModel}
                                    onChange={(e) => {
                                        const model = e.target.value;
                                        setSelectedModel(model);
                                        localStorage.setItem(STORAGE_KEYS.AI_SELECTED_MODEL, model);
                                        localStorage.setItem(STORAGE_KEYS.AI_SELECTED_MODEL_PER_PROVIDER(activeAiProvider), model);
                                    }}
                                    disabled={isStreaming || isLoadingModels}
                                >
                                    {selectedModel === 'Unspecified' && <option value="Unspecified">{isLoadingModels ? 'Loading...' : 'Select a model...'}</option>}
                                    {availableModels && availableModels.map(m => (
                                        <option key={m.name} value={m.name}>{m.displayName}</option>
                                    ))}
                                </select>
                            </div>
                            <button
                                className={`ai-chat-header-btn ai-chat-autoexec-toggle${commandExecutionMode === 'auto-execute-safe' ? ' active' : ''}`}
                                onClick={() => {
                                    const next = commandExecutionMode === 'ask-before-execute' ? 'auto-execute-safe' : 'ask-before-execute';
                                    useSettingsStore.getState().updateCommandExecutionMode(next);
                                }}
                                title={commandExecutionMode === 'auto-execute-safe' ? 'Auto-execute: ON — Safe commands run automatically' : 'Auto-execute: OFF — All commands require confirmation'}
                            >
                                <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                                    <path d="M7 2v11h3v9l7-12h-4l4-8z"/>
                                </svg>
                            </button>
                            <button className="ai-chat-header-btn ai-chat-header-btn--danger" onClick={handleClearChat} title="Clear chat context">
                                <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                                    <path d="M9 3v1H4v2h1v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6h1V4h-5V3H9zm0 5h2v9H9V8zm4 0h2v9h-2V8z"/>
                                </svg>
                            </button>
                            <button className="ai-chat-header-btn" onClick={handleLogout} title="Logout">
                                <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                                    <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
                                </svg>
                            </button>
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
                        fontSize={fontSize}
                        terminalBackground={terminalBackground}
                    />
                )
            ) : (
                <div className="ai-chat-body">
                    {showSystemPrompt && localSystemInstruction && (
                        <div className="ai-chat-message-system" style={{ padding: '10px', backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', fontSize: 'calc(var(--font-size-base) - 2px)', color: 'var(--text-secondary)', maxHeight: '100px', overflowY: 'auto' }}>
                            <div style={{ whiteSpace: 'pre-wrap' }}>{localSystemInstruction}</div>
                        </div>
                    )}
                    <div className="ai-chat-messages" ref={scrollContainerRef} onScroll={handleScroll}>
                        {messages.map((msg, idx) => (
                            <div key={idx} className={`ai-chat-message ai-chat-message-${msg.role}`}>
                                <div className="ai-chat-message-avatar">
                                    {msg.role === 'user' ? '👤' : <GeminiIcon size={18} />}
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
                                    ) : (
                                        <pre>{msg.content}</pre>
                                    )}
                                </div>
                            </div>
                        ))}
                        {streamingContent && (
                            <div className="ai-chat-message ai-chat-message-model">
                                <div className="ai-chat-message-avatar"><GeminiIcon size={18} /></div>
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
                                <div className="ai-chat-message-avatar"><GeminiIcon size={18} /></div>
                                <div className="ai-chat-message-content">Thinking...</div>
                            </div>
                        )}
                        {isWaitingForTerminal && (
                            <div className="ai-chat-message ai-chat-message-model">
                                <div className="ai-chat-message-avatar">⚡</div>
                                <div className="ai-chat-message-content waiting-feedback">
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                                            <span>Waiting for terminal response from <b>{lastTargetSessionTitle}</b>...</span>
                                            <button
                                                className="run-command-btn"
                                                onClick={handleStopWaiting}
                                                style={{ padding: '2px 8px', fontSize: 'calc(var(--font-size-base) - 3px)', opacity: 0.8 }}
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                        {interactiveSessionTracking && (
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                                                <div style={{ fontSize: 'calc(var(--font-size-base) - 4px)', opacity: 0.6, display: 'flex', gap: '12px' }}>
                                                    <span>Elapsed: {Math.floor((Date.now() - interactiveSessionTracking.startTime) / 1000)}s</span>
                                                    <span>Data: {new Intl.NumberFormat().format(interactiveSessionTracking.buffer.length)} bytes</span>
                                                </div>
                                                <button
                                                    className="run-command-btn"
                                                    onClick={handleSendBufferNow}
                                                    style={{ padding: '0px 6px', fontSize: 'calc(var(--font-size-base) - 4px)', height: '20px' }}
                                                    title="Send current output to AI immediately"
                                                >
                                                    Send Now
                                                </button>
                                            </div>
                                        )}
                                    </div>
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
                            placeholder="Type a message..."
                            disabled={isStreaming}
                        />
                        <button className="ai-chat-prompt-btn" onClick={onShowPromptMenu} title="Analysis prompts">✨</button>
                        {isStreaming && <button className="ai-chat-cancel-btn" onClick={handleCancel}>■</button>}
                        <button className="ai-chat-send-btn" onClick={handleSend} disabled={!inputText.trim() || isStreaming || selectedModel === 'Unspecified'}>➤</button>
                    </div>
                    {(totalInputTokens > 0 || totalOutputTokens > 0) && (
                        <div className="ai-token-status">
                            <span>{totalInputTokens.toLocaleString()} in / {totalOutputTokens.toLocaleString()} out tokens</span>
                            {totalCost !== null && (
                                <>
                                    <span className="ai-token-status-sep">·</span>
                                    <span>~${totalCost.toFixed(4)}</span>
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div >
    );
});

export default AIChatPane;
