import { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

export interface Session {
    id: string;
    title: string;
    type: 'ssh' | 'telnet' | 'serial' | 'ai' | 'wsl' | 'local';
    aiChatState?: {
        messages: any[]; // ChatMessage[] but avoiding circular dependency or complex imports here
        inputText: string;
        pendingMessage?: string;
        systemInstruction?: string;
        selectedModel: string;
        selectedLanguage: string;
        selectedExpertise?: string;
        textareaHeight: number;
        scrollTop?: number;
        lastTargetSessionId?: string;
        lastTargetSessionTitle?: string;
    };
    isWatching?: boolean;
    hasWatchData?: boolean;
}

interface UseSessionManagerOptions {
    globalEncoding: string;
    onPasteRequest: (sessionId: string, text: string) => void;
    onSessionConnected: () => void;
    onSessionError: (error: string) => void;
    setPaneAllocations: React.Dispatch<React.SetStateAction<{ [paneId: string]: string | null }>>;
    setActivePaneId: React.Dispatch<React.SetStateAction<string>>;
    sshKeepAliveEnabled: boolean;
    sshKeepAliveInterval: number;
    telnetKeepAliveEnabled: boolean;
    telnetKeepAliveInterval: number;
    loggingEnabled: boolean;
    loggingPath: string;
    lineWrapEnabled: boolean;
    scrollback: number;
    backspaceSendsDel: boolean;
    showLeftSidebar: boolean;
    showRightSidebar: boolean;
    showTopBar: boolean;
    showBottomBar: boolean;
    watchBufferLimit: number;
}

export function useSessionManager(options: UseSessionManagerOptions) {
    const {
        globalEncoding,
        onPasteRequest,
        onSessionConnected,
        onSessionError,
        setPaneAllocations,
        setActivePaneId,
        sshKeepAliveEnabled,
        sshKeepAliveInterval,
        telnetKeepAliveEnabled,
        telnetKeepAliveInterval,
        loggingEnabled,
        loggingPath,
        lineWrapEnabled,
        scrollback,
        backspaceSendsDel,
        showLeftSidebar,
        showRightSidebar,
        showTopBar,
        showBottomBar,
        watchBufferLimit,
    } = options;

    const [sessions, setSessions] = useState<Session[]>([]);
    const [tabOrder, setTabOrder] = useState<string[]>([]);
    const terminalRegistry = useRef<{ [sessionId: string]: Terminal }>({});
    const watchBuffers = useRef<{ [sessionId: string]: string }>({});

    // Terminal instance factory
    const createTerminalInstance = (sessionId: string, type?: Session['type']) => {
        const term = new Terminal({
            cursorBlink: true,
            fontSize: 14,
            fontFamily: 'Consolas, "Courier New", monospace',
            disableStdin: false,
            theme: { background: '#1e1e1e', foreground: '#ffffff' },
            allowProposedApi: true,
            scrollback: scrollback
        });

        // Apply initial line wrap state
        term.write(lineWrapEnabled ? '\x1b[?7h' : '\x1b[?7l');

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        (term as any)._fitAddon = fitAddon;

        // Clipboard: copy on select
        term.onSelectionChange(() => {
            const selection = term.getSelection();
            if (selection) {
                window.electronAPI.writeClipboard(selection);
            }
        });

        // Paste interception (Ctrl+V) and Selection clearing (Ctrl+C)
        term.attachCustomKeyEventHandler((event) => {
            if (event.ctrlKey && event.type === 'keydown') {
                if (event.key === 'v') {
                    event.preventDefault();
                    event.stopPropagation();
                    navigator.clipboard.readText().then(text => {
                        if (text) onPasteRequest(sessionId, text);
                    }).catch(err => console.error('Clipboard error:', err));
                    return false;
                }
                if (event.key === 'c' && term.hasSelection()) {
                    // If text is selected, just clear selection and don't send Ctrl+C to device
                    term.clearSelection();
                    return false;
                }
            }
            return true;
        });

        // User input → backend
        term.onData((data) => {
            let processedData = data;
            // Intercept Backspace (\x7f) and convert to \x08 if required
            // Only apply this to remote/serial connections. Local shells (wsl, local) typically expect \x7f.
            const isRemoteOrSerial = type === 'ssh' || type === 'telnet' || type === 'serial';
            if (isRemoteOrSerial && !backspaceSendsDel && data === '\x7f') {
                processedData = '\x08';
            }
            window.electronAPI.sendInput(sessionId, processedData);
        });

        return term;
    };



    // Apply Line Wrap setting to all terminals when it changes
    useEffect(() => {
        const sequence = lineWrapEnabled ? '\x1b[?7h' : '\x1b[?7l';
        Object.values(terminalRegistry.current).forEach(term => {
            term.write(sequence);
        });
    }, [lineWrapEnabled]);

    // Apply Scrollback setting to all terminals when it changes
    useEffect(() => {
        Object.values(terminalRegistry.current).forEach(term => {
            term.options.scrollback = scrollback;
        });
    }, [scrollback]);

    // Global session data dispatcher
    useEffect(() => {
        const removeDataListener = window.electronAPI.onSessionData((id, data) => {
            const term = terminalRegistry.current[id];
            if (term) {
                term.write(data);
            }

            // Append to watch buffer if this session is being watched
            setSessions(currentSessions => {
                const session = currentSessions.find(s => s.id === id);
                if (session && session.isWatching) {
                    // Strip ANSI escape codes
                    // eslint-disable-next-line no-control-regex
                    let cleanData = data.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
                    cleanData = cleanData.replace(/\r\n/g, '\n').replace(/\r/g, ''); // Normalize CRLF/CR

                    if (watchBuffers.current[id] === undefined) {
                        watchBuffers.current[id] = '';
                    }

                    let newBuffer = watchBuffers.current[id] + cleanData;

                    // Enforce limit (FIFO)
                    if (newBuffer.length > watchBufferLimit) {
                        newBuffer = newBuffer.substring(newBuffer.length - watchBufferLimit);
                    }

                    watchBuffers.current[id] = newBuffer;

                    // Update session state to reflect that we have data (only if not already set)
                    if (!session.hasWatchData) {
                        return currentSessions.map(s => s.id === id ? { ...s, hasWatchData: true } : s);
                    }
                }
                return currentSessions;
            });
        });
        return () => removeDataListener();
    }, [watchBufferLimit]); // Need watchBufferLimit to be bound

    // Session status & error listeners
    useEffect(() => {
        const removeStatusListener = window.electronAPI.onSessionStatus((sessionId, status) => {
            console.log(`Session ${sessionId} Status:`, status);
            if (status === 'connected') {
                onSessionConnected();
            } else if (status === 'disconnected') {
                closeSession(sessionId);
            }
        });

        const removeErrorListener = window.electronAPI.onSessionError((sessionId, error) => {
            console.error(`Session ${sessionId} Error:`, error);

            // Suppress popup for common disconnection messages
            const silentErrors = [
                'The connection is closed by SSH server',
                'Connection lost'
            ];

            if (!silentErrors.some(msg => error.includes(msg))) {
                onSessionError(error);
            }

            closeSession(sessionId);
        });

        return () => {
            removeStatusListener();
            removeErrorListener();
        };
    }, []);

    const allocateToPane = (sessionId: string) => {
        setPaneAllocations(prev => {
            const next = { ...prev };

            // 1. Find the first empty grid pane (numerical ID)
            const validGridPanes = Object.keys(next)
                .filter(p => !isNaN(parseInt(p)))
                .sort((a, b) => parseInt(a) - parseInt(b));
            let firstEmpty = validGridPanes.find(p => next[p] === null);

            // 2. Fallback to outer bars in priority order if grid is full
            if (!firstEmpty) {
                const fallbackOrder = [
                    { id: 'sidebar-left', visible: showLeftSidebar },
                    { id: 'sidebar', visible: showRightSidebar },
                    { id: 'top-bar', visible: showTopBar },
                    { id: 'bottom-bar', visible: showBottomBar }
                ];

                for (const bar of fallbackOrder) {
                    if (bar.visible && !next[bar.id]) {
                        firstEmpty = bar.id;
                        break;
                    }
                }
            }

            if (firstEmpty) {
                next[firstEmpty] = sessionId;
                setActivePaneId(firstEmpty);
            }
            return next;
        });
    };

    const createSession = (config: any) => {
        const sessionId = self.crypto.randomUUID();
        let title: string;
        let type: Session['type'];
        if (config.protocol === 'serial') {
            title = `Serial ${config.path} (${config.baudRate || 9600})`;
            type = 'serial';
        } else if (config.protocol === 'telnet') {
            title = `Telnet ${config.host}`;
            type = 'telnet';
        } else if (config.protocol === 'wsl') {
            title = `WSL ${config.distro || 'Default'}`;
            type = 'wsl';
        } else if (config.protocol === 'cmd') {
            title = 'Command Prompt';
            type = 'local';
        } else if (config.protocol === 'powershell') {
            title = 'PowerShell';
            type = 'local';
        } else {
            title = `SSH ${config.host}`;
            type = 'ssh';
        }
        const newSession: Session = { id: sessionId, title, type };

        terminalRegistry.current[sessionId] = createTerminalInstance(sessionId, type);

        setSessions(prev => [...prev, newSession]);
        setTabOrder(prev => [...prev, sessionId]);
        allocateToPane(sessionId);

        const fullConfig = {
            ...config,
            encoding: globalEncoding,
            keepaliveInterval: sshKeepAliveEnabled ? sshKeepAliveInterval * 1000 : 0,
            telnetKeepAliveInterval: telnetKeepAliveEnabled ? telnetKeepAliveInterval * 1000 : 0,
            loggingEnabled,
            loggingPath
        };
        window.electronAPI.connectSession(sessionId, fullConfig);
    };

    const createAISession = () => {
        // Only one AI session allowed
        const existingAI = sessions.find(s => s.type === 'ai');
        if (existingAI) {
            onSessionError('Only one Gemini AI session can be open at a time.');
            return;
        }

        const sessionId = self.crypto.randomUUID();
        const newSession: Session = {
            id: sessionId,
            title: 'Gemini AI',
            type: 'ai',
            aiChatState: {
                messages: [],
                inputText: '',
                selectedModel: localStorage.getItem('hotty_gemini_model') || 'Unspecified',
                selectedLanguage: localStorage.getItem('hotty_gemini_language') || 'English',
                textareaHeight: 0,
                scrollTop: 0
            }
        };

        setSessions(prev => [...prev, newSession]);
        setTabOrder(prev => [...prev, sessionId]);
        allocateToPane(sessionId);

        return sessionId;
    };

    const updateSessionState = (sessionId: string, newState: Partial<Session['aiChatState']>) => {
        setSessions(prev => prev.map(s => {
            if (s.id === sessionId && s.aiChatState) {
                return {
                    ...s,
                    aiChatState: { ...s.aiChatState, ...newState }
                };
            }
            return s;
        }));
    };

    const closeSession = (sessionId: string) => {
        const session = sessions.find(s => s.id === sessionId);

        if (session?.type === 'ai') {
            // AI sessions don't have terminal or backend connection
            window.electronAPI.geminiChatClear(sessionId);
        } else {
            window.electronAPI.disconnectSession(sessionId);
            const term = terminalRegistry.current[sessionId];
            if (term) {
                term.dispose();
                delete terminalRegistry.current[sessionId];
            }
        }

        // Cleanup watch buffer
        delete watchBuffers.current[sessionId];

        setSessions(prev => prev.filter(s => s.id !== sessionId));
        setTabOrder(prev => prev.filter(id => id !== sessionId));

        setPaneAllocations(prev => {
            const next = { ...prev };
            Object.keys(next).forEach(paneId => {
                if (next[paneId] === sessionId) next[paneId] = null;
            });
            return next;
        });
    };

    const closeAllAISessions = () => {
        const aiSessions = sessions.filter(s => s.type === 'ai');
        aiSessions.forEach(s => {
            closeSession(s.id);
        });
    };

    const handleTabReorder = (fromIndex: number, toIndex: number) => {
        setTabOrder(prev => {
            if (fromIndex === toIndex) return prev;
            const newOrder = [...prev];
            const [removed] = newOrder.splice(fromIndex, 1);
            newOrder.splice(toIndex, 0, removed);
            return newOrder;
        });
    };

    const handleTerminalData = useCallback((sessionId: string, data: string) => {
        window.electronAPI.sendInput(sessionId, data);
    }, []);

    const toggleWatch = useCallback((sessionId: string) => {
        setSessions(prev => prev.map(s => {
            if (s.id === sessionId) {
                const newWatchingState = !s.isWatching;
                // If turning off watch, clear the buffer to free memory
                if (!newWatchingState) {
                    delete watchBuffers.current[sessionId];
                    return { ...s, isWatching: newWatchingState, hasWatchData: false };
                } else if (!watchBuffers.current[sessionId]) {
                    // Initialize if starting to watch
                    watchBuffers.current[sessionId] = '';
                }
                return { ...s, isWatching: newWatchingState };
            }
            return s;
        }));
    }, []);

    const getWatchBuffer = useCallback((sessionId: string) => {
        return watchBuffers.current[sessionId] || '';
    }, []);

    return {
        sessions,
        tabOrder,
        terminalRegistry,
        createSession,
        createAISession,
        updateSessionState,
        closeSession,
        closeAllAISessions,
        handleTabReorder,
        handleTerminalData,
        toggleWatch,
        getWatchBuffer,
    };
}
