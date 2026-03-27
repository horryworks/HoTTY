import { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { stripAnsiCodes } from '../utils/ansiUtils';
import { TERMINAL_SEQUENCES } from '../constants/terminalSequences';
import { STORAGE_KEYS } from '../constants/storage';
import * as electronService from '../services/electronService';
import { useSettingsStore } from '../stores/settingsStore';

const AI_PROVIDER_LABELS: Record<string, string> = {
    gemini: 'Gemini AI',
    vertexai: 'Vertex AI',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
};

export interface TextEditorTab {
    id: string;
    filePath: string | null;
    content: string;
    savedContent: string;
    encoding: string;
    lineEnding: 'LF' | 'CRLF';
}

export interface Session {
    id: string;
    title: string;
    type: 'ssh' | 'telnet' | 'serial' | 'ai' | 'wsl' | 'local' | 'log-viewer' | 'ping-monitor' | 'text-editor' | 'file-explorer';
    logViewerState?: {
        loggingPath: string;
    };
    pingMonitorState?: {
        targets: string;
        intervalSeconds: number;
        isRunning: boolean;
    };
    aiChatState?: {
        messages: { role: "user" | "model"; content: string }[]; // ChatMessage shape, avoiding circular dependency
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
        isWaitingForTerminal?: boolean;
    };
    textEditorState?: {
        tabs: TextEditorTab[];
        activeTabId: string;
    };
    fileExplorerState?: {
        currentPath: string;
        expandedPaths: string[];
    };
    isWatching?: boolean;
    hasWatchData?: boolean;
}

interface UseSessionManagerOptions {
    globalEncoding: string;
    onPasteRequest: (sessionId: string, text: string) => void;
    onSessionConnected: () => void;
    onSessionError: (error: string) => void;
    paneAllocations: { [paneId: string]: string | null };
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
        paneAllocations,
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
    const textEditorRegistry = useRef<{ [sessionId: string]: { requestClose: () => Promise<boolean> } }>({});
    const watchBuffers = useRef<{ [sessionId: string]: string }>({});
    const watchingSessionIds = useRef<Set<string>>(new Set());
    const hasWatchDataFlags = useRef<Set<string>>(new Set());

    const activeAiProvider = useSettingsStore(s => s.activeAiProvider);
    // Sync AI tab title when provider changes
    useEffect(() => {
        const aiTitle = AI_PROVIDER_LABELS[activeAiProvider] ?? 'AI';
        setSessions(prev =>
            prev.map(s => s.type === 'ai' ? { ...s, title: aiTitle } : s)
        );
    }, [activeAiProvider]);

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
        term.write(lineWrapEnabled ? TERMINAL_SEQUENCES.LINE_WRAP_ENABLED : TERMINAL_SEQUENCES.LINE_WRAP_DISABLED);

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        (term as Terminal & { _fitAddon?: FitAddon })._fitAddon = fitAddon;

        // Clipboard: copy on select
        term.onSelectionChange(() => {
            const selection = term.getSelection();
            if (selection) {
                electronService.writeClipboard(selection);
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
            electronService.sendInput(sessionId, processedData);
        });

        return term;
    };



    // Apply Line Wrap setting to all terminals when it changes
    useEffect(() => {
        const sequence = lineWrapEnabled ? TERMINAL_SEQUENCES.LINE_WRAP_ENABLED : TERMINAL_SEQUENCES.LINE_WRAP_DISABLED;
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
        const removeDataListener = electronService.onSessionData((id, data) => {
            const term = terminalRegistry.current[id];
            if (term) {
                term.write(data);
            }

            // Append to watch buffer if this session is being watched (ref-based check avoids setSessions)
            if (watchingSessionIds.current.has(id)) {
                const cleanData = stripAnsiCodes(data);

                if (watchBuffers.current[id] === undefined) {
                    watchBuffers.current[id] = '';
                }

                let newBuffer = watchBuffers.current[id] + cleanData;

                if (newBuffer.length > watchBufferLimit) {
                    newBuffer = newBuffer.substring(newBuffer.length - watchBufferLimit);
                }

                watchBuffers.current[id] = newBuffer;

                // Only trigger a state update when hasWatchData needs to flip false→true
                if (!hasWatchDataFlags.current.has(id)) {
                    hasWatchDataFlags.current.add(id);
                    setSessions(prev => prev.map(s => s.id === id ? { ...s, hasWatchData: true } : s));
                }
            }
        });
        return () => removeDataListener();
    }, [watchBufferLimit]); // Need watchBufferLimit to be bound

    const performCloseSession = (sessionId: string) => {
        const session = sessions.find(s => s.id === sessionId);

        if (session?.type === 'ai') {
            // AI sessions don't have terminal or backend connection
            electronService.aiChatClear(sessionId);

            // Disconnect the linked terminal's watch state when AI session closes
            const linkedTerminalId = session.aiChatState?.lastTargetSessionId;
            if (linkedTerminalId) {
                delete watchBuffers.current[linkedTerminalId];
                setSessions(prev => prev.map(s =>
                    s.id === linkedTerminalId ? { ...s, isWatching: false, hasWatchData: false } : s
                ));
            }
        } else if (session?.type === 'log-viewer') {
            // Log viewer sessions don't have terminal or backend connection
        } else if (session?.type === 'text-editor') {
            // Text editor sessions don't have terminal or backend connection
            delete textEditorRegistry.current[sessionId];
        } else if (session?.type === 'ping-monitor') {
            // Save targets and interval before closing
            if (session.pingMonitorState) {
                try {
                    localStorage.setItem(STORAGE_KEYS.PING_MONITOR_STATE, JSON.stringify({
                        targets: session.pingMonitorState.targets,
                        intervalSeconds: session.pingMonitorState.intervalSeconds,
                    }));
                } catch { /* ignore storage errors */ }
            }
            electronService.pingMonitorStop(sessionId);
        } else {
            electronService.disconnectSession(sessionId);
            const term = terminalRegistry.current[sessionId];
            if (term) {
                term.dispose();
                delete terminalRegistry.current[sessionId];
            }
        }

        // Cleanup watch buffer and refs
        delete watchBuffers.current[sessionId];
        watchingSessionIds.current.delete(sessionId);
        hasWatchDataFlags.current.delete(sessionId);

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

    const closeSession = async (sessionId: string) => {
        const session = sessions.find(s => s.id === sessionId);
        if (session?.type === 'text-editor') {
            const handle = textEditorRegistry.current[sessionId];
            if (handle) {
                const canClose = await handle.requestClose();
                if (!canClose) return;
            }
        }
        performCloseSession(sessionId);
    };

    // Session status & error listeners
    useEffect(() => {
        const removeStatusListener = electronService.onSessionStatus((sessionId, status) => {
            console.warn(`Session ${sessionId} Status:`, status);
            if (status === 'connected') {
                onSessionConnected();
            } else if (status === 'disconnected') {
                closeSession(sessionId);
            }
        });

        const removeErrorListener = electronService.onSessionError((sessionId, error) => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const allocateToPane = (sessionId: string, options?: { preferSidebar?: boolean }) => {
        setPaneAllocations(prev => {
            const next = { ...prev };

            let firstEmpty: string | undefined;

            // When preferSidebar is set, try Left Sidebar → Right Sidebar first
            if (options?.preferSidebar) {
                const sidebarOrder = [
                    { id: 'sidebar-left', visible: showLeftSidebar },
                    { id: 'sidebar', visible: showRightSidebar },
                ];
                for (const bar of sidebarOrder) {
                    if (bar.visible && !next[bar.id]) {
                        firstEmpty = bar.id;
                        break;
                    }
                }
            }

            // 1. Find the first empty grid pane (numerical ID)
            if (!firstEmpty) {
                const validGridPanes = Object.keys(next)
                    .filter(p => !isNaN(parseInt(p)))
                    .sort((a, b) => parseInt(a) - parseInt(b));
                firstEmpty = validGridPanes.find(p => next[p] === null);
            }

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

    const createSession = (config: Record<string, unknown>) => {
        if (config.protocol === 'log-viewer') {
            const sessionId = self.crypto.randomUUID();
            const newSession: Session = {
                id: sessionId,
                title: 'Log Viewer',
                type: 'log-viewer',
                logViewerState: { loggingPath }
            };
            setSessions(prev => [...prev, newSession]);
            setTabOrder(prev => [...prev, sessionId]);
            allocateToPane(sessionId);
            return;
        }

        const sessionId = self.crypto.randomUUID();
        let title: string;
        let type: Session['type'];
        if (config.protocol === 'serial') {
            title = `Serial ${config.path} (${config.baudRate || 9600})`;
            type = 'serial';
        } else if (config.protocol === 'telnet') {
            title = `Telnet ${config.host}`;
            if (config.jumpbox) title += ` via ${(config.jumpbox as Record<string, unknown>).host}`;
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
        } else if (config.protocol === 'git-bash') {
            title = 'Git Bash';
            type = 'local';
        } else {
            title = `SSH ${config.host}`;
            if (config.jumpbox) title += ` via ${(config.jumpbox as Record<string, unknown>).host}`;
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
        electronService.connectSession(sessionId, fullConfig);
    };

    const createAISession = () => {
        // Only one AI session allowed
        const existingAI = sessions.find(s => s.type === 'ai');
        const aiTitle = AI_PROVIDER_LABELS[activeAiProvider] ?? 'AI';
        if (existingAI) {
            onSessionError(`Only one ${aiTitle} session can be open at a time.`);
            return;
        }

        const sessionId = self.crypto.randomUUID();
        const newSession: Session = {
            id: sessionId,
            title: aiTitle,
            type: 'ai',
            aiChatState: {
                messages: [],
                inputText: '',
                selectedModel: localStorage.getItem(STORAGE_KEYS.AI_SELECTED_MODEL_PER_PROVIDER(activeAiProvider)) || localStorage.getItem(STORAGE_KEYS.AI_SELECTED_MODEL) || 'Unspecified',
                selectedLanguage: localStorage.getItem(STORAGE_KEYS.GEMINI_LANGUAGE) || 'English',
                textareaHeight: 0,
                scrollTop: 0
            }
        };

        setSessions(prev => [...prev, newSession]);
        setTabOrder(prev => [...prev, sessionId]);
        allocateToPane(sessionId);

        return sessionId;
    };

    const createLogViewerSession = () => {
        const sessionId = self.crypto.randomUUID();
        const newSession: Session = {
            id: sessionId,
            title: 'Log Viewer',
            type: 'log-viewer',
            logViewerState: { loggingPath }
        };
        setSessions(prev => [...prev, newSession]);
        setTabOrder(prev => [...prev, sessionId]);
        allocateToPane(sessionId);
        return sessionId;
    };

    const createPingMonitorSession = () => {
        const sessionId = self.crypto.randomUUID();

        // Restore saved targets and interval from previous session
        let savedTargets = '';
        let savedInterval = 5;
        try {
            const saved = localStorage.getItem(STORAGE_KEYS.PING_MONITOR_STATE);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (typeof parsed.targets === 'string') savedTargets = parsed.targets;
                if (typeof parsed.intervalSeconds === 'number') savedInterval = parsed.intervalSeconds;
            }
        } catch { /* ignore parse errors */ }

        const newSession: Session = {
            id: sessionId,
            title: 'Ping Monitor',
            type: 'ping-monitor',
            pingMonitorState: {
                targets: savedTargets,
                intervalSeconds: savedInterval,
                isRunning: false,
            }
        };
        setSessions(prev => [...prev, newSession]);
        setTabOrder(prev => [...prev, sessionId]);
        allocateToPane(sessionId);
        return sessionId;
    };

    const createTextEditorSession = (initialFilePath?: string) => {
        // Only allow one text-editor session at a time — reuse existing if present
        const existingSession = sessions.find(s => s.type === 'text-editor');
        if (existingSession) {
            // Show warning when user explicitly tries to open another text editor (no file path)
            if (!initialFilePath) {
                onSessionError('Only one Text Editor session can be open at a time.');
            }
            // If a file path is provided, add it as a new tab (or activate existing)
            if (initialFilePath && existingSession.textEditorState) {
                const existingTab = existingSession.textEditorState.tabs.find(t => t.filePath === initialFilePath);
                if (existingTab) {
                    updateTextEditorState(existingSession.id, { activeTabId: existingTab.id });
                } else {
                    const newTab: TextEditorTab = {
                        id: self.crypto.randomUUID(),
                        filePath: initialFilePath,
                        content: '',
                        savedContent: '',
                        encoding: 'utf-8',
                        lineEnding: 'CRLF',
                    };
                    updateTextEditorState(existingSession.id, {
                        tabs: [...existingSession.textEditorState.tabs, newTab],
                        activeTabId: newTab.id,
                    });
                }
            }
            // Activate the pane containing the existing text-editor session
            const paneId = Object.entries(paneAllocations).find(([, sid]) => sid === existingSession.id)?.[0];
            if (paneId) {
                setActivePaneId(paneId);
            }
            return existingSession.id;
        }

        const sessionId = self.crypto.randomUUID();

        // Restore previously opened files from localStorage
        let tabs: TextEditorTab[] = [];
        let activeTabId = '';
        try {
            const saved = localStorage.getItem(STORAGE_KEYS.TEXT_EDITOR_STATE);
            if (saved) {
                const parsed = JSON.parse(saved) as { filePaths: string[]; activeFilePath: string | null };
                if (parsed.filePaths?.length > 0) {
                    tabs = parsed.filePaths.map(fp => ({
                        id: self.crypto.randomUUID(),
                        filePath: fp,
                        content: '',
                        savedContent: '',
                        encoding: 'utf-8',
                        lineEnding: 'CRLF' as const,
                    }));
                    // Set active tab to the previously active file, or first tab
                    const activeIdx = parsed.activeFilePath
                        ? tabs.findIndex(t => t.filePath === parsed.activeFilePath)
                        : 0;
                    activeTabId = tabs[Math.max(activeIdx, 0)].id;
                }
            }
        } catch { /* ignore parse errors */ }

        // If an initial file path is provided, add it (or ensure it's in the list)
        if (initialFilePath) {
            const existing = tabs.find(t => t.filePath === initialFilePath);
            if (existing) {
                activeTabId = existing.id;
            } else {
                const newTab: TextEditorTab = {
                    id: self.crypto.randomUUID(),
                    filePath: initialFilePath,
                    content: '',
                    savedContent: '',
                    encoding: 'utf-8',
                    lineEnding: 'CRLF',
                };
                tabs.push(newTab);
                activeTabId = newTab.id;
            }
        }

        // Fallback: if no tabs at all, create an empty one
        if (tabs.length === 0) {
            const tabId = self.crypto.randomUUID();
            tabs = [{
                id: tabId,
                filePath: null,
                content: '',
                savedContent: '',
                encoding: 'utf-8',
                lineEnding: 'CRLF',
            }];
            activeTabId = tabId;
        }

        const newSession: Session = {
            id: sessionId,
            title: 'Text Editor',
            type: 'text-editor',
            textEditorState: { tabs, activeTabId },
        };
        setSessions(prev => [...prev, newSession]);
        setTabOrder(prev => [...prev, sessionId]);
        allocateToPane(sessionId);
        return sessionId;
    };

    const createFileExplorerSession = () => {
        // Only allow one file explorer session at a time
        const existingSession = sessions.find(s => s.type === 'file-explorer');
        if (existingSession) {
            onSessionError('Only one File Explorer session can be open at a time.');
            const paneId = Object.entries(paneAllocations).find(([, sid]) => sid === existingSession.id)?.[0];
            if (paneId) {
                setActivePaneId(paneId);
            }
            return existingSession.id;
        }

        const sessionId = self.crypto.randomUUID();

        // Restore previous state from localStorage
        let currentPath = '';
        let expandedPaths: string[] = [];
        try {
            const saved = localStorage.getItem(STORAGE_KEYS.FILE_EXPLORER_STATE);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (typeof parsed.currentPath === 'string') currentPath = parsed.currentPath;
                if (Array.isArray(parsed.expandedPaths)) expandedPaths = parsed.expandedPaths;
            }
        } catch { /* ignore parse errors */ }

        const newSession: Session = {
            id: sessionId,
            title: 'File Explorer',
            type: 'file-explorer',
            fileExplorerState: { currentPath, expandedPaths },
        };
        setSessions(prev => [...prev, newSession]);
        setTabOrder(prev => [...prev, sessionId]);
        allocateToPane(sessionId, { preferSidebar: true });
        return sessionId;
    };

    const updateFileExplorerState = (sessionId: string, newState: Partial<NonNullable<Session['fileExplorerState']>>) => {
        setSessions(prev => prev.map(s => {
            if (s.id === sessionId && s.fileExplorerState) {
                const merged = { ...s.fileExplorerState, ...newState };
                try {
                    localStorage.setItem(STORAGE_KEYS.FILE_EXPLORER_STATE, JSON.stringify({
                        currentPath: merged.currentPath,
                        expandedPaths: merged.expandedPaths,
                    }));
                } catch { /* ignore storage errors */ }
                return { ...s, fileExplorerState: merged };
            }
            return s;
        }));
    };

    const updateTextEditorState = (sessionId: string, newState: Partial<NonNullable<Session['textEditorState']>>) => {
        setSessions(prev => prev.map(s => {
            if (s.id === sessionId && s.textEditorState) {
                const merged = { ...s.textEditorState, ...newState };
                // Persist tab file paths to localStorage
                try {
                    const filePaths = merged.tabs
                        .map(t => t.filePath)
                        .filter((p): p is string => p !== null);
                    localStorage.setItem(STORAGE_KEYS.TEXT_EDITOR_STATE, JSON.stringify({
                        filePaths,
                        activeFilePath: merged.tabs.find(t => t.id === merged.activeTabId)?.filePath ?? null,
                    }));
                } catch { /* ignore storage errors */ }
                return { ...s, textEditorState: merged };
            }
            return s;
        }));
    };

    const updatePingMonitorState = (sessionId: string, newState: Partial<Session['pingMonitorState']>) => {
        setSessions(prev => prev.map(s => {
            if (s.id === sessionId && s.pingMonitorState) {
                const merged = { ...s.pingMonitorState, ...newState };
                // Persist targets and interval to localStorage on every state change
                try {
                    localStorage.setItem(STORAGE_KEYS.PING_MONITOR_STATE, JSON.stringify({
                        targets: merged.targets,
                        intervalSeconds: merged.intervalSeconds,
                    }));
                } catch { /* ignore storage errors */ }
                return { ...s, pingMonitorState: merged };
            }
            return s;
        }));
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
        electronService.sendInput(sessionId, data);
    }, []);

    const toggleWatch = useCallback((sessionId: string, aiSessionId?: string) => {
        setSessions(prev => {
            const isTurningOn = !prev.find(s => s.id === sessionId)?.isWatching;
            const targetTitle = prev.find(s => s.id === sessionId)?.title ?? '';

            return prev.map(s => {
                if (s.id === sessionId) {
                    if (!isTurningOn) {
                        // Turning OFF
                        delete watchBuffers.current[sessionId];
                        watchingSessionIds.current.delete(sessionId);
                        hasWatchDataFlags.current.delete(sessionId);
                        return { ...s, isWatching: false, hasWatchData: false };
                    } else {
                        // Turning ON
                        if (!watchBuffers.current[sessionId]) {
                            watchBuffers.current[sessionId] = '';
                        }
                        watchingSessionIds.current.add(sessionId);
                        return { ...s, isWatching: true };
                    }
                } else if (isTurningOn && s.isWatching) {
                    // Turn OFF others if we are turning ON a new one
                    delete watchBuffers.current[s.id];
                    watchingSessionIds.current.delete(s.id);
                    hasWatchDataFlags.current.delete(s.id);
                    return { ...s, isWatching: false, hasWatchData: false };
                } else if (isTurningOn && aiSessionId && s.id === aiSessionId && s.aiChatState) {
                    // Update lastTargetSessionId in the same render to avoid flicker
                    return {
                        ...s,
                        aiChatState: {
                            ...s.aiChatState,
                            lastTargetSessionId: sessionId,
                            lastTargetSessionTitle: targetTitle,
                        }
                    };
                }
                return s;
            });
        });
    }, []);

    const getWatchBuffer = useCallback((sessionId: string) => {
        return watchBuffers.current[sessionId] || '';
    }, []);

    const clearWatchBuffer = useCallback((sessionId: string) => {
        delete watchBuffers.current[sessionId];
        hasWatchDataFlags.current.delete(sessionId);
        setSessions(currentSessions => {
            return currentSessions.map(s => s.id === sessionId ? { ...s, hasWatchData: false } : s);
        });
    }, []);

    return {
        sessions,
        tabOrder,
        terminalRegistry,
        textEditorRegistry,
        createSession,
        createAISession,
        createLogViewerSession,
        createPingMonitorSession,
        createTextEditorSession,
        createFileExplorerSession,
        updatePingMonitorState,
        updateTextEditorState,
        updateFileExplorerState,
        updateSessionState,
        closeSession,
        closeAllAISessions,
        handleTabReorder,
        handleTerminalData,
        toggleWatch,
        getWatchBuffer,
        clearWatchBuffer,
    };
}
