import { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

export interface Session {
    id: string;
    title: string;
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
    } = options;

    const [sessions, setSessions] = useState<Session[]>([]);
    const [tabOrder, setTabOrder] = useState<string[]>([]);
    const terminalRegistry = useRef<{ [sessionId: string]: Terminal }>({});

    // Terminal instance factory
    const createTerminalInstance = (sessionId: string) => {
        const term = new Terminal({
            cursorBlink: true,
            fontSize: 14,
            fontFamily: 'Consolas, "Courier New", monospace',
            disableStdin: false,
            theme: { background: '#1e1e1e', foreground: '#ffffff' },
            allowProposedApi: true,
        });

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

        // Paste interception (Ctrl+V)
        term.attachCustomKeyEventHandler((event) => {
            if (event.ctrlKey && event.key === 'v' && event.type === 'keydown') {
                event.preventDefault();
                event.stopPropagation();
                navigator.clipboard.readText().then(text => {
                    if (text) onPasteRequest(sessionId, text);
                }).catch(err => console.error('Clipboard error:', err));
                return false;
            }
            return true;
        });

        // User input → backend
        term.onData((data) => {
            window.electronAPI.sendInput(sessionId, data);
        });

        return term;
    };

    // Global session data dispatcher
    useEffect(() => {
        const removeDataListener = window.electronAPI.onSessionData((id, data) => {
            const term = terminalRegistry.current[id];
            if (term) {
                term.write(data);
            }
        });
        return () => removeDataListener();
    }, []);

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
            onSessionError(`Session error occurred:\n${error}\n\nThe session will now be closed.`);
            closeSession(sessionId);
        });

        return () => {
            removeStatusListener();
            removeErrorListener();
        };
    }, []);

    const createSession = (config: any) => {
        const sessionId = self.crypto.randomUUID();
        let title: string;
        if (config.protocol === 'serial') {
            title = `Serial ${config.path} (${config.baudRate || 9600})`;
        } else {
            title = `${config.protocol === 'telnet' ? 'Telnet' : 'SSH'} ${config.host}`;
        }
        const newSession: Session = { id: sessionId, title };

        terminalRegistry.current[sessionId] = createTerminalInstance(sessionId);

        setSessions(prev => [...prev, newSession]);
        setTabOrder(prev => [...prev, sessionId]);

        // 有効ペイン内で空きを探す。なければ非表示（赤タブ）として開く
        setPaneAllocations(prev => {
            const next = { ...prev };
            const validPanes = Object.keys(next)
                .filter(p => !isNaN(parseInt(p)))
                .sort((a, b) => parseInt(a) - parseInt(b));
            const firstEmpty = validPanes.find(p => next[p] === null);

            if (firstEmpty) {
                next[firstEmpty] = sessionId;
                setActivePaneId(firstEmpty);
            }
            // 空きがなければペインに割り当てない（赤タブとして表示）

            return next;
        });

        const fullConfig = {
            ...config,
            encoding: globalEncoding,
            keepaliveInterval: sshKeepAliveEnabled ? sshKeepAliveInterval * 1000 : 0
        };
        window.electronAPI.connectSession(sessionId, fullConfig);
    };

    const closeSession = (sessionId: string) => {
        window.electronAPI.disconnectSession(sessionId);

        const term = terminalRegistry.current[sessionId];
        if (term) {
            term.dispose();
            delete terminalRegistry.current[sessionId];
        }

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

    return {
        sessions,
        tabOrder,
        terminalRegistry,
        createSession,
        closeSession,
        handleTabReorder,
        handleTerminalData,
    };
}
