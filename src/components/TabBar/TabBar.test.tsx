import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabBar } from './TabBar';
import { buildTabItems, type TabItem } from './tabBarHelpers';
import type { SessionRecord } from '../../hooks/useSessionManager';
import type { FeaturePaneInfo } from '../../utils/paneTypes';

function makeSession(id: string, overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id,
    displayName: `Session ${id}`,
    protocol: 'ssh',
    status: 'connected',
    errorMessage: undefined,
    term: {} as SessionRecord['term'],
    fitAddon: {} as SessionRecord['fitAddon'],
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

  it('renders feature tabs with feature icon instead of status dot', () => {
    const items: TabItem[] = [
      makeTabItem('lv-1', { kind: 'feature', displayName: 'Log Viewer', featureType: 'log-viewer' }),
    ];
    const { container } = render(
      <TabBar {...defaultProps} tabItems={items} visibleTabIds={['lv-1']} />
    );
    expect(container.querySelector('.tab-feature-icon')).toBeTruthy();
    expect(container.querySelector('.tab-status')).toBeNull();
    expect(screen.getByText('Log Viewer')).toBeTruthy();
  });

  it('renders session tabs with status dot', () => {
    const items = [makeTabItem('s-1')];
    const { container } = render(
      <TabBar {...defaultProps} tabItems={items} visibleTabIds={['s-1']} />
    );
    expect(container.querySelector('.tab-status')).toBeTruthy();
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
});
