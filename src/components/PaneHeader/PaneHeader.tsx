import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PaneBadge } from '../PaneBadge/PaneBadge';
import './PaneHeader.css';

interface PaneHeaderProps {
  paneId: string;
  title: string;
  /** Secondary text after the title (what a terminal is connected to). */
  detail?: string;
  /** Extra buttons, placed just before the close button. */
  actions?: ReactNode;
  onClose: () => void;
}

/**
 * A pane's one-line header: the pane mark, the title, an optional detail, any
 * extra buttons, and the close button at the far right. Used by panes that have
 * no toolbar row of their own to carry the mark (terminals, AI Chat).
 */
export function PaneHeader({ paneId, title, detail, actions, onClose }: PaneHeaderProps) {
  const { t } = useTranslation();
  return (
    <div className="pane-term-header">
      <PaneBadge paneId={paneId} />
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
