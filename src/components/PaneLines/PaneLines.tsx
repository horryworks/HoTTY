import React, { useState, useEffect, useCallback, useId } from 'react';
import './PaneLines.css';

interface PaneLinesProps {
    paneAllocations: { [paneId: string]: string | null };
    totalPanes: number;
    visible: boolean;
    showLeftSidebar?: boolean;
    showRightSidebar?: boolean;
    showTopBar?: boolean;
    showBottomBar?: boolean;
}

interface LineData {
    id: string;
    sessionId: string;
    paneId: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color: string;
}

const COLORS = [
    '#007acc', // blue
    '#4ec9b0', // teal
    '#ce9178', // orange
    '#c586c0', // purple
    '#dcdcaa', // yellow
    '#9cdcfe', // light blue
];

export const PaneLines: React.FC<PaneLinesProps> = ({
    paneAllocations,
    totalPanes,
    visible,
    showLeftSidebar,
    showRightSidebar,
    showTopBar,
    showBottomBar,
}) => {
    const [lines, setLines] = useState<LineData[]>([]);
    const baseId = useId(); // Unique ID for this component instance

    const computeLines = useCallback(() => {
        if (!visible) {
            setLines([]);
            return;
        }

        try {
            const newLines: LineData[] = [];
            let colorIndex = 0;

            Object.entries(paneAllocations).forEach(([paneId, sessionId]) => {
                if (!sessionId) return;

                // Safety check: ensure paneId is within valid range for current layout
                const validNonNumericIds = ['sidebar-left', 'sidebar', 'top-bar', 'bottom-bar'];
                const pId = parseInt(paneId);
                if ((isNaN(pId) || pId >= totalPanes) && !validNonNumericIds.includes(paneId)) return;

                // Find the tab element
                const tabEl = document.querySelector(`[data-session-id="${sessionId}"]`);
                // Find the pane element
                const paneEl = document.querySelector(`[data-pane-id="${paneId}"]`);

                if (tabEl && paneEl) {
                    const tabRect = tabEl.getBoundingClientRect();
                    const paneRect = paneEl.getBoundingClientRect();

                    // Ensure valid dimensions
                    if (tabRect.width > 0 && tabRect.height > 0 && paneRect.width > 0 && paneRect.height > 0) {
                        newLines.push({
                            id: `${sessionId}-${paneId}`,
                            sessionId,
                            paneId,
                            x1: tabRect.left + tabRect.width / 2,
                            y1: tabRect.bottom,
                            x2: paneRect.left + paneRect.width / 2,
                            y2: paneRect.top + paneRect.height / 2,
                            color: COLORS[colorIndex % COLORS.length],
                        });
                        colorIndex++;
                    }
                }
            });

            setLines(newLines);
        } catch (e) {
            console.error("Error computing pane lines:", e);
            setLines([]); // Fallback to empty lines on error
        }
    }, [paneAllocations, totalPanes, visible, showLeftSidebar, showRightSidebar, showTopBar, showBottomBar]);

    useEffect(() => {
        // Initial compute
        let animationFrameId: number;

        const update = () => {
            computeLines();
        };

        // Defer effectively to next frame to ensure DOM layout is settled
        animationFrameId = requestAnimationFrame(update);

        window.addEventListener('resize', update);
        return () => {
            window.removeEventListener('resize', update);
            cancelAnimationFrame(animationFrameId);
        };
    }, [computeLines]);

    if (!visible || lines.length === 0) return null;

    return (
        <svg className="pane-lines-overlay" style={{ pointerEvents: 'none', position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: 9999 }}>
            <defs>
                {lines.map((line) => (
                    <marker
                        key={`arrow-${line.id}`}
                        id={`arrowhead-${baseId}-${line.id}`}
                        markerWidth="8"
                        markerHeight="6"
                        refX="8"
                        refY="3"
                        orient="auto"
                    >
                        <polygon
                            points="0 0, 8 3, 0 6"
                            fill={line.color}
                        />
                    </marker>
                ))}
            </defs>
            {lines.map((line) => {
                const midY = (line.y1 + line.y2) / 2;
                // Check for NaN to be extra safe
                if (isNaN(line.x1) || isNaN(line.y1) || isNaN(line.x2) || isNaN(line.y2)) return null;

                const d = `M ${line.x1} ${line.y1} Q ${line.x1} ${midY}, ${line.x2} ${line.y2}`;
                const markerUrl = `url(#arrowhead-${baseId}-${line.id})`;

                return (
                    <path
                        key={`line-${line.id}`}
                        d={d}
                        stroke={line.color}
                        strokeWidth="2"
                        fill="none"
                        strokeDasharray="6 3"
                        markerEnd={markerUrl}
                        opacity="0.8"
                    />
                );
            })}
        </svg>
    );
};
