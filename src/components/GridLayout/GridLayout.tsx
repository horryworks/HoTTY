import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TerminalComponent } from '../Terminal/Terminal';
import { AIChatPane } from '../AIChatPane/AIChatPane';
import type { Session } from '../../hooks/useSessionManager';
import './GridLayout.css';

interface GridLayoutProps {
    rows: number;
    cols: number;
    sessions: Session[];
    updateSessionState: (sessionId: string, newState: any) => void;
    paneAllocations: { [paneId: string]: string | null };
    activePaneId: string | null;
    onPaneClick: (paneId: string) => void;
    onDropSession: (sessionId: string, targetPaneId: string) => void;
    onData: (sessionId: string, data: string) => void;
    focusTrigger: number;
    disableFocus?: boolean;
    fontSize: number;
    fontFamily: string;
    terminalForeground: string;
    terminalBackground: string;
    terminalBackgroundInactive?: string | null;
    paneBackground: string | null;
    paneBackgroundMode: 'color' | 'image';
    paneBackgroundImage: string | null;
    lineWrapEnabled: boolean;
    showSystemPrompt: boolean;
    askGeminiCommands: { id: string; label: string; promptTemplate: string }[];
    aiPersonas: { id: string; label: string; systemPrompt: string }[];
}

export const GridLayout: React.FC<GridLayoutProps & { terminalRegistry: { [id: string]: any } }> = ({
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
    fontSize,
    fontFamily,
    terminalForeground,
    terminalBackground,
    terminalBackgroundInactive,
    paneBackground,
    paneBackgroundMode,
    paneBackgroundImage,
    lineWrapEnabled,
    showSystemPrompt,
    askGeminiCommands,
    aiPersonas
}) => {
    // State to store track sizes (ratios). Initialized to 1 for all tracks.
    const [colSizes, setColSizes] = useState<number[]>([]);
    const [rowSizes, setRowSizes] = useState<number[]>([]);
    const gridRef = useRef<HTMLDivElement>(null);

    // Initial setup & logic reset on dimension change
    useEffect(() => {
        setColSizes(new Array(cols).fill(1));
        setRowSizes(new Array(rows).fill(1));
    }, [rows, cols]);

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

    const handleResizeMove = useCallback((e: MouseEvent) => {
        if (!resizingState.current) return;

        const { type, index, rowIndex, startPos, startSizes, startRowSizes, gridSize } = resizingState.current;
        const minSize = 0.1;

        // Handle Column Resizing
        if (type === 'col' || type === 'both') {
            const currentPos = e.clientX;
            const deltaPx = currentPos - startPos.x;
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
            // For 'row', index is the row index. For 'both', rowIndex is the row index.
            const rIndex = type === 'row' ? index : rowIndex!;

            const currentPos = e.clientY;
            const deltaPx = currentPos - startPos.y;
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
    }, []);

    const handleResizeEnd = () => {
        resizingState.current = null;
        document.removeEventListener('mousemove', handleResizeMove);
        document.removeEventListener('mouseup', handleResizeEnd);
        document.body.style.cursor = '';
    };

    // Construct grid template strings
    const gridTemplateColumns = colSizes.map(s => `minmax(0, ${s}fr)`).join(' 8px ');
    const gridTemplateRows = rowSizes.map(s => `minmax(0, ${s}fr)`).join(' 8px ');

    // Drag & Drop logic for Sessions
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = (e: React.DragEvent, paneId: string) => {
        e.preventDefault();
        const sessionId = e.dataTransfer.getData('text/plain');
        if (sessionId) {
            onDropSession(sessionId, paneId);
        }
    };

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
                            backgroundColor: paneBackground || '#000200',
                            backgroundImage: paneBackgroundMode === 'image' ? `url("${paneBackgroundImage || '/bg-cyberspace.svg'}")` : 'none',
                            backgroundSize: (paneBackgroundMode === 'image' && (!paneBackgroundImage || paneBackgroundImage.includes('bg-cyberspace.svg'))) ? '40px 40px' : 'cover',
                            backgroundRepeat: 'repeat',
                            backgroundPosition: 'center',
                            borderRight: '1px solid var(--border-color)',
                            borderBottom: '1px solid var(--border-color)',
                            boxSizing: 'border-box',
                            position: 'relative'
                        }}
                    >
                        {session ? (
                            session.type === 'ai' ? (
                                <AIChatPane
                                    sessionId={session.id}
                                    initialState={session.aiChatState}
                                    onStateChange={(newState) => updateSessionState(session.id, newState)}
                                    showSystemPrompt={showSystemPrompt}
                                    askGeminiCommands={askGeminiCommands}
                                    aiPersonas={aiPersonas}
                                    fontSize={fontSize}
                                    terminalBackground={terminalBackground}
                                    terminalBackgroundInactive={terminalBackgroundInactive || undefined}
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
                                    askGeminiCommands={askGeminiCommands}
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
