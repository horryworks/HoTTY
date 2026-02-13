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
        textareaHeight: number;
        scrollTop?: number;
    };
    onStateChange?: (state: {
        messages: ChatMessage[];
        inputText: string;
        selectedModel: string;
        textareaHeight: number;
        scrollTop?: number;
    }) => void;
}

export const AIChatPane: React.FC<AIChatPaneProps> = ({ sessionId, initialState, onStateChange }) => {
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
    const [selectedModel, setSelectedModel] = useState(initialState?.selectedModel || 'gemini-2.0-flash-exp');
    const [textareaHeight, setTextareaHeight] = useState(initialState?.textareaHeight || 60);

    const [isStreaming, setIsStreaming] = useState(false);
    const [streamingContent, setStreamingContent] = useState('');

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const lastSentTextRef = useRef<string>('');
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Initialize scroll position
    useEffect(() => {
        if (initialState?.scrollTop !== undefined && scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = initialState.scrollTop;
        }
    }, []); // Run once on mount

    // Sync state back to parent
    useEffect(() => {
        if (onStateChange) {
            onStateChange({
                messages,
                inputText,
                selectedModel,
                textareaHeight,
                scrollTop: scrollContainerRef.current?.scrollTop
            });
        }
    }, [messages, inputText, selectedModel, textareaHeight]); // Depend on values, not onStateChange to avoid loop if parent doesn't memoize

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
        // Only auto-scroll if we are near bottom or if it's a new message
        // But for simplicity, we can auto-scroll if it's streaming or new message
        // We need to be careful not to override user scroll if they validly scrolled up
        // For now, simple behavior: scroll to bottom on new message if we were at bottom?
        // Or just scroll to bottom always on new message/stream.
        if (scrollContainerRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
            const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
            if (isNearBottom || isStreaming) {
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }
        }
    }, [messages, streamingContent, isStreaming]);

    const handleScroll = () => {
        if (onStateChange && scrollContainerRef.current) {
            onStateChange({
                messages,
                inputText,
                selectedModel,
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
                    // If current selection is not in list, switch to first one or stay if it's custom
                    // Actually, if list is valid, we prefer to use it.
                    // But if selectedModel was 'gemini-2.0-flash-exp' and list has 'gemini-2.0-flash', we might want to switch?
                    // For now, keep user selection if possible, otherwise default to first.
                    // But we initialize with 'gemini-2.0-flash' which is likely in list.
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
        if (!text || isStreaming) return;

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

    return (
        <div className="ai-chat-pane">
            {/* Header */}
            <div className="ai-chat-header">
                <div className="ai-chat-header-left">
                    <span className="ai-chat-logo">✦</span>
                    <span className="ai-chat-title">Gemini AI</span>
                </div>
                <div className="ai-chat-header-right">
                    {isAuthenticated && (
                        <>
                            <select
                                className="ai-chat-model-select"
                                value={selectedModel}
                                onChange={(e) => setSelectedModel(e.target.value)}
                                disabled={isStreaming}
                            >
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
                                🚪
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
                    <div
                        className="ai-chat-messages"
                        ref={scrollContainerRef}
                        onScroll={handleScroll}
                    >
                        {messages.length === 0 && !streamingContent && (
                            <div className="ai-chat-welcome">
                                <div className="ai-chat-welcome-icon">✦</div>
                                <h3>Gemini AI</h3>
                                <p>Ask me anything.</p>
                            </div>
                        )}
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
                            disabled={!inputText.trim() || isStreaming}
                        >
                            ➤
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
