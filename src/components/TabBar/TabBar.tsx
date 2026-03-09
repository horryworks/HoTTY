import React from 'react';
import './TabBar.css';

interface Tab {
    id: string;
    title: string;
    type?: 'ssh' | 'telnet' | 'serial' | 'ai' | 'wsl' | 'local';
    aiChatState?: any;
}

interface TabBarProps {
    tabs: Tab[];
    activeTabId: string | null;
    visibleSessionIds: string[]; // NEW PROP
    watchedSessionIds?: string[];
    nonEmptyBufferSessionIds?: string[];
    onTabClick: (id: string) => void;
    onTabClose: (id: string) => void;
    onToggleWatch?: (id: string) => void;
    onAskGeminiTab?: (id: string) => void;
    onNewTab: () => void;
    onNewAITab: () => void;
    onTabReorder: (fromIndex: number, toIndex: number) => void;
    lastTargetSessionId?: string | null;
}

export const TabBar: React.FC<TabBarProps> = ({ tabs, activeTabId, visibleSessionIds, watchedSessionIds = [], nonEmptyBufferSessionIds = [], onTabClick, onTabClose, onToggleWatch, onAskGeminiTab, onNewTab, onNewAITab, onTabReorder, lastTargetSessionId }) => {
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

        // Try getting index from application/json payload
        try {
            const data = e.dataTransfer.getData('application/json');
            if (data) {
                const parsed = JSON.parse(data);
                if (typeof parsed.index === 'number') {
                    draggedIndex = parsed.index;
                }
            }
        } catch (err) {
            // fallback to state
        }

        if (draggedIndex === -1 && dragSourceIndex !== null) {
            // Use state-tracked index (very reliable for internal drops)
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
                    <path d="M13.5 3.5C14.3 6.9 16.9 9.5 20.3 10.5C21.9 10.9 21.9 13.1 20.3 13.5C16.9 14.5 14.3 17.1 13.5 20.5C13.1 22.1 10.9 22.1 10.5 20.5C9.7 17.1 7.1 14.5 3.7 13.5C2.1 13.1 2.1 10.9 3.7 10.5C7.1 9.5 9.7 6.9 10.5 3.5C10.9 1.9 13.1 1.9 13.5 3.5Z" fill="url(#gemini-gradient)" />
                    <defs>
                        <linearGradient id="gemini-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#4E86F8" />
                            <stop offset="100%" stopColor="#D64669" />
                        </linearGradient>
                    </defs>
                </svg>
            </div>
            {tabs.map((tab, index) => {
                const isHidden = !visibleSessionIds.includes(tab.id);
                const isActivePane = activeTabId === tab.id;
                const isWatching = watchedSessionIds.includes(tab.id);
                // AI tab always shows rainbow bar. Terminal tab shows it if watching OR explicitly linked from AI session.
                const isGeminiLinked = tab.type === 'ai' || isWatching || tab.id === lastTargetSessionId;

                // Determine if this is a terminal capable of being watched
                const isTerminal = tab.type ? tab.type !== 'ai' :
                    (tab.id.startsWith('ssh') || tab.id.startsWith('telnet') || tab.id.startsWith('wsl') || tab.id.startsWith('serial') || tab.id.startsWith('local'));

                return (
                    <div
                        key={tab.id}
                        data-session-id={tab.id}
                        className={`tab ${activeTabId === tab.id ? 'active' : ''} ${isHidden ? 'hidden-tab' : ''} ${isActivePane ? 'active-pane-tab' : ''} ${dragOverInfo?.id === tab.id ? `drag-over-${dragOverInfo.position}` : ''
                            } ${isWatching ? 'watching-tab' : ''} ${isGeminiLinked ? 'gemini-linked-tab' : ''} ${tab.type === 'ai' ? 'is-ai-tab' : ''}`}
                        onClick={() => onTabClick(tab.id)}
                        draggable
                        onDragStart={(e) => handleDragStart(e, index, tab.id)}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => handleDragOver(e, tab.id)}
                        onDrop={(e) => handleDrop(e, index)}
                    >
                        <span className="tab-title">{tab.title}</span>
                        <div className="tab-actions" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            {isTerminal && onToggleWatch && (
                                <div
                                    className={`tab-watch-btn ${isWatching ? 'watching' : ''}`}
                                    title={isWatching ? "Stop Watching" : "Start Watching"}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onToggleWatch(tab.id);
                                    }}
                                    style={{
                                        cursor: 'pointer',
                                        width: '12px',
                                        height: '12px',
                                        color: isWatching ? '#ff0000' : 'var(--text-color)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}
                                >
                                    {isWatching ? (
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                            <circle cx="12" cy="12" r="3"></circle>
                                        </svg>
                                    ) : (
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                                            <line x1="1" y1="1" x2="23" y2="23"></line>
                                        </svg>
                                    )}
                                </div>
                            )}
                            {isWatching && onAskGeminiTab && (
                                <div
                                    className={`tab-ask-btn ${!nonEmptyBufferSessionIds.includes(tab.id) ? 'disabled' : ''}`}
                                    title={nonEmptyBufferSessionIds.includes(tab.id) ? "Ask Gemini about Watched Output" : "No output recorded yet"}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (nonEmptyBufferSessionIds.includes(tab.id)) {
                                            onAskGeminiTab(tab.id);
                                        }
                                    }}
                                    style={{
                                        cursor: nonEmptyBufferSessionIds.includes(tab.id) ? 'pointer' : 'not-allowed',
                                        fontSize: '12px',
                                        marginLeft: '2px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        opacity: nonEmptyBufferSessionIds.includes(tab.id) ? 0.9 : 0.3,
                                        filter: nonEmptyBufferSessionIds.includes(tab.id) ? 'none' : 'grayscale(1)'
                                    }}
                                >
                                    ✨
                                </div>
                            )}
                            <div
                                className="tab-close"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onTabClose(tab.id);
                                }}
                            >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                </svg>
                            </div>
                        </div>
                    </div>
                )
            })}
            <div className="new-tab-btn" onClick={onNewTab} title="New Tab">+</div>
        </div>
    );
};
