import type { DragEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { beginSessionDrag, endSessionDrag } from '../../utils/sessionDrag';
import { PaneBadge } from '../PaneBadge/PaneBadge';
import './PaneHeader.css';

interface PaneHeaderProps {
  paneId: string;
  /** The pane's number on screen (`paneNumber` in paneStore). */
  paneNumber: number | null;
  title: string;
  /** Secondary text after the title (what a terminal is connected to). */
  detail?: string;
  /** Extra buttons, placed just before the close button. */
  actions?: ReactNode;
  onClose: () => void;
  /** The tab shown in this pane. When given, dragging the header onto another pane moves it there. */
  dragSessionId?: string;
}

/**
 * A pane's one-line header: the pane mark, the title, an optional detail, any
 * extra buttons, and the close button at the far right. Used by panes that have
 * no toolbar row of their own to carry the mark (terminals, AI Chat).
 */
export function PaneHeader({ paneId, paneNumber, title, detail, actions, onClose, dragSessionId }: PaneHeaderProps) {
  const { t } = useTranslation();
  const handleDragStart = (e: DragEvent<HTMLDivElement>, sessionId: string) => {
    // A press on a button that slips into a drag would otherwise drag the whole bar.
    if ((e.target as Element).closest('button')) {
      e.preventDefault();
      return;
    }
    beginSessionDrag(e.dataTransfer, sessionId);
  };
  return (
    <div
      className={`pane-term-header${dragSessionId ? ' draggable' : ''}`}
      draggable={!!dragSessionId}
      onDragStart={dragSessionId ? (e) => handleDragStart(e, dragSessionId) : undefined}
      onDragEnd={dragSessionId ? endSessionDrag : undefined}
    >
      <PaneBadge paneId={paneId} number={paneNumber} />
      <span className="pane-term-name">{title}</span>
      <span className="pane-term-detail">{detail}</span>
      {actions}
      <button
        type="button"
        className="pane-term-close"
        title={t('chrome.tabBar.closeTab')}
        aria-label={t('chrome.tabBar.closeTab')}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        ×
      </button>
    </div>
  );
}
