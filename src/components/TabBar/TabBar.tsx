import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useTabKeyboardNav } from '../../hooks/useTabKeyboardNav';
import { useUiOverlayStore } from '../../stores/uiOverlayStore';
import { useTabActivityStore } from '../../stores/tabActivityStore';
import { FEATURE_LABEL_KEYS } from '../../utils/paneTypes';
import { DockMenu, type DockMenuPlacement } from '../Dock/DockMenu';
import { groupTabs, hiddenTabsThatFit, type TabItem, type ConversationSummary } from './tabBarHelpers';
import { TabRow } from './TabRow';
import { TabContextMenu, type TabContextMenuState } from './TabContextMenu';
import { useWatchPicker } from './useWatchPicker';
import { NewSessionMenu } from './NewSessionMenu';
import { ChevronIcon } from './TabIcons';
import type { LocalShellChoice, NewSessionChoice } from '../../types/appTypes';
import './TabBar.css';

export const SESSION_DRAG_TYPE = 'application/x-hotty-session';

interface TabBarProps {
  tabItems: TabItem[];
  activeTabId: string | null;
  /** Every pane on screen, in visual order (grid first, then shown edge bars). */
  visiblePanes: readonly string[];
  paneAllocations: Readonly<Record<string, string | null>>;
  orientation: 'vertical' | 'horizontal';
  compact?: boolean;
  /** Which way menus opened from the tab list unfold. */
  menuPlacement: DockMenuPlacement;
  /** The dock's own controls (grip, position, compact), placed by the list. */
  header?: ReactNode;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  /** Open the dialog for a New Session menu row. */
  onNew: (choice: NewSessionChoice) => void;
  /** Start a local shell from the New Session menu, with no dialog. */
  onOpenLocal: (choice: LocalShellChoice) => void;
  /** Reorder within the hidden group: put `dragId` before or after `targetId`. */
  onMoveHidden: (dragId: string, targetId: string, place: 'before' | 'after') => void;
  /** Show `id` in `paneId` (swapping with what is there). */
  onPlace: (id: string, paneId: string) => void;
  /** Take a shown tab off screen without closing it. */
  onHide: (id: string) => void;
  onToggleWatch?: (id: string) => void;
  /** AI Chat conversations (of the singleton pane) for the "Watch in ▸" picker. */
  conversations?: ConversationSummary[];
  /** Route a terminal into a specific conversation (or 'new'); single-owner move. */
  onWatchInConversation?: (sessionId: string, target: string | 'new') => void;
  /**
   * Watch this terminal from the AI Chat WINDOW: hand it to the AI window if one
   * is open, otherwise move AI Chat out into one first.
   */
  onWatchInAiWindow?: (sessionId: string) => void;
  onSaveToHostTree?: (id: string) => void;
  onToggleFixedSize?: (id: string) => void;
  onBookmark?: (id: string) => void;
  onNewLogViewer?: () => void;
  onNewPingMonitor?: () => void;
  onNewInterfaceTraffic?: () => void;
  onNewFileServer?: () => void;
  onNewAiChat?: () => void;
}

interface DragOverState {
  id: string;
  where: 'before' | 'after' | 'into';
}

/**
 * The tab list of the dock. Tabs are split into the ones on screen — in pane
 * order, each with its pane's mark — and the hidden ones, which show what
 * they are connected to or, when output arrived while they were away, the
 * newest line of it. Vertical (dock on the left/right) it is a column that
 * scrolls; horizontal (top/bottom) it never scrolls: hidden tabs that do not
 * fit are gathered into one "More" menu.
 */
export function TabBar({
  tabItems,
  activeTabId,
  visiblePanes,
  paneAllocations,
  orientation,
  compact = false,
  menuPlacement,
  header,
  onSelect,
  onClose,
  onNew,
  onOpenLocal,
  onMoveHidden,
  onPlace,
  onHide,
  onToggleWatch,
  conversations = [],
  onWatchInConversation,
  onWatchInAiWindow,
  onSaveToHostTree,
  onToggleFixedSize,
  onBookmark,
  onNewLogViewer,
  onNewPingMonitor,
  onNewInterfaceTraffic,
  onNewFileServer,
  onNewAiChat,
}: TabBarProps) {
  const { t } = useTranslation();
  const vertical = orientation === 'vertical';
  const activity = useTabActivityStore((s) => s.activity);
  const [filter, setFilter] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<DragOverState | null>(null);
  const [hiddenGroupOver, setHiddenGroupOver] = useState(false);
  const [contextMenu, setContextMenu] = useState<TabContextMenuState | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [listWidth, setListWidth] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const activeRowRef = useRef<HTMLDivElement>(null);

  /**
   * What the tab is called. A feature tab's generic name belongs to its *type*,
   * so it is translated here rather than stored in English when the pane is
   * created. An explicit `displayName` still wins: a session's name, or the
   * site a Web Browser pane is showing.
   */
  const tabLabel = (item: TabItem): string =>
    item.displayName ?? (item.featureType ? t(FEATURE_LABEL_KEYS[item.featureType]) : '');

  const { shown, hidden } = groupTabs(tabItems, visiblePanes, paneAllocations);
  const paneOf = new Map(shown.map((p) => [p.item.id, p.paneId]));
  const isShown = (id: string) => paneOf.has(id);

  const needle = vertical && !compact ? filter.trim().toLowerCase() : '';
  const matches = (item: TabItem) =>
    !needle || `${tabLabel(item)} ${item.detail ?? ''}`.toLowerCase().includes(needle);
  const shownRows = shown.filter((p) => matches(p.item));
  const hiddenRows = hidden.filter(matches);

  // Horizontal: measure the row and decide how many hidden tabs it can hold.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (vertical || !el || typeof ResizeObserver === 'undefined') return;
    // The observer reports the current size as soon as it starts observing.
    const ro = new ResizeObserver(() => setListWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [vertical]);
  const fit = vertical ? hiddenRows.length : hiddenTabsThatFit(listWidth, shownRows.length, hiddenRows.length, compact);
  const inlineHidden = hiddenRows.slice(0, fit);
  const overflow = hiddenRows.slice(fit);

  // Keep the selected tab in view when it changes from elsewhere. Only the
  // vertical list scrolls, and only it is moved: scrollIntoView would also
  // scroll the horizontal row (overflow: hidden is still scrollable by script,
  // with nothing on screen to scroll it back) and the window's own ancestors.
  useEffect(() => {
    const list = listRef.current;
    const rowEl = activeRowRef.current;
    if (!vertical || !list || !rowEl) return;
    const l = list.getBoundingClientRect();
    const r = rowEl.getBoundingClientRect();
    if (r.top < l.top) list.scrollTop -= l.top - r.top;
    else if (r.bottom > l.bottom) list.scrollTop += r.bottom - l.bottom;
  }, [activeTabId, vertical]);

  // Arrow keys move between the tabs on screen only. Selecting a hidden tab
  // swaps it into the active pane, which moves the previous tab into the hidden
  // group and reorders the list under the next key press; hidden tabs are
  // brought out by a click instead.
  const { onKeyDown } = useTabKeyboardNav({
    ids: shownRows.map((p) => p.item.id),
    activeId: activeTabId,
    onSelect,
    orientation,
  });

  // ── Drag & drop ──────────────────────────────────────────────────────────
  const clearDrag = () => {
    setDragId(null);
    setDragOver(null);
    setHiddenGroupOver(false);
  };

  const handleDragStart = (e: DragEvent, item: TabItem) => {
    setDragId(item.id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(SESSION_DRAG_TYPE, item.id);
    e.dataTransfer.setData('text/plain', item.id);
    // Hide any Web Browser pane's native webview for the drag's duration so its
    // OS-composited window stops swallowing the pane drop target's DOM events.
    useUiOverlayStore.getState().setSessionDragging(true);
  };

  const handleDragEnd = () => {
    clearDrag();
    useUiOverlayStore.getState().setSessionDragging(false);
  };

  /** Dropping on a shown row puts the dragged tab in that row's pane. */
  const overShownRow = (e: DragEvent, item: TabItem) => {
    if (!dragId || dragId === item.id) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (dragOver?.id !== item.id || dragOver.where !== 'into') setDragOver({ id: item.id, where: 'into' });
  };
  const dropOnShownRow = (e: DragEvent, item: TabItem) => {
    e.preventDefault();
    e.stopPropagation();
    const pane = paneOf.get(item.id);
    if (dragId && pane && dragId !== item.id) onPlace(dragId, pane);
    clearDrag();
  };

  /** Hidden rows reorder among themselves; a shown tab dropped there is hidden. */
  const overHiddenRow = (e: DragEvent, item: TabItem) => {
    if (!dragId || dragId === item.id) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (isShown(dragId)) {
      if (!hiddenGroupOver) setHiddenGroupOver(true);
      if (dragOver) setDragOver(null);
      return;
    }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const before = vertical ? e.clientY - r.top < r.height / 2 : e.clientX - r.left < r.width / 2;
    const where = before ? 'before' : 'after';
    if (dragOver?.id !== item.id || dragOver.where !== where) setDragOver({ id: item.id, where });
  };
  const dropOnHiddenRow = (e: DragEvent, item: TabItem) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragId && dragId !== item.id) {
      if (isShown(dragId)) onHide(dragId);
      else if (dragOver?.id === item.id && dragOver.where !== 'into') onMoveHidden(dragId, item.id, dragOver.where);
    }
    clearDrag();
  };

  const overHiddenGroup = (e: DragEvent) => {
    if (!dragId || !isShown(dragId)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!hiddenGroupOver) setHiddenGroupOver(true);
  };
  const dropOnHiddenGroup = (e: DragEvent) => {
    e.preventDefault();
    if (dragId && isShown(dragId)) onHide(dragId);
    clearDrag();
  };

  // ── Menus ────────────────────────────────────────────────────────────────
  const openContextMenu = (e: MouseEvent, item: TabItem) => {
    // Always suppress the default WebView2 menu on tabs, then open ours only
    // when there is something in it for this tab.
    e.preventDefault();
    e.stopPropagation();
    const isWebBrowser = item.kind === 'feature' && item.featureType === 'web-browser';
    const isSession = item.kind === 'session';
    const isSshOrTelnet = item.protocol === 'ssh' || item.protocol === 'telnet';
    const canToggleFixedSize = isSshOrTelnet && !!onToggleFixedSize && item.ptyCols != null;
    const sessionHasItems =
      isSession && (!!onToggleWatch || (isSshOrTelnet && !!onSaveToHostTree) || canToggleFixedSize);
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
  };

  const { onWatchClick: pickWatch, menuElement: watchMenuElement } = useWatchPicker({
    conversations,
    onToggleWatch,
    onWatchInConversation,
  });
  const handleWatchClick = pickWatch
    ? (e: MouseEvent, item: TabItem) => pickWatch(e, item.id, item.watchOwnerTabId)
    : undefined;

  const row = (item: TabItem, paneId: string | null, inMenu = false) => {
    const isActive = item.id === activeTabId;
    return (
      <TabRow
        key={item.id}
        ref={isActive && !inMenu ? activeRowRef : undefined}
        item={item}
        label={tabLabel(item)}
        paneId={paneId}
        isActive={isActive}
        activity={paneId === null ? activity[item.id] : undefined}
        dragOver={dragOver?.id === item.id ? dragOver.where : null}
        onSelect={(id) => {
          if (inMenu) setMoreOpen(false);
          onSelect(id);
        }}
        onClose={onClose}
        onContextMenu={openContextMenu}
        onWatchClick={handleWatchClick}
        onDragStart={handleDragStart}
        onDragOver={inMenu ? undefined : paneId !== null ? overShownRow : overHiddenRow}
        onDragLeave={() => setDragOver(null)}
        onDrop={inMenu ? undefined : paneId !== null ? dropOnShownRow : dropOnHiddenRow}
        onDragEnd={handleDragEnd}
      />
    );
  };

  const overflowUnread = overflow.some((i) => (activity[i.id]?.lines ?? 0) > 0);
  const overflowBad = overflow.some((i) => i.status === 'error' || i.status === 'disconnected');

  return (
    <div
      className={`tab-bar tab-bar-${orientation}${compact ? ' compact' : ''}${dragId ? ' dragging' : ''}`}
    >
      {vertical && header}
      {vertical && !compact && (
        <input
          className="tab-filter"
          type="text"
          value={filter}
          placeholder={t('chrome.dock.filterPlaceholder')}
          aria-label={t('chrome.dock.filterPlaceholder')}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}
      {/* The keys are taken here, not on the whole bar, so Home/End and the
          arrows still edit the filter box and drive the menus. */}
      <div className="tab-list" ref={listRef} tabIndex={0} onKeyDown={onKeyDown}>
        <div className="tab-group-label">{t('chrome.dock.shown')}</div>
        <div className="tab-group tab-group-shown">{shownRows.map((p) => row(p.item, p.paneId))}</div>
        <div className="tab-group-sep" />
        <div className="tab-group-label">
          {t('chrome.dock.hidden')}
          <span className="tab-group-count">{hidden.length}</span>
        </div>
        <div
          className={`tab-group tab-group-hidden${hiddenGroupOver ? ' drop-target' : ''}`}
          onDragOver={overHiddenGroup}
          onDragLeave={(e) => {
            if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setHiddenGroupOver(false);
          }}
          onDrop={dropOnHiddenGroup}
        >
          {inlineHidden.map((item) => row(item, null))}
        </div>
        {overflow.length > 0 && (
          <button
            ref={moreRef}
            type="button"
            className={`tab tab-more${moreOpen ? ' open' : ''}`}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((v) => !v)}
          >
            <span className="tab-label">
              {inlineHidden.length > 0
                ? t('chrome.dock.moreHidden', { count: overflow.length })
                : `${t('chrome.dock.hidden')} ${overflow.length}`}
            </span>
            {(overflowUnread || overflowBad) && (
              <span className={`tab-state-dot ${overflowUnread ? 'unread' : 'bad'}`} aria-hidden="true" />
            )}
            <ChevronIcon up={menuPlacement === 'up' ? !moreOpen : moreOpen} />
          </button>
        )}
      </div>
      <DockMenu
        open={moreOpen && overflow.length > 0}
        onClose={() => setMoreOpen(false)}
        anchorRef={moreRef}
        placement={menuPlacement}
        className="tab-overflow-menu"
      >
        {overflow.map((item) => row(item, null, true))}
      </DockMenu>
      <div className="tab-new-wrap">
        <NewSessionMenu
          placement={menuPlacement}
          onNew={onNew}
          onOpenLocal={onOpenLocal}
          onNewLogViewer={onNewLogViewer}
          onNewPingMonitor={onNewPingMonitor}
          onNewInterfaceTraffic={onNewInterfaceTraffic}
          onNewFileServer={onNewFileServer}
          onNewAiChat={onNewAiChat}
        />
      </div>
      {!vertical && header}

      {contextMenu && (
        <TabContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onToggleWatch={onToggleWatch}
          onWatchInAiWindow={onWatchInAiWindow}
          onSaveToHostTree={onSaveToHostTree}
          onToggleFixedSize={onToggleFixedSize}
          onBookmark={onBookmark}
        />
      )}
      {watchMenuElement}
    </div>
  );
}
