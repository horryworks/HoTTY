import React from 'react';
import './TabBar.css';

interface Tab {
    id: string;
    title: string;
}

interface TabBarProps {
    tabs: Tab[];
    activeTabId: string | null;
    visibleSessionIds: string[]; // NEW PROP
    onTabClick: (id: string) => void;
    onTabClose: (id: string) => void;
    onNewTab: () => void;
    onNewAITab: () => void;
    onTabReorder: (fromIndex: number, toIndex: number) => void;
}

export const TabBar: React.FC<TabBarProps> = ({ tabs, activeTabId, visibleSessionIds, onTabClick, onTabClose, onNewTab, onNewAITab, onTabReorder }) => {
    const [dragOverInfo, setDragOverInfo] = React.useState<{ id: string, position: 'left' | 'right' } | null>(null);
    const [dragSourceIndex, setDragSourceIndex] = React.useState<number | null>(null);

    // ... (rest of drag handlers same as before) ...
    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number, sessionId: string) => {
        setDragSourceIndex(index);
        e.dataTransfer.setData('text/plain', sessionId);
        e.dataTransfer.setData('application/json', JSON.stringify({ index }));
        e.dataTransfer.effectAllowed = 'move';
        e.currentTarget.style.opacity = '0.5';
    };

    const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
        e.currentTarget.style.opacity = '1';
        setDragOverInfo(null);
        setDragSourceIndex(null);
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>, id: string) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        const rect = e.currentTarget.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        const position = e.clientX < midX ? 'left' : 'right';

        if (dragOverInfo?.id !== id || dragOverInfo?.position !== position) {
            setDragOverInfo({ id, position });
        }
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>, targetIndex: number) => {
        e.preventDefault();
        setDragOverInfo(null);

        let draggedIndex = -1;

        // Try getting index from text/plain (legacy/if sessionId is numeric?)
        const draggedIndexStr = e.dataTransfer.getData('text/plain');
        const parsed = parseInt(draggedIndexStr, 10);

        if (!isNaN(parsed)) {
            draggedIndex = parsed;
        } else if (dragSourceIndex !== null) {
            // Use state-tracked index (works for UUID sessions)
            draggedIndex = dragSourceIndex;
        }

        if (draggedIndex === -1) return;
        if (draggedIndex === targetIndex) return;

        let finalIndex = targetIndex;
        if (dragOverInfo?.position === 'right') {
            finalIndex = targetIndex + 1;
        }

        // Adjustment for removal
        if (draggedIndex < finalIndex) {
            finalIndex--;
        }

        if (draggedIndex !== finalIndex) {
            onTabReorder(draggedIndex, finalIndex);
        }
    };

    return (
        <div className="tab-bar" onMouseLeave={() => setDragOverInfo(null)}>
            <div className="ai-tab-btn" onClick={onNewAITab} title="AI Chat">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M16 3C16.8 6.4 19.4 9 22.8 10C24.4 10.4 24.4 12.6 22.8 13C19.4 14 16.8 16.6 16 20C15.6 21.6 13.4 21.6 13 20C12.2 16.6 9.6 14 6.2 13C4.6 12.6 4.6 10.4 6.2 10C9.6 9 12.2 6.4 13 3C13.4 1.4 15.6 1.4 16 3Z" fill="url(#gemini-gradient)" />
                    <defs>
                        <linearGradient id="gemini-gradient" x1="4" y1="3" x2="25" y2="22" gradientUnits="userSpaceOnUse">
                            <stop offset="0%" stopColor="#4E86F8" />
                            <stop offset="100%" stopColor="#D64669" />
                        </linearGradient>
                    </defs>
                </svg>
            </div>
            {tabs.map((tab, index) => {
                const isHidden = !visibleSessionIds.includes(tab.id);
                const isActivePane = activeTabId === tab.id;
                return (
                    <div
                        key={tab.id}
                        data-session-id={tab.id}
                        className={`tab ${activeTabId === tab.id ? 'active' : ''} ${isHidden ? 'hidden-tab' : ''} ${isActivePane ? 'active-pane-tab' : ''} ${dragOverInfo?.id === tab.id ? `drag-over-${dragOverInfo.position}` : ''
                            }`}
                        onClick={() => onTabClick(tab.id)}
                        draggable
                        onDragStart={(e) => handleDragStart(e, index, tab.id)}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => handleDragOver(e, tab.id)}
                        onDrop={(e) => handleDrop(e, index)}
                    >
                        <span className="tab-title">{tab.title}</span>
                        <div
                            className="tab-close"
                            onClick={(e) => {
                                e.stopPropagation();
                                onTabClose(tab.id);
                            }}
                        >
                            x
                        </div>
                    </div>
                )
            })}
            <div className="new-tab-btn" onClick={onNewTab} title="New Tab">+</div>
        </div>
    );
};
