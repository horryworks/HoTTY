import type { SidebarEdge } from '../../stores/sidebarLayoutStore';

export function sidebarPaneId(edge: SidebarEdge): string {
  return `bar-${edge}`;
}
