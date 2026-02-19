import { useState, useEffect } from 'react';
import type { LayoutMode } from '../components/LayoutSelector/LayoutSelector';

/** Calculate grid dimensions */
function getGridDimensions(mode: LayoutMode) {
    switch (mode) {
        case '1x1': return { rows: 1, cols: 1 };
        case '1x2': return { rows: 1, cols: 2 };
        case '2x1': return { rows: 2, cols: 1 };
        case '2x2': return { rows: 2, cols: 2 };
        case '2x3': return { rows: 2, cols: 3 };
        case '3x2': return { rows: 3, cols: 2 };
        default: return { rows: 1, cols: 1 };
    }
}

export function usePaneManager() {
    const [layoutMode, setLayoutMode] = useState<LayoutMode>('1x1');
    const [activePaneId, setActivePaneId] = useState<string>('0');
    const [paneAllocations, setPaneAllocations] = useState<{ [paneId: string]: string | null }>({ '0': null });

    const currentDims = getGridDimensions(layoutMode);

    // Sync pane slots when layout changes
    useEffect(() => {
        const totalPanes = currentDims.rows * currentDims.cols;
        setPaneAllocations(prev => {
            // Check for active sessions that would be lost
            // Filter out 'sidebar' or other non-numeric keys from grid logic
            const activeEntries = Object.entries(prev)
                .filter(([k, v]) => v !== null && !isNaN(parseInt(k)))
                .sort((a, b) => parseInt(a[0]) - parseInt(b[0]));

            const hasOverflow = activeEntries.some(([k]) => parseInt(k) >= totalPanes);


            if (hasOverflow) {
                // "Head filling": Compact active sessions into available slots
                const next: { [key: string]: string | null } = {};

                // Preserve non-numeric keys (sidebars)
                Object.keys(prev).forEach(key => {
                    if (isNaN(parseInt(key))) {
                        next[key] = prev[key];
                    }
                });

                for (let i = 0; i < totalPanes; i++) {
                    // Start with explicit nulls
                    next[i.toString()] = null;
                }

                // Fill with active sessions up to capacity
                activeEntries.slice(0, totalPanes).forEach((([_, sessionId], index) => {
                    next[index.toString()] = sessionId;
                }));
                return next;
            } else {

                const next = { ...prev };
                // Add missing keys
                for (let i = 0; i < totalPanes; i++) {
                    if (next[i.toString()] === undefined) {
                        next[i.toString()] = null;
                    }
                }
                // Remove excess numeric keys
                Object.keys(next).forEach(key => {
                    const keyNum = parseInt(key);
                    if (!isNaN(keyNum) && keyNum >= totalPanes) {
                        delete next[key];
                    }
                });
                return next;
            }

        });

        if (parseInt(activePaneId) >= totalPanes) {
            setActivePaneId('0');
        }
    }, [layoutMode, currentDims.rows, currentDims.cols]);

    /** Drop tab onto pane (supports swapping) */
    const handleDropSession = (sessionId: string, targetPaneId: string) => {
        setPaneAllocations(prev => {
            const next = { ...prev };
            const oldPaneId = Object.keys(next).find(pid => next[pid] === sessionId);

            if (oldPaneId) next[oldPaneId] = null;

            if (next[targetPaneId]) {
                const swappedSession = next[targetPaneId];
                if (oldPaneId) next[oldPaneId] = swappedSession;
            }

            next[targetPaneId] = sessionId;
            return next;
        });
        setActivePaneId(targetPaneId);
    };

    /** Tab click: Activate the pane if visible. If not visible, do nothing (move via D&D) */
    const handleTabClick = (sessionId: string) => {
        // Search only for valid panes (currently visible on screen)
        const existingPaneId = Object.keys(paneAllocations).find(
            paneId => paneAllocations[paneId] === sessionId && (paneId === 'sidebar' || parseInt(paneId) < totalPanes)
        );


        if (existingPaneId) {
            setActivePaneId(existingPaneId);
        }
        // Hidden tabs do not move on click (can only be moved via D&D)
    };

    /** List of session IDs currently displayed in valid panes for the current layout */
    const totalPanes = currentDims.rows * currentDims.cols;
    const visibleSessionIds = Object.entries(paneAllocations)
        .filter(([paneId, sessionId]) => sessionId !== null && (paneId === 'sidebar' || parseInt(paneId) < totalPanes))
        .map(([, sessionId]) => sessionId as string);


    /** Session ID of the active pane */
    const activeSessionId = paneAllocations[activePaneId] || null;

    return {
        layoutMode,
        setLayoutMode,
        activePaneId,
        setActivePaneId,
        paneAllocations,
        setPaneAllocations,
        currentDims,
        handleDropSession,
        handleTabClick,
        visibleSessionIds,
        activeSessionId,
    };
}
