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
    onTabReorder: (fromIndex: number, toIndex: number) => void;
}

export const TabBar: React.FC<TabBarProps> = ({ tabs, activeTabId, visibleSessionIds, onTabClick, onTabClose, onNewTab, onTabReorder }) => {
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
