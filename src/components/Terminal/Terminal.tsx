import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import './Terminal.css';

interface TerminalProps {
    sessionId: string;
    onData?: (sessionId: string, data: string) => void;
    isActive: boolean;
    focusTrigger?: number;
    disableFocus?: boolean;
    fontSize: number;
    fontFamily: string;
    terminalForeground: string;
    terminalBackground: string;
}

export const TerminalComponentBase: React.FC<TerminalProps & { terminalInstance?: Terminal }> = ({
    sessionId,
    onData,
    isActive,
    focusTrigger,
    terminalInstance,
    disableFocus,
    fontSize,
    fontFamily,
    terminalForeground,
    terminalBackground
}) => {
    const terminalRef = useRef<HTMLDivElement>(null);
    const onDataRef = useRef(onData);

    useEffect(() => {
        onDataRef.current = onData;
    }, [onData]);

    // Initial Attach / Re-attach
    useEffect(() => {
        if (!terminalRef.current || !terminalInstance) return;

        const term = terminalInstance;

        // Open or Re-attach terminal
        const attachTerminal = () => {
            if (!terminalRef.current) return;

            const container = terminalRef.current;
            const fitAddon = (term as any)._fitAddon;

            console.log('[Terminal] Attaching xterm instance to div');

            try {
                if (!term.element) {
                    // First time: open normally
                    term.open(container);
                    console.log('[Terminal] Opened new xterm instance.');
                } else if (!term.element.isConnected || term.element.parentElement !== container) {
                    // Re-attach: move existing element to new container
                    // Clear the container first
                    while (container.firstChild) {
                        container.removeChild(container.firstChild);
                    }
                    container.appendChild(term.element);
                    console.log('[Terminal] Re-attached existing xterm element.');
                } else {
                    console.log('[Terminal] Already attached correctly.');
                }
            } catch (e) {
                console.error('[Terminal] Error in attach:', e);
            }

            // Force full canvas re-render after attachment
            const forceRedraw = () => {
                if (!container || container.clientWidth === 0 || container.clientHeight === 0) return false;

                try {
                    // Clear texture atlas to force glyph re-rendering
                    if (typeof term.clearTextureAtlas === 'function') {
                        term.clearTextureAtlas();
                    }

                    if (fitAddon) {
                        // Force resize cycle: change size then fit back to trigger canvas re-init
                        const cols = term.cols;
                        const rows = term.rows;
                        term.resize(Math.max(cols, 2) - 1, Math.max(rows, 2) - 1);
                        fitAddon.fit();

                        term.refresh(0, term.rows - 1);
                        term.scrollToBottom();

                        if (term.cols > 0 && term.rows > 0) {
                            window.electronAPI.resize(sessionId, term.cols, term.rows);
                        }
                    }

                    if (isActive && !disableFocus) term.focus();
                } catch (e) {
                    console.error('[Terminal] Redraw error:', e);
                }
                return true;
            };

            // Try immediately, then with increasing delays
            if (!forceRedraw()) {
                const retryDelays = [16, 50, 150, 300, 500];
                retryDelays.forEach(delay => {
                    setTimeout(() => forceRedraw(), delay);
                });
            } else {
                // Even if first attempt succeeded, retry once more for safety
                setTimeout(() => forceRedraw(), 100);
            }
        };

        requestAnimationFrame(attachTerminal);

        const handleResize = () => {
            if (terminalRef.current?.offsetParent) {
                const fitAddon = (term as any)._fitAddon;
                if (fitAddon) {
                    try {
                        fitAddon.fit();
                        // Refresh entire viewport to restore display after re-attach
                        term.refresh(0, term.rows - 1);
                        term.scrollToBottom();
                        if (term.cols > 0 && term.rows > 0) {
                            window.electronAPI.resize(sessionId, term.cols, term.rows);
                        }
                    } catch (e) {
                        console.error('[Terminal] Fit error:', e);
                    }
                }
            }
        };

        // Use ResizeObserver for robust layout handling
        const resizeObserver = new ResizeObserver(() => {
            // Debounce slightly or just call
            requestAnimationFrame(handleResize);
        });

        if (terminalRef.current) {
            resizeObserver.observe(terminalRef.current);
        }

        // Initial fit in case observer takes time
        setTimeout(handleResize, 50);

        return () => {
            console.log('[Terminal] Unmounting Component (Detaching xterm), Session:', sessionId);
            resizeObserver.disconnect();
            // Detach xterm element from container (don't dispose – terminal instance persists)
            if (term.element && term.element.parentElement) {
                term.element.parentElement.removeChild(term.element);
            }
        };
    }, [sessionId, terminalInstance, disableFocus]);

    // Handle Resizing / Focus
    useEffect(() => {
        if (terminalInstance) {
            if (isActive && !disableFocus) {
                terminalInstance.focus();
            }

            setTimeout(() => {
                const fitAddon = (terminalInstance as any)._fitAddon;
                if (fitAddon) {
                    fitAddon.fit();
                    try {
                        window.electronAPI.resize(sessionId, terminalInstance.cols, terminalInstance.rows);
                    } catch (e) { console.error(e); }
                }
            }, 50);
        }

    }, [isActive, sessionId, focusTrigger, terminalInstance, disableFocus]);

    // Update Font Settings
    useEffect(() => {
        if (terminalInstance) {
            if (fontSize) terminalInstance.options.fontSize = fontSize;
            if (fontFamily) terminalInstance.options.fontFamily = fontFamily;

            terminalInstance.options.theme = {
                ...terminalInstance.options.theme,
                foreground: terminalForeground,
                background: terminalBackground,
                cursor: terminalForeground,
                cursorAccent: terminalBackground
            };

            // Re-fit after font change
            setTimeout(() => {
                const fitAddon = (terminalInstance as any)._fitAddon;
                if (fitAddon) {
                    fitAddon.fit();
                    if (terminalInstance.cols > 0 && terminalInstance.rows > 0) {
                        try {
                            window.electronAPI.resize(sessionId, terminalInstance.cols, terminalInstance.rows);
                        } catch (e) { console.error(e); }
                    }
                }
            }, 10);
        }
    }, [terminalInstance, fontSize, fontFamily, terminalForeground, terminalBackground]);

    return (
        <div
            className="terminal-container"
            ref={terminalRef}
            style={{ display: 'block', height: '100%', width: '100%' }}
            onClick={() => {
                if (terminalInstance) terminalInstance.focus();
            }}
        />
    );
};

export const TerminalComponent = TerminalComponentBase;
