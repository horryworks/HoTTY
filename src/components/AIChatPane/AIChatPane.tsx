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
        lastTargetSessionId?: string;
        lastTargetSessionTitle?: string;
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
    }) => void;
    showSystemPrompt: boolean;
    askGeminiCommands: { id: string; label: string; promptTemplate: string }[];
    aiPersonas: { id: string; label: string; systemPrompt: string }[];
    fontSize?: number;
    isActive?: boolean;
    terminalBackground?: string;
    terminalBackgroundInactive?: string;
    lastTerminalSessionId?: string | null;
    lastTerminalSessionTitle?: string | null;
}

// ── Custom Message Component with Execution Support ──
const MessageContent: React.FC<{
    content: string;
    onRun?: (cmd: string) => void;
    onHoverTarget?: (hovered: boolean) => void;
    targetTitle?: string;
    targetId?: string;
}> = ({ content, onRun, onHoverTarget, targetTitle, targetId }) => {
    // We split the content by code blocks. 
    // This is a simple parser for ```execute ... ``` blocks
    const parts = content.split(/(```execute[\s\S]*?```)/g);

    return (
        <>
            {parts.map((part, i) => {
                const match = part.match(/^```execute\s*\n?([\s\S]*?)\n?```$/);
                if (match) {
                    const command = match[1].trim();
                    return (
                        <div key={i} className="ai-execute-block">
                            <pre><code>{command}</code></pre>
                            <div className="ai-execute-actions">
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
                                {targetId ? (
                                    <span className="ai-run-target">Target: {targetTitle || 'Unnamed Terminal'}</span>
                                ) : (
                                    <span className="ai-run-target no-target">No Terminal Targeted</span>
                                )}
                            </div>
                        </div>
                    );
                }
                // Fallback to standard markdown for other parts
                return (
                    <div
                        key={i}
                        className="ai-chat-markdown-inline"
                        dangerouslySetInnerHTML={{ __html: marked.parse(part, { async: false }) as string }}
                    />
                );
            })}
        </>
    );
};

export const AIChatPane: React.FC<AIChatPaneProps> = ({
    sessionId,
    initialState,
    onStateChange,
    showSystemPrompt,
    aiPersonas,
    fontSize,
    terminalBackground,
    lastTerminalSessionId: lastTerminalSessionIdProp,
    lastTerminalSessionTitle: lastTerminalSessionTitleProp
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

    // Target session info
    const [lastTargetSessionId, setLastTargetSessionId] = useState(initialState?.lastTargetSessionId);
    const [lastTargetSessionTitle, setLastTargetSessionTitle] = useState(initialState?.lastTargetSessionTitle);

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
        if (initialState?.pendingMessage !== undefined) {
            setLocalPendingMessage(initialState.pendingMessage);
        }
        if (initialState?.lastTargetSessionId !== undefined) {
            setLastTargetSessionId(initialState.lastTargetSessionId);
        }
        if (initialState?.lastTargetSessionTitle !== undefined) {
            setLastTargetSessionTitle(initialState.lastTargetSessionTitle);
        }
    }, [initialState?.pendingMessage, initialState?.lastTargetSessionId, initialState?.lastTargetSessionTitle]);

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

        // Add execution instruction
        const execInstruction = ' When suggesting a command to run, please wrap it in ```execute\\n...\\n``` block.';

        setLocalSystemInstruction(`${basePrompt}${langInstruction}${execInstruction}`);

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
            const sysInstr = (initialState?.systemInstruction || localSystemInstruction) + ' When suggesting a command to run, please wrap it in ```execute\\n...\\n``` block.';

            setLocalPendingMessage(undefined);

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
            window.electronAPI.geminiChatSend(sessionId, text, selectedModel, sysInstr);
        }
    }, [isAuthenticated, localPendingMessage, isStreaming, sessionId, selectedModel, initialState?.systemInstruction, localSystemInstruction]);

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
                lastTargetSessionTitle
            });
        }
    }, [messages, inputText, selectedModel, selectedLanguage, selectedExpertise, textareaHeight, localSystemInstruction, localPendingMessage, lastTargetSessionId, lastTargetSessionTitle]);

    useEffect(() => {
        window.electronAPI.geminiAuthStatus().then(setIsAuthenticated);
    }, []);

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
                scrollTop: scrollContainerRef.current.scrollTop,
                pendingMessage: localPendingMessage,
                systemInstruction: localSystemInstruction,
                lastTargetSessionId,
                lastTargetSessionTitle
            });
        }
    };

    const [authError, setAuthError] = useState<string | null>(null);
    const [availableModels, setAvailableModels] = useState<{ name: string; displayName: string }[]>([]);

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

    const handleRunCommand = (command: string) => {
        if (!lastTargetSessionId) return;
        // Strictly trim and use \r for execution (standard for terminals)
        const cleanCmd = command.trim();
        window.electronAPI.sendInput(lastTargetSessionId, cleanCmd + '\r');
        window.electronAPI.focusWindow();
        window.dispatchEvent(new CustomEvent('hotty-focus-session', { detail: { sessionId: lastTargetSessionId } }));
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
                                    {['Auto', 'English', 'Japanese', 'Chinese', 'Korean', 'Spanish', 'French', 'German', 'Russian'].map(lang => (
                                        <option key={lang} value={lang}>{lang}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="ai-chat-header-item">
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
                                    {selectedModel === 'Unspecified' && <option value="Unspecified">Select a model...</option>}
                                    {availableModels.length > 0 ? availableModels.map(m => (
                                        <option key={m.name} value={m.name}>{m.displayName}</option>
                                    )) : (
                                        <>
                                            <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                                            <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                                        </>
                                    )}
                                </select>
                            </div>
                            <button className="ai-chat-header-btn" onClick={handleClearChat} title="Clear chat history">🗑️</button>
                            <button className="ai-chat-header-btn" onClick={handleLogout} title="Logout">
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                                    <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
                                </svg>
                            </button>
                        </>
                    )}
                </div>
            </div>

            {!isAuthenticated ? (
                <div className="ai-chat-auth-container">
                    {/* ... (auth container content - simplified for brevity or keep as is) ... */}
                    <div className="ai-chat-auth-card">
                        <div className="ai-chat-auth-icon"><GeminiIcon size={64} /></div>
                        <h2>Connect to Gemini</h2>
                        <div className="ai-chat-auth-form">
                            <label>Client ID</label>
                            <input type="text" value={clientId} onChange={(e) => setClientId(e.target.value)} className="ai-chat-input" />
                            <label>Client Secret</label>
                            <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} className="ai-chat-input" />
                            <button className="ai-chat-login-btn" onClick={handleLogin} disabled={!clientId || !clientSecret || isAuthLoading}>
                                {isAuthLoading ? 'Connecting...' : 'Sign in with Google'}
                            </button>
                            {authError && <div className="ai-chat-auth-error">{authError}</div>}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="ai-chat-body">
                    {showSystemPrompt && localSystemInstruction && (
                        <div className="ai-chat-message-system" style={{ padding: '10px', backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem', color: 'var(--text-secondary)', maxHeight: '100px', overflowY: 'auto' }}>
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
                                            onRun={handleRunCommand}
                                            onHoverTarget={handleHoverTarget}
                                            targetTitle={lastTargetSessionTitle}
                                            targetId={lastTargetSessionId}
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
                        {isStreaming && <button className="ai-chat-cancel-btn" onClick={handleCancel}>■</button>}
                        <button className="ai-chat-send-btn" onClick={handleSend} disabled={!inputText.trim() || isStreaming || selectedModel === 'Unspecified'}>➤</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AIChatPane;
