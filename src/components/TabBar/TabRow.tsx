import { forwardRef, type CSSProperties, type DragEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { conversationColorVar } from '../../utils/conversationColor';
import { FEATURE_LABEL_KEYS } from '../../utils/paneTypes';
import type { TabActivity } from '../../stores/tabActivityStore';
import { PaneBadge } from '../PaneBadge/PaneBadge';
import { FeatureIcon, ProtocolIcon } from './TabIcons';
import { WatchButton } from './WatchButton';
import { tabStateDot, type TabItem } from './tabBarHelpers';

export interface TabRowProps {
  item: TabItem;
  label: string;
  /** The pane showing this tab; null when the tab is hidden. */
  paneId: string | null;
  isActive: boolean;
  /** Output that arrived while hidden (hidden tabs only). */
  activity?: TabActivity;
  dragOver?: 'before' | 'after' | 'into' | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onContextMenu: (e: MouseEvent, item: TabItem) => void;
  /** Present only when AI watching is available for terminal tabs. */
  onWatchClick?: (e: MouseEvent, item: TabItem) => void;
  onDragStart: (e: DragEvent, item: TabItem) => void;
  onDragOver?: (e: DragEvent, item: TabItem) => void;
  onDragLeave?: () => void;
  onDrop?: (e: DragEvent, item: TabItem) => void;
  onDragEnd: () => void;
}

/** One tab in the dock's tab list: mark, name, second line, state. */
export const TabRow = forwardRef<HTMLDivElement, TabRowProps>(function TabRow(
  {
    item,
    label,
    paneId,
    isActive,
    activity,
    dragOver,
    onSelect,
    onClose,
    onContextMenu,
    onWatchClick,
    onDragStart,
    onDragOver,
    onDragLeave,
    onDrop,
    onDragEnd,
  },
  ref
) {
  const { t } = useTranslation();
  const hidden = paneId === null;
  const unread = hidden && !!activity && activity.lines > 0;
  const dot = tabStateDot(item, unread);

  let detail: string | undefined;
  let detailCls = '';
  if (unread) {
    detail = activity?.lastLine || undefined;
    detailCls = ' unread';
  } else if (item.kind === 'session') {
    if (item.status === 'error' && item.errorMessage) {
      detail = item.errorMessage;
      detailCls = ' bad';
    } else {
      detail = item.detail;
      if (item.status === 'error' || item.status === 'disconnected') detailCls = ' bad';
    }
  } else if (item.displayName && item.featureType) {
    // A feature tab named after its content (a Web Browser's site) says what
    // kind of pane it is underneath.
    const typeLabel = t(FEATURE_LABEL_KEYS[item.featureType]);
    if (typeLabel !== item.displayName) detail = typeLabel;
  }

  const watchColor =
    item.isWatching && item.watchColorIndex != null ? conversationColorVar(item.watchColorIndex) : undefined;
  const style = watchColor ? ({ '--tab-watch-color': watchColor } as CSSProperties) : undefined;

  const cls = [
    'tab',
    isActive ? 'active active-pane-tab' : '',
    item.status === 'error' ? 'error' : '',
    item.status === 'connecting' ? 'connecting' : '',
    hidden ? 'hidden-tab' : '',
    item.isWatching ? 'gemini-linked-tab' : '',
    item.isAiTab ? 'is-ai-tab' : '',
    dragOver ? `drag-over-${dragOver}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={ref}
      className={cls}
      style={style}
      data-session-id={item.id}
      draggable
      title={[label, detail].filter(Boolean).join('\n')}
      onClick={() => onSelect(item.id)}
      onAuxClick={(e) => {
        // Middle click closes, as in a browser — the only way to close a tab
        // in the narrow dock, where the × has no room.
        if (e.button === 1) {
          e.preventDefault();
          onClose(item.id);
        }
      }}
      onContextMenu={(e) => onContextMenu(e, item)}
      onDragStart={(e) => onDragStart(e, item)}
      onDragOver={onDragOver ? (e) => onDragOver(e, item) : undefined}
      onDragLeave={onDragLeave}
      onDrop={onDrop ? (e) => onDrop(e, item) : undefined}
      onDragEnd={onDragEnd}
    >
      <span className="tab-lead">
        {paneId !== null ? (
          <PaneBadge paneId={paneId} />
        ) : item.kind === 'feature' && item.featureType ? (
          <FeatureIcon type={item.featureType} />
        ) : (
          <ProtocolIcon protocol={item.protocol} />
        )}
      </span>
      <span className="tab-text">
        <span className="tab-label">{label}</span>
        {detail && <span className={`tab-detail${detailCls}`}>{detail}</span>}
      </span>
      {unread && <span className="tab-unread-count">+{activity!.lines}</span>}
      {item.kind === 'session' && onWatchClick && (
        <WatchButton
          isWatching={!!item.isWatching}
          colorIndex={item.watchColorIndex ?? undefined}
          onClick={(e) => onWatchClick(e, item)}
        />
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
      {dot && <span className={`tab-state-dot ${dot}`} aria-hidden="true" />}
    </div>
  );
});
