import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Dock } from './Dock';
import { dockMenuPlacement } from './dockHelpers';
import { useSettingsStore } from '../../stores/settingsStore';
import { usePaneStore } from '../../stores/paneStore';
import { useSidebarLayoutStore } from '../../stores/sidebarLayoutStore';
import { useUiOverlayStore } from '../../stores/uiOverlayStore';

/** Minimal DataTransfer stand-in (jsdom lacks one). */
function makeDataTransfer() {
  const store: Record<string, string> = {};
  return {
    effectAllowed: 'none',
    dropEffect: 'none',
    setData: (type: string, val: string) => {
      store[type] = val;
    },
    getData: (type: string) => store[type] ?? '',
    get types() {
      return Object.keys(store);
    },
  };
}

function renderDock() {
  return render(
    <Dock
      onOpenSettings={() => {}}
      onOpenHelp={() => {}}
      tabItems={[]}
      activeTabId={null}
      visiblePanes={['0']}
      paneAllocations={{}}
      onSelect={() => {}}
      onClose={() => {}}
      onNew={() => {}}
      onOpenLocal={() => {}}
      onMoveHidden={() => {}}
      onPlace={() => {}}
      onHide={() => {}}
    />
  );
}

describe('Dock', () => {
  beforeEach(() => {
    useSettingsStore.getState().update('dockPosition', 'left');
    useSettingsStore.getState().update('dockCompact', false);
    usePaneStore.setState({ layoutMode: '1x1' });
    useSidebarLayoutStore.setState({ showLeftSidebar: false, showRightSidebar: false, showTopBar: false, showBottomBar: false });
    useUiOverlayStore.setState({ sessionDragging: false });
  });

  it('on the left it is a column with every icon button and a vertical tab list', () => {
    const { container } = renderDock();
    expect(container.querySelector('.dock.dock-left.dock-vertical')).not.toBeNull();
    expect(container.querySelector('.tab-bar-vertical')).not.toBeNull();
    expect(screen.getByTitle('Grid (2x2)')).toBeTruthy();
    expect(screen.getByTitle('Settings')).toBeTruthy();
  });

  it('the position buttons move it, and on the top it folds the layout and bar buttons', () => {
    const { container } = renderDock();
    fireEvent.click(screen.getByTitle('Put the tabs at the top'));
    expect(useSettingsStore.getState().dockPosition).toBe('top');
    expect(container.querySelector('.dock.dock-top.dock-horizontal')).not.toBeNull();
    expect(container.querySelector('.tab-bar-horizontal')).not.toBeNull();
    expect(screen.queryByTitle('Grid (2x2)')).toBeNull();
    expect(screen.getByTitle('Pane layout')).toBeTruthy();
    expect(screen.getByTitle('Toggle bars')).toBeTruthy();
    // The rarely-used window / wrap / help / settings buttons stay as they are.
    expect(screen.getByTitle('Settings')).toBeTruthy();
  });

  it('the shrink button toggles the compact dock', () => {
    const { container } = renderDock();
    fireEvent.click(screen.getByTitle('Make narrower'));
    expect(useSettingsStore.getState().dockCompact).toBe(true);
    expect(container.querySelector('.tab-bar-vertical.compact')).not.toBeNull();
    fireEvent.click(screen.getByTitle('Expand'));
    expect(useSettingsStore.getState().dockCompact).toBe(false);
  });

  it('dragging the grip to an edge zone moves the dock there', async () => {
    const { container } = renderDock();
    const grip = container.querySelector('.dock-grip') as HTMLElement;
    const dt = makeDataTransfer();
    fireEvent.dragStart(grip, { dataTransfer: dt });
    expect(useUiOverlayStore.getState().sessionDragging).toBe(true);
    // The zones appear on the next tick (not inside dragstart).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const zone = container.querySelector('.dock-drop-zone-bottom') as HTMLElement;
    expect(zone).not.toBeNull();
    fireEvent.dragOver(zone, { dataTransfer: dt });
    fireEvent.drop(zone, { dataTransfer: dt });
    expect(useSettingsStore.getState().dockPosition).toBe('bottom');
    expect(useUiOverlayStore.getState().sessionDragging).toBe(false);
    expect(container.querySelector('.dock-drop-zone')).toBeNull();
  });

  it('ignores a tab being dragged over the zones', async () => {
    const { container } = renderDock();
    const dt = makeDataTransfer();
    fireEvent.dragStart(container.querySelector('.dock-grip') as HTMLElement, { dataTransfer: dt });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const tabDrag = makeDataTransfer();
    tabDrag.setData('application/x-hotty-session', 's-1');
    const notCancelled = fireEvent.dragOver(container.querySelector('.dock-drop-zone-top') as HTMLElement, {
      dataTransfer: tabDrag,
    });
    expect(notCancelled).toBe(true);
  });
});

describe('dockMenuPlacement', () => {
  it('opens away from the edge the dock is on', () => {
    expect(dockMenuPlacement('top', false)).toBe('down');
    expect(dockMenuPlacement('bottom', false)).toBe('up');
    expect(dockMenuPlacement('left', false)).toBe('down');
    expect(dockMenuPlacement('left', true)).toBe('right');
    expect(dockMenuPlacement('right', true)).toBe('left');
  });
});
