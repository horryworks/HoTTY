import React from 'react';
import type { Session } from '../../hooks/useSessionManager';
import { useSettingsStore } from '../../stores/settingsStore';
import './TabBar.css';

interface Tab {
    id: string;
    title: string;
    type?: 'ssh' | 'telnet' | 'serial' | 'ai' | 'wsl' | 'local' | 'log-viewer' | 'ping-monitor' | 'text-editor' | 'file-explorer';
    aiChatState?: Session['aiChatState'];
}

const NON_TERMINAL_TYPES = new Set<Tab['type']>(['ai', 'log-viewer', 'ping-monitor', 'text-editor', 'file-explorer']);

interface TabBarProps {
    tabs: Tab[];
    activeTabId: string | null;
    visibleSessionIds: string[]; // NEW PROP
    watchedSessionIds?: string[];
    onTabClick: (id: string) => void;
    onTabClose: (id: string) => void;
    onToggleWatch?: (id: string) => void;
    onNewTab: () => void;
    onNewAITab: () => void;
    onNewLogViewer: () => void;
    onNewPingMonitor: () => void;
    onNewTextEditor: () => void;
    onNewFileExplorer: () => void;
    onTabReorder: (fromIndex: number, toIndex: number) => void;
    lastTargetSessionId?: string | null;
}

export const TabBar: React.FC<TabBarProps> = ({ tabs, activeTabId, visibleSessionIds, watchedSessionIds = [], onTabClick, onTabClose, onToggleWatch, onNewTab, onNewAITab, onNewLogViewer, onNewPingMonitor, onNewTextEditor, onNewFileExplorer, onTabReorder, lastTargetSessionId }) => {
    const enabledFeatures = useSettingsStore(s => s.enabledFeatures);
    const [dragOverInfo, setDragOverInfo] = React.useState<{ id: string, position: 'left' | 'right' } | null>(null);
    const [dragSourceIndex, setDragSourceIndex] = React.useState<number | null>(null);
    const [showFeaturesMenu, setShowFeaturesMenu] = React.useState(false);
    const [dropdownStyle, setDropdownStyle] = React.useState<React.CSSProperties>({});
    const featuresRef = React.useRef<HTMLDivElement>(null);
    const [tooltip, setTooltip] = React.useState<{ text: string; left: number; top: number } | null>(null);
    const tooltipRef = React.useRef<HTMLDivElement>(null);

    // Clamp tooltip position so it doesn't overflow the viewport
    React.useEffect(() => {
        if (!tooltip || !tooltipRef.current) return;
        const el = tooltipRef.current;
        const tipRect = el.getBoundingClientRect();
        const margin = 4;
        let adjustedLeft = tooltip.left;
        if (tipRect.left < margin) {
            adjustedLeft = tipRect.width / 2 + margin;
        } else if (tipRect.right > window.innerWidth - margin) {
            adjustedLeft = window.innerWidth - margin - tipRect.width / 2;
        }
        if (adjustedLeft !== tooltip.left) {
            setTooltip(prev => prev ? { ...prev, left: adjustedLeft } : null);
        }
    }, [tooltip]);

    // Clear tooltip when tabs change (e.g., tab closed externally)
    React.useEffect(() => {
        setTooltip(null);
    }, [tabs.length]);

    const handleTabMouseEnter = (e: React.MouseEvent<HTMLDivElement>, title: string) => {
        const titleEl = e.currentTarget.querySelector('.tab-title') as HTMLElement | null;
        if (titleEl && titleEl.scrollWidth > titleEl.clientWidth) {
            const rect = e.currentTarget.getBoundingClientRect();
            setTooltip({
                text: title,
                left: rect.left + rect.width / 2,
                top: rect.bottom + 4,
            });
        }
    };

    const handleTabMouseLeave = () => {
        setTooltip(null);
    };

    React.useEffect(() => {
        if (!showFeaturesMenu) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (featuresRef.current && !featuresRef.current.contains(e.target as Node)) {
                setShowFeaturesMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showFeaturesMenu]);

    const handleToggleFeaturesMenu = () => {
        if (!showFeaturesMenu && featuresRef.current) {
            const rect = featuresRef.current.getBoundingClientRect();
            const dropdownWidth = 140;
            const spaceOnRight = window.innerWidth - rect.left;
            if (spaceOnRight >= dropdownWidth) {
                setDropdownStyle({ left: 0, right: 'auto' });
            } else {
                setDropdownStyle({ right: 0, left: 'auto' });
            }
        }
        setShowFeaturesMenu(v => !v);
    };

    // ... (rest of drag handlers same as before) ...
    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number, sessionId: string) => {
        setDragSourceIndex(index);
        e.dataTransfer.setData('text/plain', sessionId);
        e.dataTransfer.setData('application/json', JSON.stringify({ index }));
        e.dataTransfer.effectAllowed = 'move';
        e.currentTarget.style.opacity = '0.4';
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
        } catch {
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
        <div className="tab-bar">
            <div className="tab-list" onMouseLeave={() => setDragOverInfo(null)}>
            {tabs.map((tab, index) => {
                const isHidden = !visibleSessionIds.includes(tab.id);
                const isActivePane = activeTabId === tab.id;
                const isWatching = watchedSessionIds.includes(tab.id);
                // AI tab always shows rainbow bar. Terminal tab shows it if watching OR explicitly linked from AI session.
                const isGeminiLinked = tab.type === 'ai' || isWatching || tab.id === lastTargetSessionId;

                const isTerminal = tab.type
                    ? !NON_TERMINAL_TYPES.has(tab.type)
                    : (tab.id.startsWith('ssh') || tab.id.startsWith('telnet') || tab.id.startsWith('wsl') || tab.id.startsWith('serial') || tab.id.startsWith('local'));

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
                        onMouseEnter={(e) => handleTabMouseEnter(e, tab.title)}
                        onMouseLeave={handleTabMouseLeave}
                    >
                        <span className="tab-title">{tab.title}</span>
                        <div className="tab-actions" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            {isTerminal && onToggleWatch && (
                                <div
                                    className={`tab-watch-btn ${isWatching ? 'watching' : ''}`}
                                    title={isWatching ? "AI Monitor (Active)" : "Monitor with AI"}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onToggleWatch(tab.id);
                                    }}
                                    style={{
                                        cursor: 'pointer',
                                        width: '14px',
                                        height: '14px',
                                        color: isWatching ? 'var(--tab-watching-text, #4E86F8)' : 'var(--tab-text)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        position: 'relative'
                                    }}
                                >
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={`ai-icon-svg ${isWatching ? 'pulse' : ''}`}>
                                        <circle cx="12" cy="12" r="10" fill={isWatching ? "url(#ai-glow-gradient)" : "currentColor"} opacity={isWatching ? "1" : "0.7"} />
                                        <circle cx="12" cy="12" r="6" fill={isWatching ? "var(--tab-watching-bg, #E0FFE0)" : "currentColor"} opacity={isWatching ? "0.9" : "0.4"} />
                                        <defs>
                                            <linearGradient id="ai-glow-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                                <stop offset="0%" stopColor="var(--tab-watching-icon, #00FF80)" />
                                                <stop offset="100%" stopColor="var(--tab-watching-icon-glow, #00D1FF)" />
                                            </linearGradient>
                                        </defs>
                                    </svg>
                                </div>
                            )}
                            <div
                                className="tab-close"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setTooltip(null);
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
            </div>{/* end .tab-list */}

            <div className="tab-bar-actions">
            {/* New Session button — Cable loop icon */}
            <div className="new-tab-btn" onClick={onNewTab} title="New Session">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 3a8 8 0 0 1 8 7.2" />
                    <rect x="16" y="12" width="6" height="8" rx="1" />
                    <path d="M19 12V10" />
                    <line x1="12" y1="8" x2="12" y2="14" />
                    <line x1="9" y1="11" x2="15" y2="11" />
                </svg>
            </div>

            {/* Features button — 2×2 grid icon */}
            {Object.values(enabledFeatures).some(Boolean) && (
            <div className="features-btn" ref={featuresRef} title="Features">
                <div
                    className={`features-btn-icon ${showFeaturesMenu ? 'active' : ''}`}
                    onClick={handleToggleFeaturesMenu}
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="7" height="7" rx="1"/>
                        <rect x="14" y="3" width="7" height="7" rx="1"/>
                        <rect x="3" y="14" width="7" height="7" rx="1"/>
                        <rect x="14" y="14" width="7" height="7" rx="1"/>
                    </svg>
                </div>
                {showFeaturesMenu && (
                    <div className="features-dropdown" style={dropdownStyle}>
                        {enabledFeatures['ai-chat'] && (
                        <div
                            className="features-item"
                            onClick={() => { onNewAITab(); setShowFeaturesMenu(false); }}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <circle cx="12" cy="12" r="10" fill="url(#feat-ai-gradient)" />
                                <circle cx="12" cy="12" r="6" fill="var(--tab-watching-bg, #E0FFE0)" opacity="0.9" />
                                <defs>
                                    <linearGradient id="feat-ai-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                        <stop offset="0%" stopColor="var(--tab-watching-icon, #00FF80)" />
                                        <stop offset="100%" stopColor="var(--tab-watching-icon-glow, #00D1FF)" />
                                    </linearGradient>
                                </defs>
                            </svg>
                            AI Chat
                        </div>
                        )}
                        {enabledFeatures['log-viewer'] && (
                        <div
                            className="features-item"
                            onClick={() => { onNewLogViewer(); setShowFeaturesMenu(false); }}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                <polyline points="14 2 14 8 20 8"/>
                                <line x1="8" y1="13" x2="16" y2="13"/>
                                <line x1="8" y1="17" x2="14" y2="17"/>
                            </svg>
                            Log Viewer
                        </div>
                        )}
                        {enabledFeatures['ping-monitor'] && (
                        <div
                            className="features-item"
                            onClick={() => { onNewPingMonitor(); setShowFeaturesMenu(false); }}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10"/>
                                <polyline points="12 6 12 12 16 14"/>
                            </svg>
                            Ping Monitor
                        </div>
                        )}
                        {enabledFeatures['text-editor'] && (
                        <div
                            className="features-item"
                            onClick={() => { onNewTextEditor(); setShowFeaturesMenu(false); }}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                            Text Editor
                        </div>
                        )}
                        {enabledFeatures['file-explorer'] && (
                        <div
                            className="features-item"
                            onClick={() => { onNewFileExplorer(); setShowFeaturesMenu(false); }}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                                <line x1="9" y1="14" x2="15" y2="14" />
                            </svg>
                            File Explorer
                        </div>
                        )}
                    </div>
                )}
            </div>
            )}
            </div>{/* end .tab-bar-actions */}
            {tooltip && (
                <div
                    ref={tooltipRef}
                    className="tab-tooltip"
                    style={{ left: tooltip.left, top: tooltip.top }}
                >
                    {tooltip.text}
                </div>
            )}
        </div>
    );
};
