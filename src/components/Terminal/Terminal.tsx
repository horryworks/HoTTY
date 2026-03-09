import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import type { PromptPattern } from '../../App';
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
    enablePromptHighlight?: boolean;
    promptHighlightColor?: string;
    promptPatterns?: PromptPattern[];
    onPasteRequest?: (text: string) => void;
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
    askGeminiCommands,
    enablePromptHighlight,
    promptHighlightColor,
    promptPatterns,
    onPasteRequest
}) => {
    const terminalRef = useRef<HTMLDivElement>(null);

    // Initial Attach / Re-attach
    useEffect(() => {
        if (!terminalRef.current || !terminalInstance) return;

        const term = terminalInstance;
        term.options.allowTransparency = true;

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
                        const proposed = fitAddon.proposeDimensions();
                        if (proposed) {
                            if (lineWrapEnabled) {
                                const offset = enablePromptHighlight ? 1 : 0;
                                const newCols = Math.max(proposed.cols - offset, 2);
                                term.resize(newCols, proposed.rows);
                            } else {
                                const newCols = Math.max(proposed.cols, 5000);
                                term.resize(newCols, proposed.rows);
                            }

                            term.refresh(0, term.rows - 1);
                            term.scrollToBottom();
                            if (term.cols > 0 && term.rows > 0) {
                                window.electronAPI.resize(sessionId, term.cols, term.rows);
                            }
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
                    const proposed = fitAddon.proposeDimensions();
                    if (proposed) {
                        if (lineWrapEnabled) {
                            const offset = enablePromptHighlight ? 1 : 0;
                            const newCols = Math.max(proposed.cols - offset, 2);
                            terminalInstance.resize(newCols, proposed.rows);
                        } else {
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
            const inactiveBg = terminalBackgroundInactive || terminalBackground;
            const effectiveBg = isActive ? activeBg : inactiveBg;

            // Convert hex to rgba for transparency if it's a hex color
            const getTransparentColor = (hex: string) => {
                if (hex.startsWith('#') && hex.length === 7) {
                    const r = parseInt(hex.slice(1, 3), 16);
                    const g = parseInt(hex.slice(3, 5), 16);
                    const b = parseInt(hex.slice(5, 7), 16);
                    return `rgba(${r}, ${g}, ${b}, 0.85)`;
                }
                return hex;
            };

            terminalInstance.options.theme = {
                ...terminalInstance.options.theme,
                foreground: terminalForeground,
                background: getTransparentColor(effectiveBg),
                cursor: terminalForeground,
                cursorAccent: effectiveBg
            };

            // Force refresh if needed (usually handled by xterm internally on options change, but let's be safe)
            // ... triggering resize/fit if necessary
            setTimeout(() => {
                const fitAddon = (terminalInstance as any)._fitAddon;
                if (fitAddon) {
                    const proposed = fitAddon.proposeDimensions();
                    if (proposed) {
                        if (lineWrapEnabled) {
                            const offset = enablePromptHighlight ? 1 : 0;
                            const newCols = Math.max(proposed.cols - offset, 2);
                            terminalInstance.resize(newCols, proposed.rows);
                        } else {
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

    // Prompt Highlighting Logic
    useEffect(() => {
        if (!terminalInstance || !enablePromptHighlight || !promptPatterns) return;

        const term = terminalInstance;
        let activeLines: { marker: any, decoration: any, isPrompt: boolean, element?: HTMLElement }[] = [];
        let lastClickedMarkerLine: number | null = null;

        const evaluateLine = (bufferY: number) => {
            const buffer = term.buffer.active;
            const line = buffer.getLine(bufferY);
            if (!line) return;

            // Trace back to the start of the logical line if this is wrapped
            let startLineY = bufferY;
            let currentLine = line;
            while (currentLine.isWrapped && startLineY > 0) {
                const prevLine = buffer.getLine(startLineY - 1);
                if (!prevLine) break;
                startLineY--;
                currentLine = prevLine;
            }

            const logicalStartLine = buffer.getLine(startLineY);
            if (!logicalStartLine) return;

            const startText = logicalStartLine.translateToString(true).trimRight();

            // Find existing decoration for this LOGICAL start line
            let existingIdx = -1;
            for (let i = activeLines.length - 1; i >= 0; i--) {
                const item = activeLines[i];
                if (!item.marker || item.marker.isDisposed) {
                    activeLines.splice(i, 1);
                    continue;
                }
                if (item.marker.line === startLineY) {
                    existingIdx = i;
                    break;
                }
            }

            const existing = existingIdx !== -1 ? activeLines[existingIdx] : null;



            let isPrompt = false;
            for (const patternObj of promptPatterns) {
                if (!patternObj.enabled || !patternObj.pattern) continue;
                try {
                    const regex = new RegExp(patternObj.pattern);
                    const match = regex.exec(startText);
                    if (match && match.index === 0) {
                        isPrompt = true;
                        break;
                    }
                } catch (e) { }
            }

            if (existing && existing.isPrompt === isPrompt) {
                return; // Nothing to change
            }

            if (existing) {
                if (existing.decoration) existing.decoration.dispose();
                if (existing.marker && !existing.marker.isDisposed) existing.marker.dispose();
                activeLines.splice(existingIdx, 1);
            }

            // Register new marker and decoration precisely at the LOGICAL start line
            const cursorYOffset = startLineY - (buffer.baseY + buffer.cursorY);
            const marker = term.registerMarker(cursorYOffset);
            if (!marker) return;

            const decoration = term.registerDecoration({
                marker,
                anchor: 'right',
                x: 0,
                width: 1 // xterm API expects columns.
            });

            if (decoration) {
                const trackObj = { marker, decoration, isPrompt, element: undefined as HTMLElement | undefined };
                activeLines.push(trackObj);

                decoration.onRender((element: HTMLElement) => {
                    trackObj.element = element;
                    const defaultPromptColor = promptHighlightColor && promptHighlightColor !== 'rgba(255, 255, 255, 0.15)' ? promptHighlightColor : '#f44336';
                    const targetColor = isPrompt ? defaultPromptColor : '#2196f3';

                    let count = 1;
                    let checkY = marker.line + 1;
                    while (checkY < term.buffer.active.length) {
                        const l = term.buffer.active.getLine(checkY);
                        if (l && l.isWrapped) { count++; checkY++; }
                        else break;
                    }

                    element.style.position = 'absolute';
                    element.style.right = '0px';
                    element.style.left = 'auto';
                    // Do not override height; xterm.js sets it exactly to the line height.
                    element.style.width = '8px';
                    element.style.backgroundColor = 'transparent';
                    element.style.borderRight = `6px solid ${targetColor}`;
                    element.style.pointerEvents = 'all'; // Allow user to click the marker
                    element.style.cursor = 'pointer';
                    element.style.zIndex = '10';
                    element.style.transformOrigin = 'top';
                    element.style.transform = `translateX(10px) scaleY(${count})`;

                    if (!element.dataset.clickEventBound) {
                        element.dataset.clickEventBound = "true";

                        element.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();

                            if (marker.isDisposed) return;
                            handleMarkerSelection(e, marker);
                        });

                        element.addEventListener('contextmenu', (e) => {
                            e.preventDefault();
                            e.stopPropagation();

                            if (marker.isDisposed) return;

                            // Select the text block
                            handleMarkerSelection(e, marker);

                            // Trigger context menu after a short delay to allow selection to register
                            setTimeout(() => {
                                const selection = term.getSelection();
                                if (selection) {
                                    window.electronAPI.showContextMenu(selection, askGeminiCommands);
                                }
                            }, 50);
                        });

                        const handleMarkerSelection = (e: MouseEvent, marker: any) => {

                            const currentLine = marker.line;

                            let startLine = currentLine;
                            let endLine = currentLine;

                            let upperBoundary = -1;
                            let lowerBoundary = Infinity;

                            if (e.shiftKey && lastClickedMarkerLine !== null) {
                                // Select range between last clicked marker block and this one block
                                const rangeTop = Math.min(lastClickedMarkerLine, currentLine);
                                const rangeBottom = Math.max(lastClickedMarkerLine, currentLine);

                                // Find bounds to capture the full marker block at the top and bottom edges
                                let topBoundary = -1; // Highest line we can go up without hitting a different marker
                                let bottomBoundary = Infinity; // Lowest line we can go down without hitting a different marker

                                // We need to determine the type (isPrompt) of the top marker and bottom marker
                                let topIsPrompt: boolean | null = null;
                                let bottomIsPrompt: boolean | null = null;

                                for (const item of activeLines) {
                                    if (item.marker && !item.marker.isDisposed) {
                                        if (item.marker.line === rangeTop) topIsPrompt = item.isPrompt;
                                        if (item.marker.line === rangeBottom) bottomIsPrompt = item.isPrompt;
                                    }
                                }

                                for (const item of activeLines) {
                                    if (item.marker && !item.marker.isDisposed) {
                                        const mLine = item.marker.line;

                                        // Bound top block
                                        if (topIsPrompt !== null && item.isPrompt !== topIsPrompt) {
                                            if (mLine < rangeTop && mLine > topBoundary) topBoundary = mLine;
                                        }

                                        // Bound bottom block
                                        if (bottomIsPrompt !== null && item.isPrompt !== bottomIsPrompt) {
                                            if (mLine > rangeBottom && mLine < bottomBoundary) bottomBoundary = mLine;
                                        }
                                    }
                                }

                                // We expand startLine downwards to the top marker block's topmost boundary limit,
                                startLine = rangeTop;
                                for (const item of activeLines) {
                                    if (item.marker && !item.marker.isDisposed && item.isPrompt === topIsPrompt) {
                                        const mLine = item.marker.line;
                                        if (mLine <= rangeTop && mLine > topBoundary && mLine < startLine) {
                                            startLine = mLine;
                                        }
                                    }
                                }

                                // We expand endLine upwards to the bottom marker block's bottommost boundary limit,
                                endLine = rangeBottom;
                                for (const item of activeLines) {
                                    if (item.marker && !item.marker.isDisposed && item.isPrompt === bottomIsPrompt) {
                                        const mLine = item.marker.line;
                                        if (mLine >= rangeBottom && mLine < bottomBoundary && mLine > endLine) {
                                            endLine = mLine;
                                        }
                                    }
                                }
                            } else {
                                // Normal click - select the contiguous block of the same type
                                for (const item of activeLines) {
                                    if (item.marker && !item.marker.isDisposed) {
                                        const mLine = item.marker.line;
                                        if (item.isPrompt !== isPrompt) {
                                            if (mLine < currentLine && mLine > upperBoundary) {
                                                upperBoundary = mLine;
                                            }
                                            if (mLine > currentLine && mLine < lowerBoundary) {
                                                lowerBoundary = mLine;
                                            }
                                        }
                                    }
                                }

                                for (const item of activeLines) {
                                    if (item.marker && !item.marker.isDisposed && item.isPrompt === isPrompt) {
                                        const mLine = item.marker.line;
                                        if (mLine > upperBoundary && mLine < lowerBoundary) {
                                            if (mLine < startLine) startLine = mLine;
                                            if (mLine > endLine) endLine = mLine;
                                        }
                                    }
                                }
                            }

                            // Update last clicked marker
                            lastClickedMarkerLine = currentLine;

                            // Prevent out of bounds
                            startLine = Math.max(0, startLine);

                            let expandedEndLine = endLine;
                            while (expandedEndLine + 1 < term.buffer.active.length) {
                                const l = term.buffer.active.getLine(expandedEndLine + 1);
                                if (l && l.isWrapped) { expandedEndLine++; }
                                else break;
                            }

                            endLine = Math.max(startLine, Math.min(expandedEndLine, term.buffer.active.length - 1));

                            term.selectLines(startLine, endLine);
                        };
                    }
                });

                decoration.onDispose(() => {
                    const idx = activeLines.indexOf(trackObj);
                    if (idx !== -1) activeLines.splice(idx, 1);
                });
            }
        };

        const onCursorMove = term.onCursorMove(() => {
            const buffer = term.buffer.active;
            const currentCursorY = buffer.baseY + buffer.cursorY;

            // 1. Evaluate the new cursor line
            evaluateLine(currentCursorY);

            // 2. Perform a sweep: re-evaluate any active markers that are at or below the cursor.
            // This guarantees that if the cursor moves UP, any garbage markers from empty output lines 
            // that were previously below the cursor (but are now left behind) are cleanly destroyed!
            for (let i = activeLines.length - 1; i >= 0; i--) {
                const item = activeLines[i];
                if (item.marker && !item.marker.isDisposed && item.marker.line >= currentCursorY) {
                    evaluateLine(item.marker.line);
                }
            }
        });

        const onLineFeed = term.onLineFeed(() => {
            const buffer = term.buffer.active;
            evaluateLine(buffer.baseY + buffer.cursorY - 1);
        });

        const onRender = term.onRender((e) => {
            // e.start and e.end are viewport row indices (0 to term.rows - 1)
            const buffer = term.buffer.active;

            // Re-evaluate the height of all active decorations on screen
            for (const item of activeLines) {
                if (item.marker && !item.marker.isDisposed && item.element) {
                    let count = 1;
                    let checkY = item.marker.line + 1;
                    while (checkY < buffer.length) {
                        const l = buffer.getLine(checkY);
                        if (l && l.isWrapped) { count++; checkY++; }
                        else break;
                    }
                    item.element.style.transform = `translateX(6px) scaleY(${count})`;
                }
            }

            for (let i = e.start; i <= e.end; i++) {
                // ydisp is not exposed in the TypeScript types for IBuffer but it exists
                const bufferY = (buffer as any).ydisp + i;
                if (bufferY >= 0 && bufferY < buffer.length) {
                    evaluateLine(bufferY);
                }
            }
        });

        // Ensure all lines are decorated immediately upon mount or once the terminal is opened
        let attachCheckInterval: any = null;
        const scanAllLines = () => {
            if (!term.buffer.active) return;
            // Scan through all lines available so far up to the cursor
            const maxLine = term.buffer.active.baseY + term.buffer.active.cursorY;
            for (let i = 0; i <= maxLine && i < term.buffer.active.length; i++) {
                evaluateLine(i);
            }
        };

        if (term.element) {
            scanAllLines();
        } else {
            // Wait for attachTerminal to call term.open(container)
            attachCheckInterval = setInterval(() => {
                if (term.element) {
                    scanAllLines();
                    clearInterval(attachCheckInterval);
                }
            }, 100);
        }

        return () => {
            onCursorMove.dispose();
            onLineFeed.dispose();
            onRender.dispose();
            if (attachCheckInterval) clearInterval(attachCheckInterval);
            activeLines.forEach(item => {
                if (item.decoration) item.decoration.dispose();
            });
            activeLines = [];
        };
    }, [terminalInstance, enablePromptHighlight, promptHighlightColor, promptPatterns]);

    useEffect(() => {
        if (!window.electronAPI.onTerminalContextPaste) return;
        const cleanup = window.electronAPI.onTerminalContextPaste(() => {
            if (terminalRef.current && terminalRef.current.contains(document.activeElement)) {
                navigator.clipboard.readText().then(text => {
                    if (text && onPasteRequest) onPasteRequest(text);
                }).catch(err => console.error('Clipboard error:', err));
            }
        });
        return cleanup;
    }, [onPasteRequest]);

    return (
        <div
            className="terminal-container"
            ref={terminalRef}
            style={{
                display: 'block',
                height: '100%',
                width: '100%',
                paddingRight: '0px',
                boxSizing: 'border-box',
                overflowX: lineWrapEnabled ? 'hidden' : 'auto', // Dynamic overflow
                overflowY: 'hidden' // Always hide vertical scrollbar of container, xterm handles it
            }}
            onClick={() => {
                if (terminalInstance) terminalInstance.focus();
            }}
            onContextMenu={(e) => {
                if (terminalInstance) {
                    terminalInstance.focus();
                    const selection = terminalInstance.getSelection();

                    let isOverSelection = false;

                    if (selection) {
                        // Check if click is actually over the selection rect
                        try {
                            const core = (terminalInstance as any)._core;
                            const mouseService = core?._mouseService || core?.mouseService; // Depending on xterm.js version

                            if (mouseService && typeof mouseService.getCoords === 'function') {
                                const coords = mouseService.getCoords(e.nativeEvent, terminalInstance.element, terminalInstance.cols, terminalInstance.rows, true);
                                const pos = terminalInstance.getSelectionPosition();

                                if (coords && pos) {
                                    // coords[0] is 1-based column (viewport), coords[1] is 1-based row (viewport)
                                    // pos.start/end x,y are 0-based buffer coordinates

                                    const clickX = coords[0] - 1;
                                    const clickY = coords[1] - 1 + terminalInstance.buffer.active.viewportY;

                                    if (clickY >= pos.start.y && clickY <= pos.end.y) {
                                        isOverSelection = true;
                                        // Refine X bounds for first and last line of selection
                                        if (clickY === pos.start.y && clickX < pos.start.x) isOverSelection = false;
                                        if (clickY === pos.end.y && clickX >= pos.end.x) isOverSelection = false;
                                    }
                                }
                            } else {
                                // Fallback: if we can't reliably determine coords, assume we are over selection if there is one
                                // Though typically the internal mouseService is accessible.
                                isOverSelection = true;
                            }
                        } catch (err) {
                            console.warn('[Terminal] Failed to calculate mouse coords against selection:', err);
                            isOverSelection = true; // Fallback
                        }
                    }

                    if (selection && isOverSelection) {
                        // Text is selected AND right-click is over it -> show context menu
                        window.electronAPI.showContextMenu(selection, askGeminiCommands);
                    } else {
                        // No text selected OR right-click is outside selection -> trigger paste
                        e.preventDefault();
                        navigator.clipboard.readText().then(text => {
                            if (text && onPasteRequest) onPasteRequest(text);
                        }).catch(err => console.error('Clipboard error:', err));
                    }
                }
            }}
        >
        </div>
    );
};

export const TerminalComponent = TerminalComponentBase;
