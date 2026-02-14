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
    terminalBackgroundInactive?: string;
    lineWrapEnabled: boolean;
    askGeminiCommands?: { id: string; label: string; promptTemplate: string }[];
}

export const TerminalComponentBase: React.FC<TerminalProps & { terminalInstance?: Terminal }> = ({
    sessionId,
    isActive,
    focusTrigger,
    terminalInstance,
    disableFocus,
    fontSize,
    fontFamily,
    terminalForeground,
    terminalBackground,
    terminalBackgroundInactive,
    lineWrapEnabled,
    askGeminiCommands
}) => {
    const terminalRef = useRef<HTMLDivElement>(null);
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

            // Set overflow based on line wrapping
            container.style.overflowX = lineWrapEnabled ? 'hidden' : 'auto';

            try {
                // ... (existing attach logic)
                if (!term.element) {
                    term.open(container);
                } else if (!term.element.isConnected || term.element.parentElement !== container) {
                    while (container.firstChild) container.removeChild(container.firstChild);
                    container.appendChild(term.element);
                }
            } catch (e) {
                console.error('[Terminal] Error in attach:', e);
            }

            // Force full canvas re-render
            const forceRedraw = () => {
                if (!container || container.clientWidth === 0 || container.clientHeight === 0) return false;

                try {
                    if (typeof term.clearTextureAtlas === 'function') {
                        term.clearTextureAtlas();
                    }

                    if (fitAddon) {
                        if (lineWrapEnabled) {
                            // Normal Wrap Mode: Just Fit
                            const cols = term.cols;
                            const rows = term.rows;
                            // Force resize to trigger re-render
                            term.resize(Math.max(cols, 2) - 1, Math.max(rows, 2) - 1);
                            fitAddon.fit();
                        } else {
                            // No Wrap Mode: Horizontal Scrollbar
                            const proposed = fitAddon.proposeDimensions();
                            if (proposed) {
                                // Keep proposed rows (height fit), enforce huge cols
                                const newCols = Math.max(proposed.cols, 5000);
                                term.resize(newCols, proposed.rows);
                            }
                        }

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

            // ... (retry logic)
            if (!forceRedraw()) {
                const retryDelays = [16, 50, 150];
                retryDelays.forEach(delay => setTimeout(() => forceRedraw(), delay));
            } else {
                setTimeout(() => forceRedraw(), 100);
            }
        };

        requestAnimationFrame(attachTerminal);

        const handleResize = () => {
            if (terminalRef.current?.offsetParent) {
                const fitAddon = (term as any)._fitAddon;
                if (fitAddon) {
                    try {
                        if (lineWrapEnabled) {
                            fitAddon.fit();
                        } else {
                            const proposed = fitAddon.proposeDimensions();
                            if (proposed) {
                                const newCols = Math.max(proposed.cols, 5000);
                                term.resize(newCols, proposed.rows);
                            }
                        }

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

        const resizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(handleResize);
        });

        if (terminalRef.current) {
            resizeObserver.observe(terminalRef.current);
        }

        setTimeout(handleResize, 50);

        return () => {
            console.log('[Terminal] Unmounting Component', sessionId);
            resizeObserver.disconnect();
            if (term.element && term.element.parentElement) {
                term.element.parentElement.removeChild(term.element);
            }
        };
    }, [sessionId, terminalInstance, disableFocus, lineWrapEnabled]); // Added lineWrapEnabled dependency

    // Handle Resizing / Focus
    useEffect(() => {
        if (terminalInstance) {
            if (isActive && !disableFocus) {
                terminalInstance.focus();
            }

            setTimeout(() => {
                const fitAddon = (terminalInstance as any)._fitAddon;
                if (fitAddon) {
                    if (lineWrapEnabled) {
                        fitAddon.fit();
                    } else {
                        const proposed = fitAddon.proposeDimensions();
                        if (proposed) {
                            const newCols = Math.max(proposed.cols, 5000);
                            terminalInstance.resize(newCols, proposed.rows);
                        }
                    }
                    try {
                        window.electronAPI.resize(sessionId, terminalInstance.cols, terminalInstance.rows);
                    } catch (e) { console.error(e); }
                }
            }, 50);
        }
    }, [isActive, sessionId, focusTrigger, terminalInstance, disableFocus, lineWrapEnabled]);

    // Update Font & Theme Settings
    useEffect(() => {
        if (terminalInstance) {
            if (fontSize) terminalInstance.options.fontSize = fontSize;
            if (fontFamily) terminalInstance.options.fontFamily = fontFamily;

            const activeBg = terminalBackground;
            const inactiveBg = terminalBackgroundInactive || terminalBackground; // Fallback if not provided
            const effectiveBg = isActive ? activeBg : inactiveBg;

            terminalInstance.options.theme = {
                ...terminalInstance.options.theme,
                foreground: terminalForeground,
                background: effectiveBg,
                cursor: terminalForeground,
                cursorAccent: effectiveBg
            };

            // Force refresh if needed (usually handled by xterm internally on options change, but let's be safe)
            // ... triggering resize/fit if necessary
            setTimeout(() => {
                const fitAddon = (terminalInstance as any)._fitAddon;
                if (fitAddon) {
                    if (lineWrapEnabled) {
                        fitAddon.fit();
                    } else {
                        const proposed = fitAddon.proposeDimensions();
                        if (proposed) {
                            const newCols = Math.max(proposed.cols, 5000);
                            terminalInstance.resize(newCols, proposed.rows);
                        }
                    }
                    if (terminalInstance.cols > 0 && terminalInstance.rows > 0) {
                        try {
                            window.electronAPI.resize(sessionId, terminalInstance.cols, terminalInstance.rows);
                        } catch (e) { console.error(e); }
                    }
                }
            }, 10);
        }
    }, [terminalInstance, fontSize, fontFamily, terminalForeground, terminalBackground, terminalBackgroundInactive, isActive, lineWrapEnabled]);

    return (
        <div
            className="terminal-container"
            ref={terminalRef}
            style={{
                display: 'block',
                height: '100%',
                width: '100%',
                overflowX: lineWrapEnabled ? 'hidden' : 'auto', // Dynamic overflow
                overflowY: 'hidden' // Always hide vertical scrollbar of container, xterm handles it
            }}
            onClick={() => {
                if (terminalInstance) terminalInstance.focus();
            }}
            onContextMenu={() => {
                if (terminalInstance) {
                    const selection = terminalInstance.getSelection();
                    window.electronAPI.showContextMenu(selection, askGeminiCommands);
                }
            }}
        />
    );
};

export const TerminalComponent = TerminalComponentBase;
