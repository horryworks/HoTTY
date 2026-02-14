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
    showSystemPrompt?: boolean;
    fontSize?: number;
}

export const AIChatPane: React.FC<AIChatPaneProps> = ({ sessionId, initialState, onStateChange, showSystemPrompt, fontSize = 14 }) => {
    // Auth state
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isAuthLoading, setIsAuthLoading] = useState(false);
    const [clientId, setClientId] = useState<string>(() =>
        localStorage.getItem('hotty_gemini_client_id') || ''
    );
    const [clientSecret, setClientSecret] = useState<string>(() =>
        localStorage.getItem('hotty_gemini_client_secret') || ''
    );

    // Chat state - initialize from props if available
    const [messages, setMessages] = useState<ChatMessage[]>(initialState?.messages || []);
    const [inputText, setInputText] = useState(initialState?.inputText || '');
    const [selectedModel, setSelectedModel] = useState(initialState?.selectedModel || 'Unspecified');
    const [selectedLanguage, setSelectedLanguage] = useState(initialState?.selectedLanguage || 'English');
    const [selectedExpertise, setSelectedExpertise] = useState(initialState?.selectedExpertise || 'General Helper');
    const [textareaHeight, setTextareaHeight] = useState(initialState?.textareaHeight || 60);
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

    const EXPERTISE_OPTIONS = [
        'General Helper',
        'Network Expert',
        'Server Expert',
        'Cloud Expert',
        'Coding Expert'
    ];

    // Real-time System Prompt Update
    useEffect(() => {
        let basePrompt = '';
        switch (selectedExpertise) {
            case 'Network Expert':
                basePrompt = 'You are a Network Expert. Provide detailed technical analysis of network protocols, routing, and infrastructure.';
                break;
            case 'Server Expert':
                basePrompt = 'You are a Server Expert. Focus on server administration, OS internals, and system performance.';
                break;
            case 'Cloud Expert':
                basePrompt = 'You are a Cloud Expert. Specialize in cloud architecture, AWS/Azure/GCP services, and cloud-native practices.';
                break;
            case 'Coding Expert':
                basePrompt = 'You are a Coding Expert. Provide efficient, clean code solutions and explain algorithmic complexity.';
                break;
            default:
                basePrompt = 'You are a helpful assistant.';
                break;
        }

        let langInstruction = '';
        if (selectedLanguage !== 'English') {
            langInstruction = ` Answer in ${selectedLanguage}.`;
        }

        setLocalSystemInstruction(`${basePrompt}${langInstruction}`);

    }, [selectedExpertise, selectedLanguage]);


    // Initialize scroll position
    useEffect(() => {
        if (initialState?.scrollTop !== undefined && scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = initialState.scrollTop;
        }
    }, []); // Run once on mount

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
        localStorage.setItem('hotty_gemini_client_id', clientId);
        localStorage.setItem('hotty_gemini_client_secret', clientSecret);
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
        window.electronAPI.geminiChatSend(sessionId, text, selectedModel);
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

    return (
        <div className="ai-chat-pane" style={{ fontSize: `${fontSize}px` }}>
            {/* Header */}
            <div className="ai-chat-header">
                <div className="ai-chat-header-left">
                    <span className="ai-chat-logo">✦</span>
                    <span className="ai-chat-title">Gemini</span>
                </div>
                <div className="ai-chat-header-right">
                    {isAuthenticated && (
                        <>
                            <select
                                className="ai-chat-model-select"
                                style={{ marginRight: '5px', width: '120px' }}
                                value={selectedExpertise}
                                onChange={(e) => setSelectedExpertise(e.target.value)}
                                disabled={isStreaming}
                            >
                                {EXPERTISE_OPTIONS.map(opt => (
                                    <option key={opt} value={opt}>{opt}</option>
                                ))}
                            </select>
                            <select
                                className="ai-chat-model-select"
                                style={{ marginRight: '5px', width: '100px' }}
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
                            <select
                                className="ai-chat-model-select"
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
                            <button className="ai-chat-header-btn" onClick={handleClearChat} title="Clear chat history">
                                🗑️
                            </button>
                            <button className="ai-chat-header-btn" onClick={handleLogout} title="Logout">
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style={{ display: 'block' }}>
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
                        <div className="ai-chat-auth-icon">✦</div>
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
                                placeholder="xxxxxxxxxx.apps.googleusercontent.com"
                                className="ai-chat-input"
                            />
                            <label>Client Secret</label>
                            <input
                                type="password"
                                value={clientSecret}
                                onChange={(e) => setClientSecret(e.target.value)}
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
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', fontWeight: 'bold' }}>
                                <span>⚙️</span> System Prompt
                            </div>
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
                                    {msg.role === 'user' ? '👤' : '✦'}
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
                                <div className="ai-chat-message-avatar">✦</div>
                                <div className="ai-chat-message-content ai-chat-markdown streaming"
                                    dangerouslySetInnerHTML={{ __html: marked.parse(streamingContent, { async: false }) as string }}
                                />
                            </div>
                        )}
                        {isStreaming && !streamingContent && (
                            <div className="ai-chat-message ai-chat-message-model">
                                <div className="ai-chat-message-avatar">✦</div>
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
                            const startHeight = textareaHeight;
                            const onMouseMove = (ev: MouseEvent) => {
                                const delta = startY - ev.clientY;
                                const newHeight = Math.min(300, Math.max(36, startHeight + delta));
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
                            style={{ height: `${textareaHeight}px` }}
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
