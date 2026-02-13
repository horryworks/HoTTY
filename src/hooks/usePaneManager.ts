import { useState, useEffect } from 'react';
import type { LayoutMode } from '../components/LayoutSelector/LayoutSelector';

/** グリッド寸法の計算 */
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
            const activeEntries = Object.entries(prev)
                .filter(([, v]) => v !== null)
                .sort((a, b) => parseInt(a[0]) - parseInt(b[0]));

            const hasOverflow = activeEntries.some(([k]) => parseInt(k) >= totalPanes);

            if (hasOverflow) {
                // "Head filling": Compact active sessions into available slots
                const next: { [key: string]: string | null } = {};
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
                // Standard resize (keep existing positions)
                const next = { ...prev };
                // Add missing keys
                for (let i = 0; i < totalPanes; i++) {
                    if (next[i.toString()] === undefined) {
                        next[i.toString()] = null;
                    }
                }
                // Remove excess keys
                Object.keys(next).forEach(key => {
                    if (parseInt(key) >= totalPanes) {
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

    /** タブをペインにドロップ（スワップ対応） */
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

    /** タブクリック：表示中ならそのペインをアクティブ化。非表示の場合は何もしない（D&Dで移動） */
    const handleTabClick = (sessionId: string) => {
        // 有効なペイン（現在の画面に表示中）のみを検索
        const existingPaneId = Object.keys(paneAllocations).find(
            paneId => paneAllocations[paneId] === sessionId && parseInt(paneId) < totalPanes
        );

        if (existingPaneId) {
            setActivePaneId(existingPaneId);
        }
        // 非表示タブはクリックしても移動しない（D&Dでのみ移動可能）
    };

    /** 現在のレイアウトで有効なペインに表示中のセッションID一覧 */
    const totalPanes = currentDims.rows * currentDims.cols;
    const visibleSessionIds = Object.entries(paneAllocations)
        .filter(([paneId, sessionId]) => sessionId !== null && parseInt(paneId) < totalPanes)
        .map(([, sessionId]) => sessionId as string);

    /** アクティブペインのセッションID */
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
