import { describe, it, expect, beforeEach } from 'vitest';
import { useSidebarLayoutStore } from './sidebarLayoutStore';

describe('sidebarLayoutStore', () => {
  beforeEach(() => {
    useSidebarLayoutStore.setState({
      showLeftSidebar: false,
      showRightSidebar: false,
      showTopBar: false,
      showBottomBar: false,
      leftSidebarPercent: 20,
      rightSidebarPercent: 20,
      topBarPercent: 20,
      bottomBarPercent: 20,
    });
    localStorage.clear();
  });

  it('toggle flips the visibility flag for each edge', () => {
    const s = useSidebarLayoutStore.getState();
    s.toggle('left');
    expect(useSidebarLayoutStore.getState().showLeftSidebar).toBe(true);
    s.toggle('right');
    expect(useSidebarLayoutStore.getState().showRightSidebar).toBe(true);
    s.toggle('top');
    expect(useSidebarLayoutStore.getState().showTopBar).toBe(true);
    s.toggle('bottom');
    expect(useSidebarLayoutStore.getState().showBottomBar).toBe(true);
    s.toggle('left');
    expect(useSidebarLayoutStore.getState().showLeftSidebar).toBe(false);
  });

  it('setPercent writes per-edge and clamps to [5, 80]', () => {
    const s = useSidebarLayoutStore.getState();
    s.setPercent('left', 35);
    expect(useSidebarLayoutStore.getState().leftSidebarPercent).toBe(35);

    s.setPercent('right', 1);
    expect(useSidebarLayoutStore.getState().rightSidebarPercent).toBe(5);

    s.setPercent('top', 999);
    expect(useSidebarLayoutStore.getState().topBarPercent).toBe(80);

    s.setPercent('bottom', 25);
    expect(useSidebarLayoutStore.getState().bottomBarPercent).toBe(25);
  });
});
