import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { paneBadge } from '../TabBar/tabBarHelpers';
import './PaneBadge.css';

interface PaneBadgeProps {
  paneId: string;
  /** `inline` sits in a tab row or a pane header; `large` marks an empty pane. */
  variant?: 'inline' | 'large';
}

/**
 * The mark that ties a tab to the pane showing it: the pane number (1..6) in
 * that pane's color, or the edge (left/right/top/bottom) for an edge bar. The
 * same mark appears in the tab list and in the pane's header, so the eye can
 * match the two without reading names.
 */
export function PaneBadge({ paneId, variant = 'inline' }: PaneBadgeProps) {
  const { t } = useTranslation();
  const badge = paneBadge(paneId);
  if (!badge) return null;
  const label =
    badge.kind === 'grid'
      ? String(badge.index + 1)
      : t(`chrome.dock.edgeBadge.${badge.edge}`);
  const color =
    badge.kind === 'grid' ? `var(--pane-badge-${(badge.index % 6) + 1})` : 'var(--pane-badge-edge)';
  return (
    <span
      className={`pane-badge pane-badge-${variant}`}
      style={{ '--pane-badge-color': color } as CSSProperties}
      aria-label={badge.kind === 'grid' ? t('chrome.pane.label', { number: badge.index + 1 }) : undefined}
      data-pane-badge={paneId}
    >
      {label}
    </span>
  );
}
