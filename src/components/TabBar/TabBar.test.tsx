import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabBar } from './TabBar';
import { buildTabItems, type TabItem } from './tabBarHelpers';
import { useUiOverlayStore } from '../../stores/uiOverlayStore';
import type { SessionRecord } from '../../hooks/useSessionManager';
import type { FeaturePaneInfo } from '../../utils/paneTypes';

/** Minimal DataTransfer stand-in (jsdom lacks one) for drag-event tests. */
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

function makeSession(id: string, overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id,
    displayName: `Session ${id}`,
    protocol: 'ssh',
    status: 'connected',
    errorMessage: undefined,
    term: {} as SessionRecord['term'],
    fitAddon: {} as SessionRecord['fitAddon'],
    fixedSize: false,
    ...overrides,
  };
}

function makeTabItem(id: string, overrides: Partial<TabItem> = {}): TabItem {
  return {
    id,
    displayName: `Session ${id}`,
    kind: 'session',
    status: 'connected',
    ...overrides,
  };
}

const defaultProps = {
  tabItems: [] as TabItem[],
  activeTabId: null as string | null,
  visibleTabIds: [] as string[],
  onSelect: () => {},
  onClose: () => {},
  onNew: () => {},
  onReorder: () => {},
};

describe('TabBar', () => {
  it('renders one tab per item and marks the active one', () => {
    const items = [makeTabItem('a'), makeTabItem('b')];
    const { container } = render(
      <TabBar {...defaultProps} tabItems={items} activeTabId="b" visibleTabIds={['a', 'b']} />
    );
    const tabs = container.querySelectorAll('.tab');
    expect(tabs.length).toBe(2);
    expect(tabs[1].classList.contains('active')).toBe(true);
    expect(tabs[0].classList.contains('active')).toBe(false);
  });

  it('adds hidden-tab class for items not in visibleTabIds', () => {
    const items = [makeTabItem('a'), makeTabItem('b')];
    const { container } = render(
      <TabBar {...defaultProps} tabItems={items} visibleTabIds={['a']} />
    );
    const tabs = container.querySelectorAll('.tab');
    expect(tabs[0].classList.contains('hidden-tab')).toBe(false);
    expect(tabs[1].classList.contains('hidden-tab')).toBe(true);
  });

  it('clicking a tab selects it, and the close button stops propagation', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const items = [makeTabItem('a')];
    render(
      <TabBar
        {...defaultProps}
        tabItems={items}
        visibleTabIds={['a']}
        onSelect={onSelect}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByText('Session a'));
    expect(onSelect).toHaveBeenCalledWith('a');

    fireEvent.click(screen.getByLabelText('Close tab'));
    expect(onClose).toHaveBeenCalledWith('a');
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('new-tab button invokes onNew', () => {
    const onNew = vi.fn();
    render(<TabBar {...defaultProps} onNew={onNew} />);
    fireEvent.click(screen.getByTitle('New Session'));
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it('renders feature tabs with label only (no icon)', () => {
    const items: TabItem[] = [
      makeTabItem('lv-1', { kind: 'feature', displayName: 'Log Viewer', featureType: 'log-viewer' }),
    ];
    const { container } = render(
      <TabBar {...defaultProps} tabItems={items} visibleTabIds={['lv-1']} />
    );
    expect(container.querySelector('.tab-feature-icon')).toBeNull();
    expect(container.querySelector('.tab-status')).toBeNull();
    expect(screen.getByText('Log Viewer')).toBeTruthy();
  });

  it('renders session tabs without status dot', () => {
    const items = [makeTabItem('s-1')];
    const { container } = render(
      <TabBar {...defaultProps} tabItems={items} visibleTabIds={['s-1']} />
    );
    expect(container.querySelector('.tab-status')).toBeNull();
    expect(container.querySelector('.tab-feature-icon')).toBeNull();
  });

  // --- Features dropdown ---

  it('does not render Features button when no feature callbacks are provided', () => {
    render(<TabBar {...defaultProps} />);
    expect(screen.queryByTitle('Features')).toBeNull();
  });

  it('renders Features button when feature callbacks are provided', () => {
    render(
      <TabBar
        {...defaultProps}
        onNewLogViewer={() => {}}
        onNewPingMonitor={() => {}}
        onNewTextEditor={() => {}}
        onNewFileExplorer={() => {}}
      />
    );
    expect(screen.getByTitle('Features')).toBeTruthy();
  });

  it('clicking Features button shows dropdown with 4 items', () => {
    render(
      <TabBar
        {...defaultProps}
        onNewLogViewer={() => {}}
        onNewPingMonitor={() => {}}
        onNewTextEditor={() => {}}
        onNewFileExplorer={() => {}}
      />
    );
    fireEvent.click(screen.getByTitle('Features'));

    expect(screen.getByText('Log Viewer')).toBeTruthy();
    expect(screen.getByText('Ping Monitor')).toBeTruthy();
    expect(screen.getByText('Text Editor')).toBeTruthy();
    expect(screen.getByText('File Explorer')).toBeTruthy();
  });

  it('clicking a feature item calls the callback and closes dropdown', () => {
    const onNewLogViewer = vi.fn();
    const onNewTextEditor = vi.fn();
    render(
      <TabBar
        {...defaultProps}
        onNewLogViewer={onNewLogViewer}
        onNewPingMonitor={() => {}}
        onNewTextEditor={onNewTextEditor}
        onNewFileExplorer={() => {}}
      />
    );
    fireEvent.click(screen.getByTitle('Features'));
    fireEvent.click(screen.getByText('Log Viewer'));
    expect(onNewLogViewer).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Log Viewer')).toBeNull();

    fireEvent.click(screen.getByTitle('Features'));
    fireEvent.click(screen.getByText('Text Editor'));
    expect(onNewTextEditor).toHaveBeenCalledTimes(1);
  });

  it('only renders dropdown items for provided callbacks', () => {
    render(
      <TabBar
        {...defaultProps}
        onNewLogViewer={() => {}}
        onNewTextEditor={() => {}}
      />
    );
    fireEvent.click(screen.getByTitle('Features'));

    expect(screen.getByText('Log Viewer')).toBeTruthy();
    expect(screen.getByText('Text Editor')).toBeTruthy();
    expect(screen.queryByText('Ping Monitor')).toBeNull();
    expect(screen.queryByText('File Explorer')).toBeNull();
  });

  // --- AI Watch button ---

  it('renders watch button on session tabs when onToggleWatch is provided', () => {
    const items = [makeTabItem('s-1')];
    const { container } = render(
      <TabBar {...defaultProps} tabItems={items} visibleTabIds={['s-1']} onToggleWatch={() => {}} />
    );
    expect(container.querySelector('.tab-watch-btn')).toBeTruthy();
  });

  it('does not render watch button on feature tabs', () => {
    const items: TabItem[] = [
      makeTabItem('lv-1', { kind: 'feature', displayName: 'Log Viewer', featureType: 'log-viewer' }),
    ];
    const { container } = render(
      <TabBar {...defaultProps} tabItems={items} visibleTabIds={['lv-1']} onToggleWatch={() => {}} />
    );
    expect(container.querySelector('.tab-watch-btn')).toBeNull();
  });

  it('does not render watch button when onToggleWatch is not provided', () => {
    const items = [makeTabItem('s-1')];
    const { container } = render(
      <TabBar {...defaultProps} tabItems={items} visibleTabIds={['s-1']} />
    );
    expect(container.querySelector('.tab-watch-btn')).toBeNull();
  });

  it('clicking watch button calls onToggleWatch and does not select tab', () => {
    const onToggleWatch = vi.fn();
    const onSelect = vi.fn();
    const items = [makeTabItem('s-1')];
    render(
      <TabBar {...defaultProps} tabItems={items} visibleTabIds={['s-1']} onSelect={onSelect} onToggleWatch={onToggleWatch} />
    );
    fireEvent.click(screen.getByLabelText('Start AI Watch'));
    expect(onToggleWatch).toHaveBeenCalledWith('s-1');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('adds active-pane-tab class on the active tab', () => {
    const items = [makeTabItem('a'), makeTabItem('b')];
    const { container } = render(
      <TabBar {...defaultProps} tabItems={items} activeTabId="b" visibleTabIds={['a', 'b']} />
    );
    const tabs = container.querySelectorAll('.tab');
    expect(tabs[0].classList.contains('active-pane-tab')).toBe(false);
    expect(tabs[1].classList.contains('active-pane-tab')).toBe(true);
  });

  it('adds is-ai-tab class on AI chat feature tabs', () => {
    const items: TabItem[] = [
      makeTabItem('ai-1', { kind: 'feature', displayName: 'AI Chat', featureType: 'ai-chat', isAiTab: true }),
      makeTabItem('lv-1', { kind: 'feature', displayName: 'Log Viewer', featureType: 'log-viewer' }),
    ];
    const { container } = render(
      <TabBar {...defaultProps} tabItems={items} visibleTabIds={['ai-1', 'lv-1']} />
    );
    const tabs = container.querySelectorAll('.tab');
    expect(tabs[0].classList.contains('is-ai-tab')).toBe(true);
    expect(tabs[1].classList.contains('is-ai-tab')).toBe(false);
  });

  it('adds gemini-linked-tab class when isWatching is true', () => {
    const items = [makeTabItem('s-1', { isWatching: true })];
    const { container } = render(
      <TabBar {...defaultProps} tabItems={items} visibleTabIds={['s-1']} onToggleWatch={() => {}} />
    );
    expect(container.querySelector('.tab.gemini-linked-tab')).toBeTruthy();
    expect(container.querySelector('.tab-watch-btn.watching')).toBeTruthy();
  });

  it('does not add gemini-linked-tab class when isWatching is false', () => {
    const items = [makeTabItem('s-1', { isWatching: false })];
    const { container } = render(
      <TabBar {...defaultProps} tabItems={items} visibleTabIds={['s-1']} onToggleWatch={() => {}} />
    );
    expect(container.querySelector('.tab.gemini-linked-tab')).toBeNull();
  });

  it('adds connecting class when status is connecting', () => {
    const items = [makeTabItem('s-1', { status: 'connecting' })];
    const { container } = render(
      <TabBar {...defaultProps} tabItems={items} visibleTabIds={['s-1']} />
    );
    const tab = container.querySelector('.tab');
    expect(tab?.classList.contains('connecting')).toBe(true);
    expect(tab?.classList.contains('error')).toBe(false);
  });

  it('does not add connecting class when status is connected', () => {
    const items = [makeTabItem('s-1', { status: 'connected' })];
    const { container } = render(
      <TabBar {...defaultProps} tabItems={items} visibleTabIds={['s-1']} />
    );
    const tab = container.querySelector('.tab');
    expect(tab?.classList.contains('connecting')).toBe(false);
  });

  it('connecting and error are mutually exclusive on a tab', () => {
    const items = [makeTabItem('s-1', { status: 'error' })];
    const { container } = render(
      <TabBar {...defaultProps} tabItems={items} visibleTabIds={['s-1']} />
    );
    const tab = container.querySelector('.tab');
    expect(tab?.classList.contains('error')).toBe(true);
    expect(tab?.classList.contains('connecting')).toBe(false);
  });

  // --- Drag hides the Web Browser pane's native webview ---

  it('dragging a tab sets sessionDragging, and drag end clears it', () => {
    useUiOverlayStore.setState({ sessionDragging: false });
    const items = [makeTabItem('a'), makeTabItem('b')];
    const { container } = render(
      <TabBar {...defaultProps} tabItems={items} visibleTabIds={['a', 'b']} />
    );
    const tab = container.querySelector('.tab') as HTMLElement;

    fireEvent.dragStart(tab, { dataTransfer: makeDataTransfer() });
    expect(useUiOverlayStore.getState().sessionDragging).toBe(true);

    fireEvent.dragEnd(tab, { dataTransfer: makeDataTransfer() });
    expect(useUiOverlayStore.getState().sessionDragging).toBe(false);
  });

  // --- Tab context menu ---

  it('right-click on SSH session tab shows Watch + Save to Host Tree (no Bookmark)', () => {
    const items = [makeTabItem('s-1', { protocol: 'ssh' })];
    render(
      <TabBar
        {...defaultProps}
        tabItems={items}
        visibleTabIds={['s-1']}
        onToggleWatch={() => {}}
        onSaveToHostTree={() => {}}
      />,
    );
    fireEvent.contextMenu(screen.getByText('Session s-1'));
    expect(screen.getByText('AI Watch')).toBeTruthy();
    expect(screen.getByText('Save to Host Tree…')).toBeTruthy();
    expect(screen.queryByText('Add Bookmark…')).toBeNull();
  });

  it('right-click on Telnet session tab opens the menu', () => {
    const items = [makeTabItem('s-1', { protocol: 'telnet' })];
    render(
      <TabBar
        {...defaultProps}
        tabItems={items}
        visibleTabIds={['s-1']}
        onSaveToHostTree={() => {}}
      />,
    );
    fireEvent.contextMenu(screen.getByText('Session s-1'));
    expect(screen.getByText('Save to Host Tree…')).toBeTruthy();
  });

  it('Watch item label reflects the isWatching state', () => {
    const off = [makeTabItem('s-1', { protocol: 'ssh', isWatching: false })];
    const { rerender } = render(
      <TabBar {...defaultProps} tabItems={off} visibleTabIds={['s-1']} onToggleWatch={() => {}} />,
    );
    fireEvent.contextMenu(screen.getByText('Session s-1'));
    expect(screen.getByText('AI Watch')).toBeTruthy();
    expect(screen.queryByText('Stop AI Watch')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });

    const on = [makeTabItem('s-1', { protocol: 'ssh', isWatching: true })];
    rerender(
      <TabBar {...defaultProps} tabItems={on} visibleTabIds={['s-1']} onToggleWatch={() => {}} />,
    );
    fireEvent.contextMenu(screen.getByText('Session s-1'));
    expect(screen.getByText('Stop AI Watch')).toBeTruthy();
    expect(screen.queryByText('AI Watch')).toBeNull();
  });

  it('clicking the Watch item calls onToggleWatch and closes the menu', () => {
    const onToggleWatch = vi.fn();
    const items = [makeTabItem('s-1', { protocol: 'ssh' })];
    render(
      <TabBar {...defaultProps} tabItems={items} visibleTabIds={['s-1']} onToggleWatch={onToggleWatch} />,
    );
    fireEvent.contextMenu(screen.getByText('Session s-1'));
    fireEvent.click(screen.getByText('AI Watch'));
    expect(onToggleWatch).toHaveBeenCalledWith('s-1');
    expect(screen.queryByText('AI Watch')).toBeNull();
  });

  it('non-SSH/Telnet session tab shows Watch but NOT Save to Host Tree', () => {
    const items = [makeTabItem('s-1', { protocol: 'serial' })];
    render(
      <TabBar
        {...defaultProps}
        tabItems={items}
        visibleTabIds={['s-1']}
        onToggleWatch={() => {}}
        onSaveToHostTree={() => {}}
      />,
    );
    fireEvent.contextMenu(screen.getByText('Session s-1'));
    expect(screen.getByText('AI Watch')).toBeTruthy();
    expect(screen.queryByText('Save to Host Tree…')).toBeNull();
  });

  it('session tab with no applicable callbacks does NOT open the menu', () => {
    const items = [makeTabItem('s-1', { protocol: 'serial' })];
    render(
      <TabBar {...defaultProps} tabItems={items} visibleTabIds={['s-1']} onSaveToHostTree={() => {}} />,
    );
    fireEvent.contextMenu(screen.getByText('Session s-1'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('clicking the Save item calls onSaveToHostTree and closes the menu', () => {
    const onSaveToHostTree = vi.fn();
    const items = [makeTabItem('s-1', { protocol: 'ssh' })];
    render(
      <TabBar
        {...defaultProps}
        tabItems={items}
        visibleTabIds={['s-1']}
        onSaveToHostTree={onSaveToHostTree}
      />,
    );
    fireEvent.contextMenu(screen.getByText('Session s-1'));
    fireEvent.click(screen.getByText('Save to Host Tree…'));
    expect(onSaveToHostTree).toHaveBeenCalledWith('s-1');
    expect(screen.queryByText('Save to Host Tree…')).toBeNull();
  });

  it('right-click on web browser tab shows Add Bookmark only and invokes onBookmark', () => {
    const onBookmark = vi.fn();
    const items: TabItem[] = [
      makeTabItem('wb-1', { kind: 'feature', displayName: 'Web', featureType: 'web-browser' }),
    ];
    render(
      <TabBar {...defaultProps} tabItems={items} visibleTabIds={['wb-1']} onBookmark={onBookmark} />,
    );
    fireEvent.contextMenu(screen.getByText('Web'));
    expect(screen.getByText('Add Bookmark…')).toBeTruthy();
    expect(screen.queryByText('AI Watch')).toBeNull();
    expect(screen.queryByText('Save to Host Tree…')).toBeNull();
    fireEvent.click(screen.getByText('Add Bookmark…'));
    expect(onBookmark).toHaveBeenCalledWith('wb-1');
    expect(screen.queryByText('Add Bookmark…')).toBeNull();
  });

  it('web browser tab without onBookmark does NOT open the menu', () => {
    const items: TabItem[] = [
      makeTabItem('wb-1', { kind: 'feature', displayName: 'Web', featureType: 'web-browser' }),
    ];
    render(<TabBar {...defaultProps} tabItems={items} visibleTabIds={['wb-1']} />);
    fireEvent.contextMenu(screen.getByText('Web'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('right-click on a tab with no menu still suppresses the default menu', () => {
    const items: TabItem[] = [
      makeTabItem('lv-1', { kind: 'feature', displayName: 'Log Viewer', featureType: 'log-viewer' }),
    ];
    render(
      <TabBar {...defaultProps} tabItems={items} visibleTabIds={['lv-1']} onSaveToHostTree={() => {}} />,
    );
    // fireEvent returns false when a handler called preventDefault (default suppressed).
    const notPrevented = fireEvent.contextMenu(screen.getByText('Log Viewer'));
    expect(notPrevented).toBe(false);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Escape key closes the context menu', () => {
    const items = [makeTabItem('s-1', { protocol: 'ssh' })];
    render(
      <TabBar
        {...defaultProps}
        tabItems={items}
        visibleTabIds={['s-1']}
        onSaveToHostTree={() => {}}
      />,
    );
    fireEvent.contextMenu(screen.getByText('Session s-1'));
    expect(screen.getByText('Save to Host Tree…')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Save to Host Tree…')).toBeNull();
  });
});

describe('buildTabItems', () => {
  it('builds items from sessions and features in sessionOrder', () => {
    const sessions = [makeSession('s-1'), makeSession('s-2')];
    const features: FeaturePaneInfo[] = [
      { id: 'lv-1', type: 'log-viewer', displayName: 'Log Viewer' },
    ];
    const order = ['s-1', 'lv-1', 's-2'];

    const items = buildTabItems(sessions, features, order);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ id: 's-1', kind: 'session' });
    expect(items[1]).toMatchObject({ id: 'lv-1', kind: 'feature', featureType: 'log-viewer' });
    expect(items[2]).toMatchObject({ id: 's-2', kind: 'session' });
  });

  it('skips IDs not found in sessions or features', () => {
    const items = buildTabItems([], [], ['missing-id']);
    expect(items).toHaveLength(0);
  });

  it('sets isWatching based on watchingSessionId', () => {
    const sessions = [makeSession('s-1'), makeSession('s-2')];
    const items = buildTabItems(sessions, [], ['s-1', 's-2'], 's-2');
    expect(items[0].isWatching).toBe(false);
    expect(items[1].isWatching).toBe(true);
  });

  it('sets isAiTab true for ai-chat feature panes', () => {
    const features: FeaturePaneInfo[] = [
      { id: 'ai-1', type: 'ai-chat', displayName: 'AI Chat' },
      { id: 'lv-1', type: 'log-viewer', displayName: 'Log Viewer' },
    ];
    const items = buildTabItems([], features, ['ai-1', 'lv-1']);
    expect(items[0].isAiTab).toBe(true);
    expect(items[1].isAiTab).toBe(false);
  });

  it('sets isWatching to false for all when watchingSessionId is null', () => {
    const sessions = [makeSession('s-1')];
    const items = buildTabItems(sessions, [], ['s-1'], null);
    expect(items[0].isWatching).toBe(false);
  });
});
