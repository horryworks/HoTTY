import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { paneBadge } from '../TabBar/tabBarHelpers';
import './PaneBadge.css';

interface PaneBadgeProps {
  paneId: string;
  /** The pane's number on screen (`paneNumber` in paneStore); null when it has none. */
  number: number | null;
  /** `inline` sits in a tab row or a pane header; `large` marks an empty pane. */
  variant?: 'inline' | 'large';
}

/**
 * The mark that ties a tab to the pane showing it: the pane's number, in that
 * pane's color for a grid cell or the edge color for an edge bar. The same
 * mark appears in the tab list and in the pane's header, so the eye can match
 * the two without reading names.
 */
export function PaneBadge({ paneId, number, variant = 'inline' }: PaneBadgeProps) {
  const { t } = useTranslation();
  const badge = paneBadge(paneId);
  if (!badge || number === null) return null;
  const color =
    badge.kind === 'grid' ? `var(--pane-badge-${(badge.index % 6) + 1})` : 'var(--pane-badge-edge)';
  return (
    <span
      className={`pane-badge pane-badge-${variant}`}
      style={{ '--pane-badge-color': color } as CSSProperties}
      aria-label={t('chrome.pane.label', { number })}
      data-pane-badge={paneId}
    >
      {number}
    </span>
  );
}
