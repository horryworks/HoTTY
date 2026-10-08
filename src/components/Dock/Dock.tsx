import { useState, type ComponentProps, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUiOverlayStore } from '../../stores/uiOverlayStore';
import type { DockPosition } from '../../types/appTypes';
import { AppSidebarBottom, AppSidebarTop } from '../AppSidebar/AppSidebar';
import { TabBar } from '../TabBar/TabBar';
import { dockMenuPlacement } from './dockHelpers';
import './Dock.css';

const DOCK_DRAG_TYPE = 'application/x-hotty-dock';

type TabBarPassThrough = Omit<
  ComponentProps<typeof TabBar>,
  'orientation' | 'compact' | 'menuPlacement' | 'header'
>;

interface DockProps extends TabBarPassThrough {
  onOpenSettings: () => void;
  onOpenHelp: () => void;
}

/** "Put the tabs on this edge": three tabs beside a divider, no frame — so it
 *  never reads as one of the framed layout / bar icons next to it. */
const POSITION_ICONS: Record<DockPosition, string> = {
  left: 'M1.5 2.5h5v2.2h-5zM1.5 6.9h5v2.2h-5zM1.5 11.3h5v2.2h-5zM8.6 1.5h1.3v13H8.6z',
  top: 'M1.5 1.5h3.4v5h-3.4zM6.3 1.5h3.4v5H6.3zM11.1 1.5h3.4v5h-3.4zM1.5 8.6h13v1.3h-13z',
  bottom: 'M1.5 9.5h3.4v5h-3.4zM6.3 9.5h3.4v5H6.3zM11.1 9.5h3.4v5h-3.4zM1.5 6.1h13v1.3h-13z',
  right: 'M9.5 2.5h5v2.2h-5zM9.5 6.9h5v2.2h-5zM9.5 11.3h5v2.2h-5zM6.1 1.5h1.3v13H6.1z',
};

const POSITION_LABEL_KEYS: Record<DockPosition, string> = {
  left: 'chrome.dock.moveLeft',
  top: 'chrome.dock.moveTop',
  bottom: 'chrome.dock.moveBottom',
  right: 'chrome.dock.moveRight',
};

const POSITIONS: DockPosition[] = ['left', 'top', 'bottom', 'right'];

/** Chevron for the shrink/expand button: points the way the dock will move. */
function compactChevron(pos: DockPosition, compact: boolean): string {
  const towardEdge = !compact;
  switch (pos) {
    case 'left':
      return towardEdge ? 'M10 3L5 8l5 5' : 'M6 3l5 5-5 5';
    case 'right':
      return towardEdge ? 'M6 3l5 5-5 5' : 'M10 3L5 8l5 5';
    case 'top':
      return towardEdge ? 'M3 10l5-5 5 5' : 'M3 6l5 5 5-5';
    case 'bottom':
      return towardEdge ? 'M3 6l5 5 5-5' : 'M3 10l5-5 5 5';
  }
}

/**
 * The dock: the icon column (layout, bars, window, wrap, help, settings) and
 * the tab list, kept together and placed on one edge of the window. On the
 * left or right it is a column; on the top or bottom it is a single row, with
 * the layout and bar buttons folded into one menu each so the tabs keep the
 * room. It moves by the four buttons in its header or by dragging the grip to
 * another edge.
 */
export function Dock({ onOpenSettings, onOpenHelp, ...tabBarProps }: DockProps) {
  const { t } = useTranslation();
  const position = useSettingsStore((s) => s.dockPosition);
  const compact = useSettingsStore((s) => s.dockCompact);
  const update = useSettingsStore((s) => s.update);
  const [dragging, setDragging] = useState(false);
  const [dropEdge, setDropEdge] = useState<DockPosition | null>(null);
  const vertical = position === 'left' || position === 'right';

  const endDrag = () => {
    setDragging(false);
    setDropEdge(null);
    useUiOverlayStore.getState().setSessionDragging(false);
  };

  const onGripDragStart = (e: DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(DOCK_DRAG_TYPE, position);
    e.dataTransfer.setData('text/plain', '');
    // Hide Web Browser pages (native windows) so the drop zones over them get
    // the drag events. Showing the zones is deferred: changing the DOM inside
    // dragstart makes some engines cancel the drag.
    useUiOverlayStore.getState().setSessionDragging(true);
    setTimeout(() => setDragging(true), 0);
  };

  const zoneDragOver = (edge: DockPosition) => (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(DOCK_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropEdge !== edge) setDropEdge(edge);
  };

  const zoneDrop = (edge: DockPosition) => (e: DragEvent) => {
    e.preventDefault();
    if (edge !== position) update('dockPosition', edge);
    endDrag();
  };

  const header = (
    <div className="dock-header">
      <span
        className="dock-grip"
        draggable
        onDragStart={onGripDragStart}
        onDragEnd={endDrag}
        title={t('chrome.dock.dragHandle')}
        aria-hidden="true"
      >
        <svg width="10" height="14" viewBox="0 0 12 16" fill="currentColor">
          <circle cx="3.5" cy="3" r="1.3" />
          <circle cx="8.5" cy="3" r="1.3" />
          <circle cx="3.5" cy="8" r="1.3" />
          <circle cx="8.5" cy="8" r="1.3" />
          <circle cx="3.5" cy="13" r="1.3" />
          <circle cx="8.5" cy="13" r="1.3" />
        </svg>
      </span>
      <span className="dock-title">{t('chrome.dock.tabs')}</span>
      <div className="dock-positions" role="group">
        {POSITIONS.map((p) => (
          <button
            key={p}
            type="button"
            className={`dock-position-btn${p === position ? ' active' : ''}`}
            onClick={() => update('dockPosition', p)}
            title={t(POSITION_LABEL_KEYS[p])}
            aria-label={t(POSITION_LABEL_KEYS[p])}
            aria-pressed={p === position}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
              <path d={POSITION_ICONS[p]} fill="currentColor" />
            </svg>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="dock-compact-btn"
        onClick={() => update('dockCompact', !compact)}
        title={compact ? t('chrome.dock.expand') : vertical ? t('chrome.dock.narrower') : t('chrome.dock.lower')}
        aria-label={compact ? t('chrome.dock.expand') : vertical ? t('chrome.dock.narrower') : t('chrome.dock.lower')}
        aria-pressed={compact}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d={compactChevron(position, compact)} />
        </svg>
      </button>
    </div>
  );

  return (
    <div
      className={`dock dock-${position} ${vertical ? 'dock-vertical' : 'dock-horizontal'}${compact ? ' dock-compact' : ''}`}
    >
      <div className="dock-rail">
        <AppSidebarTop collapsed={!vertical} menuPlacement={position === 'bottom' ? 'up' : 'down'} />
        <AppSidebarBottom onOpenSettings={onOpenSettings} onOpenHelp={onOpenHelp} />
      </div>
      <TabBar
        {...tabBarProps}
        orientation={vertical ? 'vertical' : 'horizontal'}
        compact={compact}
        menuPlacement={dockMenuPlacement(position, compact)}
        header={header}
      />
      {dragging &&
        POSITIONS.map((edge) => (
          <div
            key={edge}
            className={`dock-drop-zone dock-drop-zone-${edge}${dropEdge === edge ? ' hot' : ''}`}
            onDragOver={zoneDragOver(edge)}
            onDragLeave={() => setDropEdge((d) => (d === edge ? null : d))}
            onDrop={zoneDrop(edge)}
          />
        ))}
    </div>
  );
}
