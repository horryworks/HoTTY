import React, { useState, useEffect, useRef } from 'react';
import { marked } from 'marked';
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
    }) => void;
    showSystemPrompt: boolean;
    askGeminiCommands: { id: string; label: string; promptTemplate: string }[];
    aiPersonas: { id: string; label: string; systemPrompt: string }[];
    fontSize?: number;
    isActive?: boolean;
    terminalBackground?: string;
    terminalBackgroundInactive?: string;
}

export const AIChatPane: React.FC<AIChatPaneProps> = ({
    sessionId,
    initialState,
    onStateChange,
    showSystemPrompt,
    aiPersonas,
    fontSize,
    terminalBackground
}) => {
    // Auth state
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isAuthLoading, setIsAuthLoading] = useState(false);
    const [clientId, setClientId] = useState<string>('');
    const [clientSecret, setClientSecret] = useState<string>('');

    // Load encrypted credentials and attempt auto-auth on mount
    useEffect(() => {
        const load = async () => {
            try {
                const encId = localStorage.getItem('hotty_gemini_client_id') || '';
                const encSecret = localStorage.getItem('hotty_gemini_client_secret') || '';

                let decryptedId = '';
                let decryptedSecret = '';

                if (encId) {
                    decryptedId = await window.electronAPI.decryptSecret(encId);
                    setClientId(decryptedId);
                }
                if (encSecret) {
                    decryptedSecret = await window.electronAPI.decryptSecret(encSecret);
                    setClientSecret(decryptedSecret);
                }

                // Attempt auto background auth if both are present
                if (decryptedId && decryptedSecret) {
                    setIsAuthLoading(true);
                    const success = await window.electronAPI.geminiAuthAuto(decryptedId, decryptedSecret);
                    setIsAuthenticated(success);
                    setIsAuthLoading(false);
                }
            } catch (err) {
                console.error('Failed to decrypt Gemini credentials or auto-auth:', err);
                setIsAuthLoading(false);
            }
        };
        load();
    }, []);

    // Chat state - initialize from props if available
    const [messages, setMessages] = useState<ChatMessage[]>(initialState?.messages || []);
    const [inputText, setInputText] = useState(initialState?.inputText || '');
    const [selectedModel, setSelectedModel] = useState(initialState?.selectedModel || 'Unspecified');
    const [selectedLanguage, setSelectedLanguage] = useState(initialState?.selectedLanguage || 'English');
    const [selectedExpertise, setSelectedExpertise] = useState(initialState?.selectedExpertise || 'General Helper');
    const [textareaHeight, setTextareaHeight] = useState(initialState?.textareaHeight || 0);
    const [localSystemInstruction, setLocalSystemInstruction] = useState(initialState?.systemInstruction || 'You are a helpful assistant.');

    // Manage pending message locally to avoid sync race conditions
    const [localPendingMessage, setLocalPendingMessage] = useState(initialState?.pendingMessage);

    // Sync pending message from props if it arrives later or changes
    useEffect(() => {
        if (initialState?.pendingMessage) {
            setLocalPendingMessage(initialState.pendingMessage);
        }
    }, [initialState?.pendingMessage]);

    const [isStreaming, setIsStreaming] = useState(false);
    const [streamingContent, setStreamingContent] = useState('');

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const lastSentTextRef = useRef<string>('');
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

        setLocalSystemInstruction(`${basePrompt}${langInstruction}`);

    }, [selectedExpertise, selectedLanguage, aiPersonas]);


    // Initialize scroll position
    useEffect(() => {
        if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
        }
    }, [messages]);
    // Run once on mount

    // Auto-send pending message if authenticated
    useEffect(() => {
        if (isAuthenticated && localPendingMessage && !isStreaming) {
            window.electronAPI.logDebug(`[AIChatPane] Detecting pending message. Auth: ${isAuthenticated}, Streaming: ${isStreaming}`);
            const text = localPendingMessage;
            // Use the passed system instruction for the FIRST message if provided, otherwise use local
            const sysInstr = initialState?.systemInstruction || localSystemInstruction;

            window.electronAPI.logDebug(`[AIChatPane] Sending pending message: ${text.substring(0, 30)}...`);

            // Clear local pending message immediately to prevent re-sending
            setLocalPendingMessage(undefined);

            if (selectedModel === 'Unspecified') {
                setMessages(prev => [
                    ...prev,
                    { role: 'user', content: text },
                    { role: 'model', content: '⚠️ AI model not selected. Please select a model from the dropdown at the top right of the screen.' }
                ]);
                return;
            }

            // Sync local system instruction if one was provided in payload
            if (initialState?.systemInstruction) {
                setLocalSystemInstruction(initialState.systemInstruction);
            }

            // Send message
            setMessages(prev => [...prev, { role: 'user', content: text }]);
            lastSentTextRef.current = text;
            setIsStreaming(true);
            setStreamingContent('');
            window.electronAPI.geminiChatSend(sessionId, text, selectedModel, sysInstr);
        } else if (localPendingMessage) {
            window.electronAPI.logDebug(`[AIChatPane] Pending message skipped. Auth: ${isAuthenticated}, Streaming: ${isStreaming}`);
        }
    }, [isAuthenticated, localPendingMessage, isStreaming, sessionId, selectedModel, initialState?.systemInstruction, localSystemInstruction]);


    // Keep ref to onStateChange to avoid effect re-triggering when parent re-renders
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
                pendingMessage: localPendingMessage, // Sync local pending msg (preserves it on mount)
                systemInstruction: localSystemInstruction
            });
        }
    }, [messages, inputText, selectedModel, selectedLanguage, selectedExpertise, textareaHeight, localSystemInstruction, localPendingMessage]);

    // Check auth status on mount
    useEffect(() => {
        window.electronAPI.geminiAuthStatus().then(setIsAuthenticated);
    }, []);

    // Listen for chat responses for THIS session
    useEffect(() => {
        const removeListener = window.electronAPI.onGeminiChatResponse((data) => {
            if (data.sessionId !== sessionId) return;

            if (data.type === 'chunk') {
                setStreamingContent(prev => prev + data.content);
            } else if (data.type === 'done') {
                setMessages(prev => [...prev, { role: 'model', content: data.content }]);
                setStreamingContent('');
                setIsStreaming(false);
            } else if (data.type === 'error') {
                setMessages(prev => [...prev, { role: 'model', content: `⚠️ ${data.content}` }]);
                setStreamingContent('');
                setIsStreaming(false);
            }
        });
        return () => removeListener();
    }, [sessionId]);

    const authTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Listen for auth result
    useEffect(() => {
        const removeListener = window.electronAPI.onGeminiAuthResult((result) => {
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

    // Auto-scroll to bottom
    useEffect(() => {
        if (scrollContainerRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
            const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
            if (isNearBottom || isStreaming) {
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }
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
                scrollTop: scrollContainerRef.current.scrollTop
            });
        }
    };

    const [authError, setAuthError] = useState<string | null>(null);
    const [availableModels, setAvailableModels] = useState<{ name: string; displayName: string }[]>([]);

    // Fetch models on auth
    useEffect(() => {
        if (isAuthenticated) {
            window.electronAPI.geminiListModels().then(models => {
                if (models.length > 0) {
                    setAvailableModels(models);
                }
            });
        }
    }, [isAuthenticated]);

    const handleLogin = async () => {
        if (!clientId || !clientSecret) return;
        // Encrypt credentials before persisting
        try {
            const encId = await window.electronAPI.encryptSecret(clientId);
            const encSecret = await window.electronAPI.encryptSecret(clientSecret);
            localStorage.setItem('hotty_gemini_client_id', encId);
            localStorage.setItem('hotty_gemini_client_secret', encSecret);
        } catch (err) {
            console.error('Failed to encrypt Gemini credentials:', err);
        }
        setIsAuthLoading(true);
        setAuthError(null);

        // 30 second timeout
        authTimeoutRef.current = setTimeout(() => {
            setIsAuthLoading(false);
            setAuthError('Authentication timed out. Please try again.');
            authTimeoutRef.current = null;
        }, 30000);

        await window.electronAPI.geminiAuthStart(clientId, clientSecret);
    };

    const handleLogout = () => {
        window.electronAPI.geminiAuthLogout();
        setIsAuthenticated(false);
        setMessages([]);
    };

    const handleSend = () => {
        const text = inputText.trim();
        if (!text || isStreaming || selectedModel === 'Unspecified') return;

        setMessages(prev => [...prev, { role: 'user', content: text }]);
        lastSentTextRef.current = text;
        setInputText('');
        setIsStreaming(true);
        setStreamingContent('');
        window.electronAPI.geminiChatSend(sessionId, text, selectedModel, localSystemInstruction);
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
        window.electronAPI.geminiChatClear(sessionId);
    };

    const handleCancel = () => {
        window.electronAPI.geminiChatCancel(sessionId);
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

    const LANGUAGES = [
        'Auto', 'English', 'Japanese', 'Chinese', 'Korean', 'Spanish', 'French', 'German', 'Russian'
    ];

    const GeminiIcon = ({ size = 20 }: { size?: number }) => (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="gemini-svg-icon">
            <path d="M13.5 3.5C14.3 6.9 16.9 9.5 20.3 10.5C21.9 10.9 21.9 13.1 20.3 13.5C16.9 14.5 14.3 17.1 13.5 20.5C13.1 22.1 10.9 22.1 10.5 20.5C9.7 17.1 7.1 14.5 3.7 13.5C2.1 13.1 2.1 10.9 3.7 10.5C7.1 9.5 9.7 6.9 10.5 3.5C10.9 1.9 13.1 1.9 13.5 3.5Z" fill="url(#gemini-pane-gradient)" />
            <defs>
                <linearGradient id="gemini-pane-gradient" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#4E86F8" />
                    <stop offset="100%" stopColor="#D64669" />
                </linearGradient>
            </defs>
        </svg>
    );

    const getTransparentColor = (hex: string) => {
        if (hex.startsWith('#') && hex.length === 7) {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return `rgba(${r}, ${g}, ${b}, 0.85)`;
        }
        return hex;
    };

    const effectiveBg = getTransparentColor(terminalBackground || '#1e1e1e');

    return (
        <div className="ai-chat-pane" style={{ fontSize: `${fontSize}px`, backgroundColor: effectiveBg }}>
            {/* Header */}
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
                                            setLocalSystemInstruction(persona.systemPrompt + (selectedLanguage !== 'English' ? ` Answer in ${selectedLanguage}.` : ''));
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
                                        localStorage.setItem('hotty_gemini_language', lang);
                                    }}
                                    disabled={isStreaming}
                                >
                                    {LANGUAGES.map(lang => (
                                        <option key={lang} value={lang}>{lang}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="ai-chat-header-item">
                                <svg className="ai-chat-header-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <title>AI Model</title>
                                    <rect x="4" y="4" width="16" height="16" rx="2" />
                                    <rect x="9" y="9" width="6" height="6" />
                                    <line x1="9" y1="1" x2="9" y2="4" />
                                    <line x1="15" y1="1" x2="15" y2="4" />
                                    <line x1="9" y1="20" x2="9" y2="23" />
                                    <line x1="15" y1="20" x2="15" y2="23" />
                                    <line x1="20" y1="9" x2="23" y2="9" />
                                    <line x1="20" y1="15" x2="23" y2="15" />
                                    <line x1="1" y1="9" x2="4" y2="9" />
                                    <line x1="1" y1="15" x2="4" y2="15" />
                                </svg>
                                <select
                                    className="ai-chat-model-select"
                                    style={{ width: '150px' }}
                                    value={selectedModel}
                                    onChange={(e) => {
                                        const model = e.target.value;
                                        setSelectedModel(model);
                                        localStorage.setItem('hotty_gemini_model', model);
                                    }}
                                    disabled={isStreaming}
                                >
                                    {selectedModel === 'Unspecified' && (
                                        <option value="Unspecified">Select a model...</option>
                                    )}
                                    {availableModels.length > 0 ? (
                                        availableModels.map(m => (
                                            <option key={m.name} value={m.name}>{m.displayName}</option>
                                        ))
                                    ) : (
                                        <>
                                            <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                                            <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                                            <option value="gemini-3.0-flash-preview">Gemini 3 Flash Preview</option>
                                            <option value="gemini-3.0-pro-preview">Gemini 3 Pro Preview</option>
                                        </>
                                    )}
                                </select>
                            </div>
                            <button className="ai-chat-header-btn" onClick={handleClearChat} title="Clear chat history">
                                🗑️
                            </button>
                            <button className="ai-chat-header-btn" onClick={handleLogout} title="Logout">
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style={{ display: 'block', transform: 'translateY(1px)' }}>
                                    <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
                                </svg>
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Content */}
            {!isAuthenticated ? (
                <div className="ai-chat-auth-container">
                    <div className="ai-chat-auth-card">
                        <div className="ai-chat-auth-icon">
                            <GeminiIcon size={64} />
                        </div>
                        <h2>Connect to Gemini</h2>
                        <p className="ai-chat-auth-desc">
                            Enter your OAuth 2.0 Client ID from the{' '}
                            <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="ai-chat-link">
                                Google Cloud Console
                            </a>
                            .
                        </p>
                        <div className="ai-chat-auth-form">
                            <label>Client ID</label>
                            <input
                                type="text"
                                value={clientId}
                                onChange={(e) => setClientId(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                                placeholder="xxxxxxxxxx.apps.googleusercontent.com"
                                className="ai-chat-input"
                            />
                            <label>Client Secret</label>
                            <input
                                type="password"
                                value={clientSecret}
                                onChange={(e) => setClientSecret(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                                placeholder="GOCSPX-xxxxxxxx"
                                className="ai-chat-input"
                            />
                            <button
                                className="ai-chat-login-btn"
                                onClick={handleLogin}
                                disabled={!clientId || !clientSecret || isAuthLoading}
                            >
                                {isAuthLoading ? (
                                    <span className="ai-chat-spinner">⟳</span>
                                ) : (
                                    <>
                                        <svg viewBox="0 0 24 24" width="18" height="18" className="google-icon">
                                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                                        </svg>
                                        Sign in with Google
                                    </>
                                )}
                            </button>
                            {authError && (
                                <div className="ai-chat-auth-error">{authError}</div>
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="ai-chat-body">
                    {/* Messages */}
                    {showSystemPrompt && localSystemInstruction && (
                        <div className="ai-chat-message-system" style={{
                            padding: '10px',
                            backgroundColor: 'var(--bg-secondary)',
                            borderBottom: '1px solid var(--border-color)',
                            fontSize: '0.85rem',
                            color: 'var(--text-secondary)',
                            maxHeight: '100px',
                            overflowY: 'auto',
                            flexShrink: 0
                        }}>
                            <div style={{ whiteSpace: 'pre-wrap' }}>
                                {localSystemInstruction}
                            </div>
                        </div>
                    )}
                    {/* Messages */}
                    <div
                        className="ai-chat-messages"
                        ref={scrollContainerRef}
                        onScroll={handleScroll}
                    >
                        {messages.map((msg, idx) => (
                            <div key={idx} className={`ai-chat-message ai-chat-message-${msg.role}`}>
                                <div className="ai-chat-message-avatar">
                                    {msg.role === 'user' ? '👤' : <GeminiIcon size={18} />}
                                </div>
                                {msg.role === 'model' ? (
                                    <div className="ai-chat-message-content ai-chat-markdown"
                                        dangerouslySetInnerHTML={{ __html: marked.parse(msg.content, { async: false }) as string }}
                                    />
                                ) : (
                                    <div className="ai-chat-message-content">
                                        <pre>{msg.content}</pre>
                                    </div>
                                )}
                            </div>
                        ))}
                        {streamingContent && (
                            <div className="ai-chat-message ai-chat-message-model">
                                <div className="ai-chat-message-avatar">
                                    <GeminiIcon size={18} />
                                </div>
                                <div className="ai-chat-message-content ai-chat-markdown streaming"
                                    dangerouslySetInnerHTML={{ __html: marked.parse(streamingContent, { async: false }) as string }}
                                />
                            </div>
                        )}
                        {isStreaming && !streamingContent && (
                            <div className="ai-chat-message ai-chat-message-model">
                                <div className="ai-chat-message-avatar">
                                    <GeminiIcon size={18} />
                                </div>
                                <div className="ai-chat-message-content">
                                    <span className="ai-chat-thinking-spinner">⟳</span> Thinking...
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Resize Handle */}
                    <div
                        className="ai-chat-resize-handle"
                        onMouseDown={(e) => {
                            e.preventDefault();
                            const startY = e.clientY;
                            const startHeight = textareaHeight > 0 ? textareaHeight : (textareaRef.current?.offsetHeight || 40);
                            const onMouseMove = (ev: MouseEvent) => {
                                const delta = startY - ev.clientY;
                                const newHeight = Math.min(500, Math.max(20, startHeight + delta));
                                setTextareaHeight(newHeight);
                            };
                            const onMouseUp = () => {
                                document.removeEventListener('mousemove', onMouseMove);
                                document.removeEventListener('mouseup', onMouseUp);
                            };
                            document.addEventListener('mousemove', onMouseMove);
                            document.addEventListener('mouseup', onMouseUp);
                        }}
                    />

                    {/* Input */}
                    <div className="ai-chat-input-area">
                        <textarea
                            ref={textareaRef}
                            className="ai-chat-textarea"
                            rows={1}
                            style={{ height: textareaHeight > 0 ? `${textareaHeight}px` : 'auto' }}
                            value={inputText}
                            onChange={(e) => setInputText(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Type a message... (Shift+Enter for new line)"
                            disabled={isStreaming}
                        />
                        {isStreaming && (
                            <button
                                className="ai-chat-cancel-btn"
                                onClick={handleCancel}
                                title="Cancel"
                            >
                                ■
                            </button>
                        )}
                        <button
                            className="ai-chat-send-btn"
                            onClick={handleSend}
                            disabled={!inputText.trim() || isStreaming || selectedModel === 'Unspecified'}
                            title={selectedModel === 'Unspecified' ? 'Please select an AI model first' : 'Send'}
                        >
                            ➤
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
