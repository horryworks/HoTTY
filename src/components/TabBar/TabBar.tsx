import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiOverlayStore } from '../../stores/uiOverlayStore';
import { type TabItem, type ConversationSummary } from './tabBarHelpers';
import { conversationColorVar } from '../../utils/conversationColor';
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
  /** AI Chat conversations (of the singleton pane) for the "Watch in ▸" picker. */
  conversations?: ConversationSummary[];
  /** Route a terminal into a specific conversation (or 'new'); single-owner move. */
  onWatchInConversation?: (sessionId: string, target: string | 'new') => void;
  onSaveToHostTree?: (id: string) => void;
  onToggleFixedSize?: (id: string) => void;
  onBookmark?: (id: string) => void;
  onNewLogViewer?: () => void;
  onNewPingMonitor?: () => void;
  onNewFileServer?: () => void;
  onNewAiChat?: () => void;
}

type DragOverSide = 'left' | 'right' | null;

interface ContextMenuState {
  tabId: string;
  kind: 'session' | 'feature';
  isWebBrowser: boolean;
  isSshOrTelnet: boolean;
  isWatching: boolean;
  fixedSize: boolean;
  /** Pinned width, if known (connect-time pty cols). Undefined hides the toggle. */
  ptyCols?: number;
  x: number;
  y: number;
}

interface WatchMenuState {
  /** Terminal session the "Watch in ▸" picker is acting on. */
  sessionId: string;
  /** The conversation tab currently watching it, if any (marked as owner). */
  ownerTabId?: string;
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
  conversations = [],
  onWatchInConversation,
  onSaveToHostTree,
  onToggleFixedSize,
  onBookmark,
  onNewLogViewer,
  onNewPingMonitor,
  onNewFileServer,
  onNewAiChat,
}: TabBarProps) {
  const { t } = useTranslation();
  const [dragSourceIndex, setDragSourceIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragOverSide, setDragOverSide] = useState<DragOverSide>(null);
  const [showFeaturesMenu, setShowFeaturesMenu] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [watchMenu, setWatchMenu] = useState<WatchMenuState | null>(null);
  const featuresRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const watchMenuRef = useRef<HTMLDivElement>(null);

  const visibleSet = new Set(visibleTabIds);

  const hasAnyFeatureCallback =
    onNewLogViewer || onNewPingMonitor || onNewFileServer || onNewAiChat;

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

  // Close the "Watch in ▸" picker on outside click or Esc (mirrors the context menu).
  useEffect(() => {
    if (!watchMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (watchMenuRef.current && !watchMenuRef.current.contains(e.target as Node)) {
        setWatchMenu(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWatchMenu(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [watchMenu]);

  const handleDragStart = (index: number, itemId: string) => (e: React.DragEvent) => {
    setDragSourceIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-hotty-session', itemId);
    e.dataTransfer.setData('text/plain', itemId);
    // Hide any Web Browser pane's native webview for the drag's duration so its
    // OS-composited window stops swallowing the pane drop target's DOM events.
    useUiOverlayStore.getState().setSessionDragging(true);
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
    // Drag finished (dropped or cancelled) — restore the browser webview(s).
    useUiOverlayStore.getState().setSessionDragging(false);
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
          // Paint a watched terminal in its owning conversation's color. Exposed as
          // `--tab-watch-color`, consumed by the watch-dot fill and the linked bar.
          const watchColor =
            item.isWatching && item.watchColorIndex != null
              ? conversationColorVar(item.watchColorIndex)
              : undefined;
          const tabStyle = watchColor
            ? ({ '--tab-watch-color': watchColor } as React.CSSProperties)
            : undefined;
          return (
            <div
              key={item.id}
              data-session-id={item.id}
              draggable
              style={tabStyle}
              className={`tab${isActive ? ' active active-pane-tab' : ''}${
                item.status === 'error' ? ' error' : ''
              }${item.status === 'connecting' ? ' connecting' : ''}${
                isHidden ? ' hidden-tab' : ''
              }${dragOverCls}${
                item.isWatching ? ' gemini-linked-tab' : ''
              }${item.isAiTab ? ' is-ai-tab' : ''}`}
              onClick={() => onSelect(item.id)}
              onContextMenu={(e) => {
                // Always suppress the default WebView2 menu on tabs, then open our
                // custom menu only when there's an applicable action for this tab.
                e.preventDefault();
                e.stopPropagation();
                const isWebBrowser = item.kind === 'feature' && item.featureType === 'web-browser';
                const isSession = item.kind === 'session';
                const isSshOrTelnet = item.protocol === 'ssh' || item.protocol === 'telnet';
                // The fixed-size toggle only applies once the connect-time width
                // is known (ptyCols) for an ssh/telnet session.
                const canToggleFixedSize =
                  isSshOrTelnet && !!onToggleFixedSize && item.ptyCols != null;
                const sessionHasItems =
                  isSession &&
                  (!!onToggleWatch || (isSshOrTelnet && !!onSaveToHostTree) || canToggleFixedSize);
                const webHasItems = isWebBrowser && !!onBookmark;
                if (!sessionHasItems && !webHasItems) return;
                setContextMenu({
                  tabId: item.id,
                  kind: item.kind,
                  isWebBrowser,
                  isSshOrTelnet,
                  isWatching: !!item.isWatching,
                  fixedSize: !!item.fixedSize,
                  ptyCols: item.ptyCols,
                  x: e.clientX,
                  y: e.clientY,
                });
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
                  title={item.isWatching ? t('chrome.tabBar.aiMonitorActive') : t('chrome.tabBar.aiMonitorStart')}
                  onClick={(e) => {
                    e.stopPropagation();
                    // With 2+ conversations the destination is ambiguous, so open the
                    // "Watch in ▸" picker instead of silently attaching to the active
                    // one. With 0–1 conversations, one-click toggle as before.
                    if (conversations.length >= 2 && onWatchInConversation) {
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setWatchMenu({ sessionId: item.id, ownerTabId: item.watchOwnerTabId, x: r.left, y: r.bottom + 2 });
                    } else {
                      onToggleWatch(item.id);
                    }
                  }}
                  aria-label={item.isWatching ? t('chrome.tabBar.aiMonitorStopAria') : t('chrome.tabBar.aiMonitorStartAria')}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10"
                      fill={item.isWatching ? 'var(--tab-watch-color, var(--success-color, #4ade80))' : 'currentColor'}
                      opacity={item.isWatching ? 1 : 0.7} />
                    <circle cx="12" cy="12" r="6"
                      fill={item.isWatching ? 'var(--tab-watch-color, var(--accent-light, #42a5f5))' : 'currentColor'}
                      opacity={item.isWatching ? 0.9 : 0.45} />
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
                aria-label={t('chrome.tabBar.closeTab')}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <div className="new-tab-btn" onClick={onNew} title={t('chrome.tabBar.newSession')} role="button" tabIndex={0}>
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
            title={t('chrome.tabBar.features')}
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
                  {t('chrome.tabBar.logViewer')}
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
                  {t('chrome.tabBar.pingMonitor')}
                </div>
              )}
              {onNewFileServer && (
                <div
                  className="features-dropdown-item"
                  onClick={() => { onNewFileServer(); setShowFeaturesMenu(false); }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="20" height="6" rx="1" />
                    <rect x="2" y="15" width="20" height="6" rx="1" />
                    <line x1="6" y1="6" x2="6.01" y2="6" />
                    <line x1="6" y1="18" x2="6.01" y2="18" />
                  </svg>
                  {t('chrome.tabBar.fileServer')}
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
                  {t('chrome.tabBar.aiChat')}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="tab-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          role="menu"
        >
          {contextMenu.kind === 'session' && onToggleWatch && (
            <div
              className="tab-context-menu-item"
              role="menuitem"
              onClick={() => {
                onToggleWatch(contextMenu.tabId);
                setContextMenu(null);
              }}
            >
              {contextMenu.isWatching ? t('chrome.tabBar.stopWatchAi') : t('chrome.tabBar.watchAi')}
            </div>
          )}
          {contextMenu.kind === 'session' && contextMenu.isSshOrTelnet && onSaveToHostTree && (
            <div
              className="tab-context-menu-item"
              role="menuitem"
              onClick={() => {
                onSaveToHostTree(contextMenu.tabId);
                setContextMenu(null);
              }}
            >
              {t('chrome.tabBar.saveToHostTree')}
            </div>
          )}
          {contextMenu.kind === 'session' &&
            contextMenu.isSshOrTelnet &&
            onToggleFixedSize &&
            contextMenu.ptyCols != null && (
              <div
                className="tab-context-menu-item"
                role="menuitemcheckbox"
                aria-checked={contextMenu.fixedSize}
                onClick={() => {
                  onToggleFixedSize(contextMenu.tabId);
                  setContextMenu(null);
                }}
              >
                {(contextMenu.fixedSize ? '✓ ' : '') +
                  t('chrome.tabBar.fixedTerminalSize', { cols: contextMenu.ptyCols })}
              </div>
            )}
          {contextMenu.isWebBrowser && onBookmark && (
            <div
              className="tab-context-menu-item"
              role="menuitem"
              onClick={() => {
                onBookmark(contextMenu.tabId);
                setContextMenu(null);
              }}
            >
              {t('chrome.tabBar.bookmark')}
            </div>
          )}
        </div>
      )}

      {watchMenu && onWatchInConversation && (
        <div
          ref={watchMenuRef}
          className="tab-watch-menu"
          style={{ top: watchMenu.y, left: watchMenu.x }}
          role="menu"
        >
          <div className="tab-watch-menu-title">{t('chrome.tabBar.watchInTitle')}</div>
          {conversations.map((c) => {
            const isOwner = c.id === watchMenu.ownerTabId;
            return (
              <div
                key={c.id}
                className={`tab-watch-menu-item${isOwner ? ' owner' : ''}`}
                role="menuitemradio"
                aria-checked={isOwner}
                onClick={() => {
                  onWatchInConversation(watchMenu.sessionId, c.id);
                  setWatchMenu(null);
                }}
              >
                <span
                  className="tab-watch-menu-dot"
                  style={{ background: conversationColorVar(c.colorIndex) }}
                />
                <span className="tab-watch-menu-label">{c.title}</span>
                {isOwner && <span className="tab-watch-menu-check">✓</span>}
              </div>
            );
          })}
          <div
            className="tab-watch-menu-item tab-watch-menu-new"
            role="menuitem"
            onClick={() => {
              onWatchInConversation(watchMenu.sessionId, 'new');
              setWatchMenu(null);
            }}
          >
            <span className="tab-watch-menu-dot tab-watch-menu-plus" aria-hidden="true">+</span>
            <span className="tab-watch-menu-label">{t('chrome.tabBar.watchInNew')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
