import type { DockPosition } from '../../types/appTypes';
import type { DockMenuPlacement } from './DockMenu';

/** Where a menu opened from the tab list should unfold, given the dock's edge. */
export function dockMenuPlacement(pos: DockPosition, compact: boolean): DockMenuPlacement {
  if (pos === 'top') return 'down';
  if (pos === 'bottom') return 'up';
  if (!compact) return 'down';
  return pos === 'left' ? 'right' : 'left';
}
