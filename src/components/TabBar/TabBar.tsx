import { useState, useEffect, useRef } from 'react';
import { type TabItem } from './tabBarHelpers';
import './TabBar.css';

interface TabBarProps {
  tabItems: TabItem[];
  activeTabId: string | null;
  visibleTabIds: string[];
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onToggleWatch?: (id: string) => void;
  onSaveToHostTree?: (id: string) => void;
  onNewLogViewer?: () => void;
  onNewPingMonitor?: () => void;
  onNewTextEditor?: () => void;
  onNewFileExplorer?: () => void;
  onNewAiChat?: () => void;
}

type DragOverSide = 'left' | 'right' | null;

interface ContextMenuState {
  sessionId: string;
  x: number;
  y: number;
}

export function TabBar({
  tabItems,
  activeTabId,
  visibleTabIds,
  onSelect,
  onClose,
  onNew,
  onReorder,
  onToggleWatch,
  onSaveToHostTree,
  onNewLogViewer,
  onNewPingMonitor,
  onNewTextEditor,
  onNewFileExplorer,
  onNewAiChat,
}: TabBarProps) {
  const [dragSourceIndex, setDragSourceIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragOverSide, setDragOverSide] = useState<DragOverSide>(null);
  const [showFeaturesMenu, setShowFeaturesMenu] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const featuresRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const visibleSet = new Set(visibleTabIds);

  const hasAnyFeatureCallback =
    onNewLogViewer || onNewPingMonitor || onNewTextEditor || onNewFileExplorer || onNewAiChat;

  // Close features menu on click outside
  useEffect(() => {
    if (!showFeaturesMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (featuresRef.current && !featuresRef.current.contains(e.target as Node)) {
        setShowFeaturesMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showFeaturesMenu]);

  // Close tab context menu on outside click or Esc
  useEffect(() => {
    if (!contextMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [contextMenu]);

  const handleDragStart = (index: number, itemId: string) => (e: React.DragEvent) => {
    setDragSourceIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-hotty-session', itemId);
    e.dataTransfer.setData('text/plain', itemId);
  };

  const handleDragOver = (index: number) => (e: React.DragEvent) => {
    if (dragSourceIndex === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const side: DragOverSide = e.clientX - rect.left < rect.width / 2 ? 'left' : 'right';
    setDragOverIndex(index);
    setDragOverSide(side);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
    setDragOverSide(null);
  };

  const handleDrop = (index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragSourceIndex === null) return;
    let target = index;
    if (dragOverSide === 'right') target = index + 1;
    if (target > dragSourceIndex) target -= 1;
    if (target !== dragSourceIndex) onReorder(dragSourceIndex, target);
    setDragSourceIndex(null);
    setDragOverIndex(null);
    setDragOverSide(null);
  };

  const handleDragEnd = () => {
    setDragSourceIndex(null);
    setDragOverIndex(null);
    setDragOverSide(null);
  };

  return (
    <div className="tab-bar">
      <div className="tab-list">
        {tabItems.map((item, i) => {
          const isActive = item.id === activeTabId;
          const isHidden = !visibleSet.has(item.id);
          const dragOverCls =
            dragOverIndex === i && dragOverSide
              ? ` drag-over-${dragOverSide}`
              : '';
          return (
            <div
              key={item.id}
              data-session-id={item.id}
              draggable
              className={`tab${isActive ? ' active active-pane-tab' : ''}${
                item.status === 'error' ? ' error' : ''
              }${item.status === 'connecting' ? ' connecting' : ''}${
                isHidden ? ' hidden-tab' : ''
              }${dragOverCls}${
                item.isWatching ? ' gemini-linked-tab' : ''
              }${item.isAiTab ? ' is-ai-tab' : ''}`}
              onClick={() => onSelect(item.id)}
              onContextMenu={(e) => {
                if (
                  item.kind !== 'session' ||
                  !onSaveToHostTree ||
                  (item.protocol !== 'ssh' && item.protocol !== 'telnet')
                ) {
                  return;
                }
                e.preventDefault();
                e.stopPropagation();
                setContextMenu({ sessionId: item.id, x: e.clientX, y: e.clientY });
              }}
              onDragStart={handleDragStart(i, item.id)}
              onDragOver={handleDragOver(i)}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop(i)}
              onDragEnd={handleDragEnd}
              title={item.errorMessage ?? item.displayName}
            >
              <span className="tab-label">{item.displayName}</span>
              {item.kind === 'session' && onToggleWatch && (
                <button
                  type="button"
                  className={`tab-watch-btn${item.isWatching ? ' watching' : ''}`}
                  title={item.isWatching ? 'AI Monitor (Active)' : 'Monitor with AI'}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleWatch(item.id);
                  }}
                  aria-label={item.isWatching ? 'Stop AI monitoring' : 'Start AI monitoring'}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10"
                      fill={item.isWatching ? 'url(#ai-glow-gradient)' : 'currentColor'}
                      opacity={item.isWatching ? 1 : 0.7} />
                    <circle cx="12" cy="12" r="6"
                      fill={item.isWatching ? 'var(--accent-light, #42a5f5)' : 'currentColor'}
                      opacity={item.isWatching ? 0.9 : 0.4} />
                    <defs>
                      <linearGradient id="ai-glow-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="var(--success-color, #4ade80)" />
                        <stop offset="100%" stopColor="var(--accent-color, #007acc)" />
                      </linearGradient>
                    </defs>
                  </svg>
                </button>
              )}
              <button
                type="button"
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(item.id);
                }}
                aria-label="Close tab"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <div className="new-tab-btn" onClick={onNew} title="New Session" role="button" tabIndex={0}>
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 3a8 8 0 0 1 8 7.2" />
          <rect x="16" y="12" width="6" height="8" rx="1" />
          <path d="M19 12V10" />
          <line x1="12" y1="8" x2="12" y2="14" />
          <line x1="9" y1="11" x2="15" y2="11" />
        </svg>
      </div>

      {/* Features dropdown */}
      {hasAnyFeatureCallback && (
        <div className="features-btn" ref={featuresRef}>
          <div
            className={`features-btn-icon${showFeaturesMenu ? ' active' : ''}`}
            onClick={() => setShowFeaturesMenu((v) => !v)}
            title="Features"
            role="button"
            tabIndex={0}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </div>
          {showFeaturesMenu && (
            <div className="features-dropdown">
              {onNewLogViewer && (
                <div
                  className="features-dropdown-item"
                  onClick={() => { onNewLogViewer(); setShowFeaturesMenu(false); }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="8" y1="13" x2="16" y2="13" />
                    <line x1="8" y1="17" x2="14" y2="17" />
                  </svg>
                  Log Viewer
                </div>
              )}
              {onNewPingMonitor && (
                <div
                  className="features-dropdown-item"
                  onClick={() => { onNewPingMonitor(); setShowFeaturesMenu(false); }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  Ping Monitor
                </div>
              )}
              {onNewTextEditor && (
                <div
                  className="features-dropdown-item"
                  onClick={() => { onNewTextEditor(); setShowFeaturesMenu(false); }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  Text Editor
                </div>
              )}
              {onNewFileExplorer && (
                <div
                  className="features-dropdown-item"
                  onClick={() => { onNewFileExplorer(); setShowFeaturesMenu(false); }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  File Explorer
                </div>
              )}
              {onNewAiChat && (
                <div
                  className="features-dropdown-item"
                  onClick={() => { onNewAiChat(); setShowFeaturesMenu(false); }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L14.8 9.2L22 12L14.8 14.8L12 22L9.2 14.8L2 12L9.2 9.2L12 2Z" />
                  </svg>
                  AI Chat
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {contextMenu && onSaveToHostTree && (
        <div
          ref={contextMenuRef}
          className="tab-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          role="menu"
        >
          <div
            className="tab-context-menu-item"
            role="menuitem"
            onClick={() => {
              onSaveToHostTree(contextMenu.sessionId);
              setContextMenu(null);
            }}
          >
            Save to Host Tree…
          </div>
        </div>
      )}
    </div>
  );
}
