import { describe, it, expect, beforeEach } from 'vitest';
import {
  usePaneStore,
  gridPaneIds,
  visiblePaneIdsInOrder,
} from './paneStore';
import { useSidebarLayoutStore } from './sidebarLayoutStore';

describe('paneStore', () => {
  beforeEach(() => {
    usePaneStore.setState({
      layoutMode: '1x1',
      activePaneId: '0',
      paneAllocations: {},
      sessionOrder: [],
    });
    useSidebarLayoutStore.setState({
      showLeftSidebar: false,
      showRightSidebar: false,
      showTopBar: false,
      showBottomBar: false,
    });
    localStorage.clear();
  });

  it('gridPaneIds returns stringified indices', () => {
    expect(gridPaneIds('1x1')).toEqual(['0']);
    expect(gridPaneIds('2x2')).toEqual(['0', '1', '2', '3']);
  });

  it('gridPaneIds covers rows*cols for non-square layouts', () => {
    expect(gridPaneIds('3x2')).toHaveLength(6);
    expect(gridPaneIds('2x3')).toHaveLength(6);
  });

  it('addSession allocates to first empty pane and activates it', () => {
    usePaneStore.setState({ layoutMode: '2x2' });
    usePaneStore.getState().addSession('s1');
    const s = usePaneStore.getState();
    expect(s.sessionOrder).toEqual(['s1']);
    expect(s.paneAllocations['0']).toBe('s1');
    expect(s.activePaneId).toBe('0');
  });

  it('addSession fills subsequent empty panes', () => {
    usePaneStore.setState({ layoutMode: '2x2' });
    usePaneStore.getState().addSession('s1');
    usePaneStore.getState().addSession('s2');
    const s = usePaneStore.getState();
    expect(s.paneAllocations['0']).toBe('s1');
    expect(s.paneAllocations['1']).toBe('s2');
  });

  it('addSession keeps overflow sessions hidden (no pane)', () => {
    usePaneStore.setState({ layoutMode: '1x1' });
    usePaneStore.getState().addSession('s1');
    usePaneStore.getState().addSession('s2');
    const s = usePaneStore.getState();
    expect(s.sessionOrder).toEqual(['s1', 's2']);
    expect(s.paneAllocations['0']).toBe('s1');
    expect(Object.values(s.paneAllocations)).not.toContain('s2');
  });

  it('removeSession frees its pane and promotes a hidden session', () => {
    usePaneStore.setState({ layoutMode: '1x1' });
    usePaneStore.getState().addSession('s1');
    usePaneStore.getState().addSession('s2'); // hidden
    usePaneStore.getState().removeSession('s1');
    const s = usePaneStore.getState();
    expect(s.sessionOrder).toEqual(['s2']);
    expect(s.paneAllocations['0']).toBe('s2');
  });

  it('reorderSession reorders sessionOrder', () => {
    usePaneStore.setState({
      sessionOrder: ['a', 'b', 'c'],
    });
    usePaneStore.getState().reorderSession(0, 2);
    expect(usePaneStore.getState().sessionOrder).toEqual(['b', 'c', 'a']);
  });

  it('moveSessionToPane swaps sessions between panes', () => {
    usePaneStore.setState({
      layoutMode: '2x2',
      paneAllocations: { '0': 's1', '1': 's2' },
      sessionOrder: ['s1', 's2'],
    });
    usePaneStore.getState().moveSessionToPane('s1', '1');
    const s = usePaneStore.getState();
    expect(s.paneAllocations['0']).toBe('s2');
    expect(s.paneAllocations['1']).toBe('s1');
    expect(s.activePaneId).toBe('1');
  });

  it('moveSessionToPane to empty pane moves without swap', () => {
    usePaneStore.setState({
      layoutMode: '2x2',
      paneAllocations: { '0': 's1', '1': null },
      sessionOrder: ['s1'],
    });
    usePaneStore.getState().moveSessionToPane('s1', '1');
    const s = usePaneStore.getState();
    expect(s.paneAllocations['0']).toBeNull();
    expect(s.paneAllocations['1']).toBe('s1');
  });

  it('setLayoutMode preserves allocations for valid panes and reassigns orphaned sessions', () => {
    usePaneStore.setState({
      layoutMode: '2x2',
      paneAllocations: { '0': 's1', '1': 's2', '2': 's3', '3': 's4' },
      sessionOrder: ['s1', 's2', 's3', 's4'],
    });
    usePaneStore.getState().setLayoutMode('1x2');
    const s = usePaneStore.getState();
    expect(s.layoutMode).toBe('1x2');
    expect(Object.values(s.paneAllocations).sort()).toEqual(['s1', 's2']);
  });

  it('setLayoutMode clamps activePaneId when current pane disappears', () => {
    usePaneStore.setState({ layoutMode: '2x3', activePaneId: '5' });
    usePaneStore.getState().setLayoutMode('1x1');
    expect(usePaneStore.getState().activePaneId).toBe('0');
  });

  it('moveSessionToPane allocates a session to a sidebar pane', () => {
    usePaneStore.setState({
      layoutMode: '1x1',
      paneAllocations: { '0': 's1' },
      sessionOrder: ['s1'],
    });
    usePaneStore.getState().moveSessionToPane('s1', 'bar-left');
    const s = usePaneStore.getState();
    expect(s.paneAllocations['bar-left']).toBe('s1');
    expect(s.paneAllocations['0']).toBeNull();
    expect(s.activePaneId).toBe('bar-left');
  });

  it('setLayoutMode preserves sidebar pane allocations', () => {
    usePaneStore.setState({
      layoutMode: '2x2',
      paneAllocations: { '0': 's1', 'bar-left': 's2' },
      sessionOrder: ['s1', 's2'],
    });
    usePaneStore.getState().setLayoutMode('1x1');
    const s = usePaneStore.getState();
    expect(s.paneAllocations['bar-left']).toBe('s2');
    expect(s.paneAllocations['0']).toBe('s1');
  });

  it('setLayoutMode keeps activePaneId when it is a sidebar pane', () => {
    usePaneStore.setState({
      layoutMode: '2x2',
      activePaneId: 'bar-right',
      paneAllocations: { 'bar-right': 's1' },
      sessionOrder: ['s1'],
    });
    usePaneStore.getState().setLayoutMode('1x1');
    expect(usePaneStore.getState().activePaneId).toBe('bar-right');
  });

  it('addSession spills into visible sidebar panes when grid is full (left → right → top → bottom)', () => {
    useSidebarLayoutStore.setState({
      showLeftSidebar: true,
      showRightSidebar: true,
      showTopBar: true,
      showBottomBar: true,
    });
    usePaneStore.setState({ layoutMode: '1x1' });
    const store = usePaneStore.getState();
    store.addSession('s1');
    store.addSession('s2');
    store.addSession('s3');
    store.addSession('s4');
    store.addSession('s5');
    const s = usePaneStore.getState();
    expect(s.paneAllocations['0']).toBe('s1');
    expect(s.paneAllocations['bar-left']).toBe('s2');
    expect(s.paneAllocations['bar-right']).toBe('s3');
    expect(s.paneAllocations['bar-top']).toBe('s4');
    expect(s.paneAllocations['bar-bottom']).toBe('s5');
    expect(s.activePaneId).toBe('bar-bottom');
  });

  it('addSession skips hidden sidebars and leaves overflow unassigned', () => {
    useSidebarLayoutStore.setState({
      showLeftSidebar: false,
      showRightSidebar: true,
      showTopBar: false,
      showBottomBar: false,
    });
    usePaneStore.setState({ layoutMode: '1x1' });
    const store = usePaneStore.getState();
    store.addSession('s1');
    store.addSession('s2');
    store.addSession('s3');
    const s = usePaneStore.getState();
    expect(s.paneAllocations['0']).toBe('s1');
    expect(s.paneAllocations['bar-right']).toBe('s2');
    expect(s.paneAllocations['bar-left']).toBeUndefined();
    expect(Object.values(s.paneAllocations)).not.toContain('s3');
    expect(s.sessionOrder).toEqual(['s1', 's2', 's3']);
  });

  it('addSession fills grid before spilling to a visible sidebar', () => {
    useSidebarLayoutStore.setState({ showLeftSidebar: true });
    usePaneStore.setState({ layoutMode: '2x1' });
    const store = usePaneStore.getState();
    store.addSession('s1');
    store.addSession('s2');
    store.addSession('s3');
    const s = usePaneStore.getState();
    expect(s.paneAllocations['0']).toBe('s1');
    expect(s.paneAllocations['1']).toBe('s2');
    expect(s.paneAllocations['bar-left']).toBe('s3');
  });

  it('addSession with preferSidebar places into bar-left when visible', () => {
    useSidebarLayoutStore.setState({ showLeftSidebar: true });
    usePaneStore.setState({ layoutMode: '2x2' });
    usePaneStore.getState().addSession('s1', { preferSidebar: true });
    const s = usePaneStore.getState();
    expect(s.paneAllocations['bar-left']).toBe('s1');
    expect(s.paneAllocations['0']).toBeUndefined();
    expect(s.activePaneId).toBe('bar-left');
  });

  it('addSession with preferSidebar falls back to bar-right if left is occupied', () => {
    useSidebarLayoutStore.setState({ showLeftSidebar: true, showRightSidebar: true });
    usePaneStore.setState({
      layoutMode: '2x2',
      paneAllocations: { 'bar-left': 'existing' },
      sessionOrder: ['existing'],
    });
    usePaneStore.getState().addSession('s1', { preferSidebar: true });
    const s = usePaneStore.getState();
    expect(s.paneAllocations['bar-right']).toBe('s1');
  });

  it('addSession with preferSidebar falls back to grid if no sidebars visible', () => {
    usePaneStore.setState({ layoutMode: '2x2' });
    usePaneStore.getState().addSession('s1', { preferSidebar: true });
    const s = usePaneStore.getState();
    expect(s.paneAllocations['0']).toBe('s1');
  });

  it('addSession with preferSidebar falls back to grid when left/right hidden but top visible', () => {
    useSidebarLayoutStore.setState({ showTopBar: true });
    usePaneStore.setState({ layoutMode: '2x2' });
    usePaneStore.getState().addSession('s1', { preferSidebar: true });
    const s = usePaneStore.getState();
    expect(s.paneAllocations['0']).toBe('s1');
    expect(s.paneAllocations['bar-top']).toBeUndefined();
  });

  it('addSession with preferSidebar uses top/bottom only after grid also full', () => {
    useSidebarLayoutStore.setState({ showTopBar: true, showBottomBar: true });
    usePaneStore.setState({
      layoutMode: '1x1',
      paneAllocations: { '0': 'existing' },
      sessionOrder: ['existing'],
    });
    usePaneStore.getState().addSession('s1', { preferSidebar: true });
    const s = usePaneStore.getState();
    expect(s.paneAllocations['bar-top']).toBe('s1');
  });

  it('removeSession frees a sidebar pane allocation', () => {
    usePaneStore.setState({
      layoutMode: '1x1',
      paneAllocations: { '0': null, 'bar-top': 's1' },
      sessionOrder: ['s1'],
    });
    usePaneStore.getState().removeSession('s1');
    const s = usePaneStore.getState();
    expect(s.sessionOrder).toEqual([]);
    expect(s.paneAllocations['bar-top']).toBeNull();
  });

  describe('visiblePaneIdsInOrder', () => {
    it('returns only grid panes when no sidebars are visible', () => {
      expect(visiblePaneIdsInOrder('2x2')).toEqual(['0', '1', '2', '3']);
    });

    it('appends visible sidebars after grid panes in left/right/top/bottom order', () => {
      useSidebarLayoutStore.setState({
        showLeftSidebar: true,
        showRightSidebar: false,
        showTopBar: true,
        showBottomBar: false,
      });
      expect(visiblePaneIdsInOrder('1x2')).toEqual(['0', '1', 'bar-left', 'bar-top']);
    });
  });

  describe('cycleActivePane', () => {
    it('moves forward through visible panes', () => {
      usePaneStore.setState({ layoutMode: '2x2', activePaneId: '0' });
      usePaneStore.getState().cycleActivePane(1);
      expect(usePaneStore.getState().activePaneId).toBe('1');
    });

    it('moves backward through visible panes', () => {
      usePaneStore.setState({ layoutMode: '2x2', activePaneId: '2' });
      usePaneStore.getState().cycleActivePane(-1);
      expect(usePaneStore.getState().activePaneId).toBe('1');
    });

    it('wraps from the last pane to the first when going forward', () => {
      usePaneStore.setState({ layoutMode: '2x2', activePaneId: '3' });
      usePaneStore.getState().cycleActivePane(1);
      expect(usePaneStore.getState().activePaneId).toBe('0');
    });

    it('wraps from the first pane to the last when going backward', () => {
      usePaneStore.setState({ layoutMode: '2x2', activePaneId: '0' });
      usePaneStore.getState().cycleActivePane(-1);
      expect(usePaneStore.getState().activePaneId).toBe('3');
    });

    it('cycles through grid panes and then visible sidebars', () => {
      useSidebarLayoutStore.setState({ showLeftSidebar: true });
      usePaneStore.setState({ layoutMode: '1x1', activePaneId: '0' });
      usePaneStore.getState().cycleActivePane(1);
      expect(usePaneStore.getState().activePaneId).toBe('bar-left');
      usePaneStore.getState().cycleActivePane(1);
      expect(usePaneStore.getState().activePaneId).toBe('0');
    });

    it('is a no-op when only one pane is visible', () => {
      usePaneStore.setState({ layoutMode: '1x1', activePaneId: '0' });
      usePaneStore.getState().cycleActivePane(1);
      expect(usePaneStore.getState().activePaneId).toBe('0');
    });

    it('jumps to the first pane when the active pane is no longer visible', () => {
      // active pane is a hidden sidebar that is not in the visible list
      usePaneStore.setState({ layoutMode: '2x2', activePaneId: 'bar-bottom' });
      usePaneStore.getState().cycleActivePane(1);
      expect(usePaneStore.getState().activePaneId).toBe('0');
    });
  });
});
