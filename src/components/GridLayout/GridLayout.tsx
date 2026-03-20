import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { TerminalComponent } from '../Terminal/Terminal';
import { AIChatPane } from '../AIChatPane/AIChatPane';
import { LogViewerPane } from '../LogViewerPane/LogViewerPane';
import type { Session } from '../../hooks/useSessionManager';
import type { InteractiveSessionTracking } from '../../hooks/useInteractiveFlow';
import type { Terminal } from '@xterm/xterm';
import { STORAGE_KEYS } from '../../constants/storage';
import { useSettingsStore } from '../../stores/settingsStore';
import { useShallow } from 'zustand/react/shallow';
import './GridLayout.css';

interface GridLayoutProps {
    rows: number;
    cols: number;
    sessions: Session[];
    updateSessionState: (sessionId: string, newState: Partial<Session['aiChatState']>) => void;
    paneAllocations: { [paneId: string]: string | null };
    activePaneId: string | null;
    onPaneClick: (paneId: string) => void;
    onDropSession: (sessionId: string, targetPaneId: string) => void;
    onData: (sessionId: string, data: string) => void;
    focusTrigger: number;
    disableFocus?: boolean;
    paneBackground: string | null;
    paneBackgroundMode: 'color' | 'image';
    paneBackgroundImage: string | null;
    onPasteRequest?: (text: string) => void;
    onRunCommand?: (targetId: string, command: string, aiSessionId: string) => void;
    onSendMessage?: (aiSessionId: string, text: string) => void;
    interactiveSessions?: { [sessionId: string]: InteractiveSessionTracking };
    onShowPromptMenu?: (aiSessionId: string) => void;
}

export const GridLayout: React.FC<GridLayoutProps & { terminalRegistry: { [id: string]: Terminal } }> = ({
    rows,
    cols,
    sessions,
    updateSessionState,
    paneAllocations,
    activePaneId,
    onPaneClick,
    onDropSession,
    onData,
    focusTrigger,
    terminalRegistry,
    disableFocus,
    paneBackground,
    paneBackgroundMode,
    paneBackgroundImage,
    onPasteRequest,
    onRunCommand,
    onSendMessage,
    interactiveSessions,
    onShowPromptMenu
}) => {
    const {
        fontSize,
        fontFamily,
        terminalForeground,
        terminalBackground,
        terminalBackgroundInactive,
        lineWrapEnabled,
        enablePromptHighlight,
        promptHighlightColor,
        promptPatterns,
        askAiCommands,
        showSystemPrompt,
        aiPersonas,
        proactiveInstruction,
    } = useSettingsStore(useShallow(s => ({
        fontSize: s.fontSize,
        fontFamily: s.fontFamily,
        terminalForeground: s.terminalForeground,
        terminalBackground: s.terminalBackground,
        terminalBackgroundInactive: s.terminalBackgroundInactive,
        lineWrapEnabled: s.lineWrapEnabled,
        enablePromptHighlight: s.enablePromptHighlight,
        promptHighlightColor: s.promptHighlightColor,
        promptPatterns: s.promptPatterns,
        askAiCommands: s.askAiCommands,
        showSystemPrompt: s.showSystemPrompt,
        aiPersonas: s.aiPersonas,
        proactiveInstruction: s.proactiveInstruction,
    })));

    // State to store track sizes (ratios). Initialized to 1 for all tracks.
    // State to store track sizes (ratios). Initialized to 1 for all tracks.
    const [colSizes, setColSizes] = useState<number[]>([]);
    const [rowSizes, setRowSizes] = useState<number[]>([]);
    const gridRef = useRef<HTMLDivElement>(null);

    // Initial setup & logic reset on dimension change
    useEffect(() => {
        // Try to load from localStorage first
        const savedCols = localStorage.getItem(STORAGE_KEYS.UI_GRID_COL_SIZES(cols));
        const savedRows = localStorage.getItem(STORAGE_KEYS.UI_GRID_ROW_SIZES(rows));

        if (savedCols) {
            try {
                setColSizes(JSON.parse(savedCols));
            } catch {
                setColSizes(new Array(cols).fill(1));
            }
        } else {
            setColSizes(new Array(cols).fill(1));
        }

        if (savedRows) {
            try {
                setRowSizes(JSON.parse(savedRows));
            } catch {
                setRowSizes(new Array(rows).fill(1));
            }
        } else {
            setRowSizes(new Array(rows).fill(1));
        }
    }, [rows, cols]);

    // Persist sizes when changed
    useEffect(() => {
        if (colSizes.length === cols && colSizes.length > 0) {
            localStorage.setItem(STORAGE_KEYS.UI_GRID_COL_SIZES(cols), JSON.stringify(colSizes));
        }
    }, [colSizes, cols]);

    useEffect(() => {
        if (rowSizes.length === rows && rowSizes.length > 0) {
            localStorage.setItem(STORAGE_KEYS.UI_GRID_ROW_SIZES(rows), JSON.stringify(rowSizes));
        }
    }, [rowSizes, rows]);

    // Resizing logic
    const resizingState = useRef<{
        type: 'col' | 'row' | 'both';
        index: number;
        rowIndex?: number;
        startPos: { x: number; y: number };
        startSizes: number[];
        startRowSizes?: number[];
        gridSize: { width: number; height: number };
    } | null>(null);

    const handleResizeStart = (e: React.MouseEvent, type: 'col' | 'row' | 'both', index: number, rowIndex?: number) => {
        e.preventDefault();
        e.stopPropagation();

        if (!gridRef.current) return;

        const rect = gridRef.current.getBoundingClientRect();
        // Calculate grid sizes
        const gridWidth = rect.width - (cols - 1) * 8;
        const gridHeight = rect.height - (rows - 1) * 8;

        const startSizesCol = [...colSizes];
        const startSizesRow = [...rowSizes];

        resizingState.current = {
            type,
            index,
            rowIndex,
            startPos: { x: e.clientX, y: e.clientY },
            startSizes: startSizesCol,
            startRowSizes: startSizesRow,
            gridSize: { width: gridWidth, height: gridHeight }
        };

        document.addEventListener('mousemove', handleResizeMove);
        document.addEventListener('mouseup', handleResizeEnd);

        if (type === 'col') document.body.style.cursor = 'col-resize';
        else if (type === 'row') document.body.style.cursor = 'row-resize';
        else document.body.style.cursor = 'move';
    };

    const resizeRafId = useRef<number | null>(null);

    const handleResizeMove = useCallback((e: MouseEvent) => {
        if (!resizingState.current) return;

        // Throttle with rAF — only process one mousemove per animation frame
        if (resizeRafId.current !== null) return;

        const clientX = e.clientX;
        const clientY = e.clientY;

        resizeRafId.current = requestAnimationFrame(() => {
            resizeRafId.current = null;
            if (!resizingState.current) return;

            const { type, index, rowIndex, startPos, startSizes, startRowSizes, gridSize } = resizingState.current;
            const minSize = 0.1;

            // Handle Column Resizing
            if (type === 'col' || type === 'both') {
                const deltaPx = clientX - startPos.x;
                const totalFr = startSizes.reduce((sum, val) => sum + val, 0);
                const deltaFr = (deltaPx * totalFr) / gridSize.width;

                const newSizes = [...startSizes];
                let sLeft = startSizes[index] + deltaFr;
                let sRight = startSizes[index + 1] - deltaFr;

                if (sLeft < minSize) {
                    sLeft = minSize;
                    sRight = startSizes[index] + startSizes[index + 1] - minSize;
                }
                if (sRight < minSize) {
                    sRight = minSize;
                    sLeft = startSizes[index] + startSizes[index + 1] - minSize;
                }

                newSizes[index] = sLeft;
                newSizes[index + 1] = sRight;
                setColSizes(newSizes);
            }

            // Handle Row Resizing
            if ((type === 'row' || type === 'both') && startRowSizes) {
                const rIndex = type === 'row' ? index : rowIndex!;

                const deltaPx = clientY - startPos.y;
                const totalFr = startRowSizes.reduce((sum, val) => sum + val, 0);
                const deltaFr = (deltaPx * totalFr) / gridSize.height;

                const newSizes = [...startRowSizes];
                let sTop = startRowSizes[rIndex] + deltaFr;
                let sBottom = startRowSizes[rIndex + 1] - deltaFr;

                if (sTop < minSize) {
                    sTop = minSize;
                    sBottom = startRowSizes[rIndex] + startRowSizes[rIndex + 1] - minSize;
                }
                if (sBottom < minSize) {
                    sBottom = minSize;
                    sTop = startRowSizes[rIndex] + startRowSizes[rIndex + 1] - minSize;
                }

                newSizes[rIndex] = sTop;
                newSizes[rIndex + 1] = sBottom;
                setRowSizes(newSizes);
            }
        });
    }, []);

    const handleResizeEnd = () => {
        resizingState.current = null;
        if (resizeRafId.current !== null) {
            cancelAnimationFrame(resizeRafId.current);
            resizeRafId.current = null;
        }
        document.removeEventListener('mousemove', handleResizeMove);
        document.removeEventListener('mouseup', handleResizeEnd);
        document.body.style.cursor = '';
    };

    // Construct grid template strings (memoized)
    const gridTemplateColumns = useMemo(() => colSizes.map(s => `minmax(0, ${s}fr)`).join(' 4px '), [colSizes]);
    const gridTemplateRows = useMemo(() => rowSizes.map(s => `minmax(0, ${s}fr)`).join(' 4px '), [rowSizes]);


    // Drag & Drop logic for Sessions
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }, []);

    const handleDrop = useCallback((e: React.DragEvent, paneId: string) => {
        e.preventDefault();
        const sessionId = e.dataTransfer.getData('text/plain');
        if (sessionId) {
            onDropSession(sessionId, paneId);
        }
    }, [onDropSession]);

    const renderPanes = () => {
        const elements: React.ReactNode[] = [];

        // Render content panes
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const paneIndex = r * cols + c;
                const paneId = paneIndex.toString();
                const assignedSessionId = paneAllocations[paneId];
                const session = sessions.find(s => s.id === assignedSessionId);
                const isActive = paneId === activePaneId;

                elements.push(
                    <div
                        key={`pane-${paneId}`}
                        data-pane-id={paneId}
                        className={`grid-pane ${isActive && session ? 'active-pane' : ''}`}
                        onClick={() => onPaneClick(paneId)}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, paneId)}
                        style={{
                            gridColumn: c * 2 + 1,
                            gridRow: r * 2 + 1,
                            backgroundColor: paneBackground || '#000000',
                            backgroundImage: paneBackgroundMode === 'image' ? `url("${paneBackgroundImage || ''}")` : 'none',
                            backgroundSize: paneBackgroundMode === 'image' ? 'auto' : 'auto',
                            backgroundRepeat: 'repeat',
                            backgroundPosition: 'center',
                            border: '1px solid var(--border-color)',
                            boxSizing: 'border-box',
                            position: 'relative'
                        }}

                    >
                        {session ? (
                            session.type === 'log-viewer' ? (
                                <LogViewerPane
                                    loggingPath={session.logViewerState?.loggingPath || ''}
                                />
                            ) : session.type === 'ai' ? (
                                <AIChatPane
                                    sessionId={session.id}
                                    initialState={session.aiChatState}
                                    onStateChange={(newState) => updateSessionState(session.id, newState)}
                                    showSystemPrompt={showSystemPrompt}
                                    askAiCommands={askAiCommands}
                                    aiPersonas={aiPersonas}
                                    fontSize={fontSize}
                                    terminalBackground={terminalBackground}
                                    terminalBackgroundInactive={terminalBackgroundInactive || undefined}
                                    proactiveInstruction={proactiveInstruction}
                                    interactiveSessionTracking={interactiveSessions ? Object.values(interactiveSessions).find((t) => t.aiSessionId === session.id) : undefined}
                                    onRunCommand={(targetId, command) => {
                                        if (onRunCommand) onRunCommand(targetId, command, session.id);
                                    }}
                                    onShowPromptMenu={() => {
                                        if (onShowPromptMenu) onShowPromptMenu(session.id);
                                    }}
                                    onSendMessage={(text) => {
                                        if (onSendMessage) onSendMessage(session.id, text);
                                    }}
                                />
                            ) : (
                                <TerminalComponent
                                    key={session.id}
                                    sessionId={session.id}
                                    onData={onData}
                                    isActive={isActive}
                                    focusTrigger={focusTrigger}
                                    terminalInstance={terminalRegistry[session.id]}
                                    disableFocus={disableFocus}
                                    fontSize={fontSize}
                                    fontFamily={fontFamily}
                                    terminalForeground={terminalForeground}
                                    terminalBackground={terminalBackground}
                                    terminalBackgroundInactive={terminalBackgroundInactive || undefined}
                                    lineWrapEnabled={lineWrapEnabled}
                                    askAiCommands={askAiCommands}
                                    enablePromptHighlight={enablePromptHighlight}
                                    promptHighlightColor={promptHighlightColor}
                                    promptPatterns={promptPatterns}
                                    onPasteRequest={onPasteRequest}
                                />
                            )
                        ) : (
                            <div className="empty-pane-placeholder">
                                <span className="pane-label">Pane {paneIndex + 1}</span>
                                <span className="drop-hint">Drop Tab Here</span>
                            </div>
                        )}
                    </div>
                );
            }
        }

        // Render Vertical Resizers (between columns)
        for (let c = 0; c < cols - 1; c++) {
            elements.push(
                <div
                    key={`resizer-v-${c}`}
                    className="grid-resizer-v"
                    onMouseDown={(e) => handleResizeStart(e, 'col', c)}
                    style={{
                        gridColumn: (c * 2) + 2, // 2, 4, 6...
                        gridRow: '1 / -1',       // Span all rows
                    }}
                />
            );
        }

        // Render Horizontal Resizers (between rows)
        for (let r = 0; r < rows - 1; r++) {
            elements.push(
                <div
                    key={`resizer-h-${r}`}
                    className="grid-resizer-h"
                    onMouseDown={(e) => handleResizeStart(e, 'row', r)}
                    style={{
                        gridColumn: '1 / -1',    // Span all cols
                        gridRow: (r * 2) + 2,    // 2, 4, 6...
                    }}
                />
            );
        }

        // Render Intersection Resizers (at junctions)
        for (let r = 0; r < rows - 1; r++) {
            for (let c = 0; c < cols - 1; c++) {
                elements.push(
                    <div
                        key={`resizer-x-${r}-${c}`}
                        className="grid-resizer-cross"
                        onMouseDown={(e) => handleResizeStart(e, 'both', c, r)}
                        style={{
                            gridColumn: (c * 2) + 2,
                            gridRow: (r * 2) + 2,
                        }}
                    />
                );
            }
        }

        return elements;
    };

    return (
        <div
            ref={gridRef}
            className="grid-layout"
            style={{
                display: 'grid',
                gridTemplateColumns,
                gridTemplateRows,
                height: '100%',
                width: '100%',
                gap: 0 // Reset gap as we handle it with resizers
            }}
        >
            {renderPanes()}
        </div>
    );
};
