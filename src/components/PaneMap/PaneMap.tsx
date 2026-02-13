import React from 'react';
import './PaneMap.css';

interface PaneMapProps {
    sessions: { id: string; title: string }[];
    tabOrder: string[];
    paneAllocations: { [paneId: string]: string | null };
    activePaneId: string | null;
    totalPanes: number;
}

export const PaneMap: React.FC<PaneMapProps> = ({
    sessions,
    tabOrder,
    paneAllocations,
    activePaneId,
    totalPanes,
}) => {
    if (sessions.length === 0) return null;

    // Build reverse map: sessionId → paneId (valid panes only)
    const sessionToPane: { [sessionId: string]: string } = {};
    Object.entries(paneAllocations).forEach(([paneId, sessionId]) => {
        if (sessionId && parseInt(paneId) < totalPanes) {
            sessionToPane[sessionId] = paneId;
        }
    });

    // Use tabOrder to maintain consistent ordering
    const orderedSessions = tabOrder
        .map(id => sessions.find(s => s.id === id))
        .filter((s): s is { id: string; title: string } => !!s);

    return (
        <div className="pane-map">
            <div className="pane-map-label">Map</div>
            <div className="pane-map-list">
                {orderedSessions.map((session, index) => {
                    const paneId = sessionToPane[session.id];
                    const isVisible = paneId !== undefined;
                    const isActive = paneId === activePaneId;
                    const tabNum = index + 1;
                    const paneNum = isVisible ? parseInt(paneId) + 1 : null;

                    return (
                        <div
                            key={session.id}
                            className={`pane-map-item ${isActive ? 'active' : ''} ${!isVisible ? 'hidden-item' : ''}`}
                            title={`${session.title} → ${isVisible ? `Pane ${paneNum}` : 'Hidden'}`}
                        >
                            <span className="map-tab-num">{tabNum}</span>
                            <span className="map-arrow">{isVisible ? '→' : '×'}</span>
                            <span className={`map-pane-num ${isVisible ? '' : 'no-pane'}`}>
                                {isVisible ? paneNum : '-'}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
