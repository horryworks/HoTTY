import React, { useState, useEffect, useRef } from 'react';
import { marked } from 'marked';
import { getTransparentColor } from '../../utils/colorUtils';
import { sanitizeHtml } from '../../utils/htmlUtils';
import { classifyCommand } from '../../utils/commandClassifier';
import { STORAGE_KEYS } from '../../constants/storage';
import { calcAICost } from '../../constants/aiPricing';
import { buildExecutionRules } from '../../constants/aiPrompts';
import { AuthenticationPanel } from './AuthenticationPanel';
import { VertexAIAuthPanel } from './VertexAIAuthPanel';
import { OpenAIAuthPanel } from './OpenAIAuthPanel';
import { AnthropicAuthPanel } from './AnthropicAuthPanel';
import { SystemPromptModal } from '../SystemPromptModal/SystemPromptModal';
import { useSettingsStore } from '../../stores/settingsStore';
import { tauriService } from '../../services/tauriService';
import type { AiChatState } from '../../hooks/useAiChat';
import type { PersonaDefinition, AIModelInfo } from '../../types/appTypes';
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
    onRunCommand?: (sessionId: string, command: string) => void;
    onShowPromptMenu?: () => void;
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
                <stop stopColor="#4E77FF" />
                <stop offset="0.5" stopColor="#A87FF4" />
                <stop offset="1" stopColor="#FF76AB" />
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
    onRunCommand,
    onShowPromptMenu,
    onSendMessage,
    aiPersonas,
    terminalBackground,
}) => {
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

    // OpenAI auth state
    const [openaiApiKey, setOpenaiApiKey] = useState('');
    // Anthropic auth state
    const [anthropicApiKey, setAnthropicApiKey] = useState('');

    // Chat state
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [inputText, setInputText] = useState('');
    const [selectedModel, setSelectedModel] = useState(chatState?.selectedModel || 'Unspecified');
    const selectedModelRef = useRef(selectedModel);
    selectedModelRef.current = selectedModel;
    const [selectedLanguage, setSelectedLanguage] = useState(() => localStorage.getItem(STORAGE_KEYS.GEMINI_LANGUAGE) || 'English');
    const defaultExpertise = aiPersonas?.[0]?.label || 'General Assistant';
    const [selectedExpertise, setSelectedExpertise] = useState(chatState?.selectedExpertise || defaultExpertise);
    const [textareaHeight, setTextareaHeight] = useState(0);
    const [localSystemInstruction, setLocalSystemInstruction] = useState(chatState?.systemInstruction || 'You are a helpful assistant.');
    const [showPromptModal, setShowPromptModal] = useState(false);

    // Target session info from parent state
    const lastTargetSessionId = chatState?.lastTargetSessionId;
    const lastTargetSessionTitle = chatState?.lastTargetSessionTitle;

    // Pending message from parent state
    const [localPendingMessage, setLocalPendingMessage] = useState<string | undefined>(chatState?.pendingMessage);
    const processedPendingMessageRef = useRef<string | undefined>(undefined);

    // Streaming state
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamingContent, setStreamingContent] = useState('');
    const [totalInputTokens, setTotalInputTokens] = useState(0);
    const [totalOutputTokens, setTotalOutputTokens] = useState(0);
    const [totalCost, setTotalCost] = useState<number | null>(null);

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
            setMessages([]);
            setStreamingContent('');
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
                console.error('Failed to auto-auth:', err);
                setIsAuthLoading(false);
            }
        };
        load();
    }, [activeAiProvider]);

    // ── Sync pending message from parent ──
    useEffect(() => {
        if (chatState?.pendingMessage !== undefined && chatState.pendingMessage !== processedPendingMessageRef.current) {
            setLocalPendingMessage(chatState.pendingMessage);
        }
    }, [chatState?.pendingMessage]);

    // ── Real-time System Prompt Update ──
    useEffect(() => {
        const selectedPersona = aiPersonas?.find(p => p.label === selectedExpertise);
        const basePrompt = selectedPersona?.systemPrompt || aiPersonas?.[0]?.systemPrompt || 'You are a helpful assistant.';
        const extraInstructions = buildExecutionRules();
        const langInstruction = selectedLanguage !== 'English' ? ` You MUST answer in ${selectedLanguage}.` : '';
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

    // ── Auto-send pending message if authenticated ──
    useEffect(() => {
        if (isAuthenticated && localPendingMessage && !isStreaming) {
            const text = localPendingMessage;
            const sysInstr = chatState?.systemInstruction || localSystemInstruction;

            setLocalPendingMessage(undefined);
            processedPendingMessageRef.current = text;

            // Clear pendingMessage in parent state
            onChatStateChange?.({ pendingMessage: undefined, systemInstruction: sysInstr });

            if (selectedModel === 'Unspecified') {
                setMessages(prev => [
                    ...prev,
                    { role: 'user', content: text },
                    { role: 'model', content: 'AI model not selected. Please select a model from the dropdown at the top right of the screen.' },
                ]);
                return;
            }

            setMessages(prev => [...prev, { role: 'user', content: text }]);
            lastSentTextRef.current = text;
            setIsStreaming(true);
            setStreamingContent('');
            tauriService.aiChatSend(paneId, text, selectedModel, sysInstr);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated, localPendingMessage, isStreaming, paneId, selectedModel]);

    // ��─ Listen for chat response events ──
    useEffect(() => {
        let cancelled = false;
        let unlisten: (() => void) | undefined;

        tauriService.onAiChatResponse((data) => {
            if (cancelled) return;
            if (data.sessionId !== paneId) return;

            if (data.responseType === 'chunk') {
                setStreamingContent(prev => prev + data.content);
            } else if (data.responseType === 'done') {
                setMessages(prev => [...prev, { role: 'model', content: data.content }]);
                setStreamingContent('');
                setIsStreaming(false);
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
                setMessages(prev => [...prev, { role: 'model', content: `Error: ${data.content}` }]);
                setStreamingContent('');
                setIsStreaming(false);
            }
        }).then(fn => {
            if (cancelled) { fn(); } else { unlisten = fn; }
        }).catch(console.error);

        return () => { cancelled = true; unlisten?.(); };
    }, [paneId]);

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
        }).catch(console.error);

        return () => { cancelled = true; unlisten?.(); };
    }, []);

    // ── Auto-execute safe commands ──
    const handleRunCommandRef = useRef<(cmd: string) => void>(() => {});
    const prevIsStreamingRef = useRef(isStreaming);
    useEffect(() => {
        const wasStreaming = prevIsStreamingRef.current;
        prevIsStreamingRef.current = isStreaming;

        if (wasStreaming && !isStreaming && commandExecutionMode === 'auto-execute-safe') {
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
    }, [isStreaming, messages, commandExecutionMode, lastTargetSessionId, customSafeCommands, maxConsecutiveAutoExecutions, consecutiveAutoExecCount]);

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
            console.error('Failed to encrypt Gemini credentials:', err);
        }
        await tauriService.aiSetProvider('gemini');
        await tauriService.aiAuthStart({ clientId, clientSecret });
    };

    const handleLogout = () => {
        localStorage.setItem(STORAGE_KEYS.AI_EXPLICIT_LOGOUT, '1');
        tauriService.aiAuthLogout().catch(() => {});
        setIsAuthenticated(false);
        setMessages([]);
    };

    const handleRunCommand = (command: string) => {
        if (!lastTargetSessionId) return;
        const cleanCmd = command.trim();
        onRunCommand?.(lastTargetSessionId, cleanCmd);
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
        setIsStreaming(true);
        setStreamingContent('');

        if (onSendMessage) {
            onSendMessage(text);
        } else {
            tauriService.aiChatSend(paneId, text, selectedModel, localSystemInstruction);
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
        tauriService.aiChatClear(paneId).catch(() => {});
    };

    const handleCancel = () => {
        tauriService.aiChatCancel(paneId).catch(() => {});
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
        <div className="ai-chat-pane" style={{ backgroundColor: effectiveBg }}>
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
                                    onChange={(e) => setSelectedExpertise(e.target.value)}
                                    disabled={isStreaming}
                                >
                                    {aiPersonas?.map(persona => (
                                        <option key={persona.id} value={persona.label}>{persona.label}</option>
                                    ))}
                                </select>
                                <button
                                    type="button"
                                    className="ai-chat-header-icon-btn"
                                    title="View system prompt"
                                    aria-label="View system prompt"
                                    onClick={() => setShowPromptModal(true)}
                                >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                                        <circle cx="12" cy="12" r="10" />
                                        <line x1="12" y1="16" x2="12" y2="12" />
                                        <line x1="12" y1="8" x2="12.01" y2="8" />
                                    </svg>
                                </button>
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
                            <button
                                className={`ai-chat-header-btn ai-chat-autoexec-toggle${commandExecutionMode === 'auto-execute-safe' ? ' active' : ''}`}
                                onClick={() => {
                                    const next = commandExecutionMode === 'ask-before-execute' ? 'auto-execute-safe' : 'ask-before-execute';
                                    useSettingsStore.getState().update('commandExecutionMode', next);
                                }}
                                title={commandExecutionMode === 'auto-execute-safe' ? 'Auto-execute: ON' : 'Auto-execute: OFF'}
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
                    />
                )
            ) : (
                <div className="ai-chat-body">
                    <div className="ai-chat-messages" ref={scrollContainerRef}>
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
                                    ) : (
                                        <pre>{msg.content}</pre>
                                    )}
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
                                <div className="ai-chat-message-content">Thinking...</div>
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
                        <button className="ai-chat-prompt-btn" onClick={onShowPromptMenu} title="Analysis prompts">&#x2728;</button>
                        {isStreaming && <button className="ai-chat-cancel-btn" onClick={handleCancel}>&#x25A0;</button>}
                        <button className="ai-chat-send-btn" onClick={handleSend} disabled={!inputText.trim() || isStreaming || selectedModel === 'Unspecified'}>&#x27A4;</button>
                    </div>
                    {(totalInputTokens > 0 || totalOutputTokens > 0) && (
                        <div className="ai-token-status">
                            <span>{totalInputTokens.toLocaleString()} in / {totalOutputTokens.toLocaleString()} out tokens</span>
                            {totalCost !== null && (
                                <>
                                    <span className="ai-token-status-sep">&middot;</span>
                                    <span>~${totalCost.toFixed(4)}</span>
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
        </div>
    );
});

export default AIChatPane;
