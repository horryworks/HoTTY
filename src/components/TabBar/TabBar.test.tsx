import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { TabBar } from './TabBar';
import { useTabActivityStore } from '../../stores/tabActivityStore';
import { buildTabItems, hiddenTabsThatFit, type TabItem } from './tabBarHelpers';
import { useUiOverlayStore } from '../../stores/uiOverlayStore';
import { useSettingsStore } from '../../stores/settingsStore';
import type { SessionRecord } from '../../hooks/useSessionManager';
import type { FeaturePaneInfo } from '../../utils/paneTypes';
import { resetLocalShellsCache } from '../../hooks/useLocalShells';

// What the New Session menu finds installed. Each test can change the answers.
const shells = vi.hoisted(() => ({
  listWslDistributions: vi.fn(),
  detectGitBash: vi.fn(),
}));
vi.mock('../../services/tauriService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/tauriService')>();
  return { ...actual, tauriService: { ...actual.tauriService, ...shells } };
});

const GIT_BASH = 'C:/Program Files/Git/bin/bash.exe';

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
};

type BarProps = Partial<ComponentProps<typeof TabBar>> & {
  tabItems: TabItem[];
  /** Tabs on screen, in pane order: the n-th one is shown in pane "n". */
  visibleTabIds?: string[];
};

/** TabBar with the pane wiring derived from a plain list of shown tab ids. */
function Bar({ visibleTabIds = [], ...rest }: BarProps) {
  const visiblePanes = visibleTabIds.map((_, i) => String(i));
  const paneAllocations = Object.fromEntries(visibleTabIds.map((id, i) => [String(i), id]));
  return (
    <TabBar
      activeTabId={null}
      orientation="vertical"
      menuPlacement="down"
      visiblePanes={visiblePanes}
      paneAllocations={paneAllocations}
      onSelect={() => {}}
      onClose={() => {}}
      onNew={() => {}}
      onOpenLocal={() => {}}
      onMoveHidden={() => {}}
      onPlace={() => {}}
      onHide={() => {}}
      {...rest}
    />
  );
}

/** The tab rows only (the New Session row is also styled as a tab). */
const rows = (c: HTMLElement) => c.querySelectorAll('.tab[data-session-id]');
const firstRow = (c: HTMLElement) => c.querySelector('.tab[data-session-id]');

beforeEach(() => {
  useTabActivityStore.setState({ activity: {} });
  resetLocalShellsCache();
  shells.listWslDistributions.mockResolvedValue(['Ubuntu-24.04']);
  shells.detectGitBash.mockResolvedValue(GIT_BASH);
});

/** Open the New Session menu and wait until it knows what is installed. */
async function openNewSessionMenu() {
  fireEvent.click(screen.getByTitle('New Session'));
  await waitFor(() => expect(shells.detectGitBash).toHaveBeenCalled());
  await waitFor(() => {
    const menu = screen.getAllByRole('menu')[0];
    for (const b of within(menu).getAllByRole('menuitem')) {
      if (b.textContent?.startsWith('WSL') || b.textContent?.startsWith('Git Bash')) {
        // Settled once each row is either enabled or says why it is not.
        expect((b as HTMLButtonElement).disabled ? b.textContent : 'enabled').not.toMatch(/^(WSL|Git Bash)$/);
      }
    }
  });
  return screen.getAllByRole('menu')[0];
}

describe('TabBar', () => {
  it('renders one tab per item and marks the active one', () => {
    const items = [makeTabItem('a'), makeTabItem('b')];
    const { container } = render(
      <Bar {...defaultProps} tabItems={items} activeTabId="b" visibleTabIds={['a', 'b']} />
    );
    const tabs = rows(container);
    expect(tabs.length).toBe(2);
    expect(tabs[1].classList.contains('active')).toBe(true);
    expect(tabs[0].classList.contains('active')).toBe(false);
  });

  it('adds hidden-tab class for items not in visibleTabIds', () => {
    const items = [makeTabItem('a'), makeTabItem('b')];
    const { container } = render(
      <Bar {...defaultProps} tabItems={items} visibleTabIds={['a']} />
    );
    const tabs = rows(container);
    expect(tabs[0].classList.contains('hidden-tab')).toBe(false);
    expect(tabs[1].classList.contains('hidden-tab')).toBe(true);
  });

  it('clicking a tab selects it, and the close button stops propagation', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const items = [makeTabItem('a')];
    render(
      <Bar
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

  it('the New Session menu lists the sessions, then GCP and Web; dialog rows ask for their dialog', async () => {
    const onNew = vi.fn();
    render(<Bar {...defaultProps} onNew={onNew} onNewLogViewer={() => {}} />);
    const menu = await openNewSessionMenu();
    const items = within(menu).getAllByRole('menuitem').map((b) => b.textContent);
    expect(items).toEqual([
      'SSH', 'Telnet', 'Serial', 'WSL', 'Command Prompt', 'PowerShell', 'Git Bash', 'GCP', 'Web', 'Log Viewer',
    ]);
    fireEvent.click(screen.getByText('Telnet'));
    expect(onNew).toHaveBeenCalledWith('telnet');
    expect(screen.queryByRole('menu')).toBeNull();

    for (const [row, choice] of [['Serial', 'serial'], ['GCP', 'gcp'], ['Web', 'web']] as const) {
      fireEvent.click(screen.getByTitle('New Session'));
      fireEvent.click(within(screen.getByRole('menu')).getByText(row));
      expect(onNew).toHaveBeenLastCalledWith(choice);
    }
  });

  it('the local shells start at once, with no dialog', async () => {
    const onNew = vi.fn();
    const onOpenLocal = vi.fn();
    render(<Bar {...defaultProps} onNew={onNew} onOpenLocal={onOpenLocal} />);
    const picks = [
      ['Command Prompt', { protocol: 'cmd' }],
      ['PowerShell', { protocol: 'powershell' }],
      ['Git Bash', { protocol: 'git-bash', shellPath: GIT_BASH }],
      // Only one distribution: no list beside the menu.
      ['WSL', { protocol: 'wsl', distribution: 'Ubuntu-24.04' }],
    ] as const;
    for (const [row, choice] of picks) {
      const menu = await openNewSessionMenu();
      fireEvent.click(within(menu).getByText(row));
      expect(onOpenLocal).toHaveBeenLastCalledWith(choice);
      expect(screen.queryByRole('menu')).toBeNull();
    }
    expect(onNew).not.toHaveBeenCalled();
  });

  it('with several WSL distributions, WSL lists them beside the menu', async () => {
    shells.listWslDistributions.mockResolvedValue(['Ubuntu-24.04', 'Debian']);
    const onOpenLocal = vi.fn();
    render(<Bar {...defaultProps} onOpenLocal={onOpenLocal} />);
    const menu = await openNewSessionMenu();
    await waitFor(() => expect(within(menu).getByText('WSL').closest('button')!.getAttribute('aria-haspopup')).toBe('menu'));
    fireEvent.click(within(menu).getByText('WSL'));
    const sub = screen.getByRole('menu', { name: 'WSL' });
    expect(within(sub).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Ubuntu-24.04', 'Debian']);
    fireEvent.click(within(sub).getByText('Debian'));
    expect(onOpenLocal).toHaveBeenCalledWith({ protocol: 'wsl', distribution: 'Debian' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('WSL and Git Bash are greyed out and say so when not installed', async () => {
    shells.listWslDistributions.mockResolvedValue([]);
    shells.detectGitBash.mockResolvedValue(null);
    const onOpenLocal = vi.fn();
    render(<Bar {...defaultProps} onOpenLocal={onOpenLocal} />);
    const menu = await openNewSessionMenu();
    for (const row of ['WSL', 'Git Bash']) {
      const button = within(menu).getByText(row).closest('button')!;
      expect(button.disabled).toBe(true);
      expect(button.textContent).toBe(`${row}Not installed`);
      fireEvent.click(button);
    }
    expect(onOpenLocal).not.toHaveBeenCalled();
  });

  it('the New Session menu leaves out Web while the Web Browser feature is off', () => {
    const before = useSettingsStore.getState().enabledFeatures;
    useSettingsStore.setState({ enabledFeatures: { ...before, 'web-browser': false } });
    try {
      render(<Bar {...defaultProps} />);
      fireEvent.click(screen.getByTitle('New Session'));
      const menu = screen.getByRole('menu');
      expect(within(menu).getByText('GCP')).toBeTruthy();
      expect(within(menu).queryByText('Web')).toBeNull();
    } finally {
      useSettingsStore.setState({ enabledFeatures: before });
    }
  });

  it('feature tabs carry no state dot', () => {
    const items: TabItem[] = [
      makeTabItem('lv-1', { kind: 'feature', displayName: 'Log Viewer', featureType: 'log-viewer' }),
    ];
    const { container } = render(
      <Bar {...defaultProps} tabItems={items} visibleTabIds={['lv-1']} />
    );
    expect(container.querySelector('.tab-state-dot')).toBeNull();
    expect(screen.getByText('Log Viewer')).toBeTruthy();
  });

  it('session tabs show their connection state as a dot', () => {
    const items = [
      makeTabItem('a', { status: 'connected' }),
      makeTabItem('b', { status: 'connecting' }),
      makeTabItem('c', { status: 'error' }),
      makeTabItem('d', { status: 'disconnected' }),
    ];
    const { container } = render(
      <Bar {...defaultProps} tabItems={items} visibleTabIds={['a', 'b', 'c', 'd']} />
    );
    const dots = Array.from(rows(container)).map((r) => r.querySelector('.tab-state-dot')?.className);
    expect(dots).toEqual([
      'tab-state-dot ok',
      'tab-state-dot connecting',
      'tab-state-dot bad',
      'tab-state-dot bad',
    ]);
  });

  // --- New Session menu: dialog + enabled feature panes ---

  it('the New Session menu lists only the features that are enabled', () => {
    render(<Bar {...defaultProps} onNewLogViewer={() => {}} onNewFileServer={() => {}} />);
    fireEvent.click(screen.getByTitle('New Session'));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('Log Viewer')).toBeTruthy();
    expect(within(menu).getByText('File Server')).toBeTruthy();
    expect(within(menu).queryByText('Ping Monitor')).toBeNull();
    expect(within(menu).queryByText('AI Chat')).toBeNull();
  });

  it('picking a feature calls its callback and closes the menu', () => {
    const onNewLogViewer = vi.fn();
    const onNewAiChat = vi.fn();
    render(<Bar {...defaultProps} onNewLogViewer={onNewLogViewer} onNewAiChat={onNewAiChat} />);
    fireEvent.click(screen.getByTitle('New Session'));
    fireEvent.click(screen.getByText('Log Viewer'));
    expect(onNewLogViewer).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(screen.getByTitle('New Session'));
    fireEvent.click(screen.getByText('AI Chat'));
    expect(onNewAiChat).toHaveBeenCalledTimes(1);
  });

  it('Escape closes the New Session menu', () => {
    render(<Bar {...defaultProps} onNewLogViewer={() => {}} />);
    fireEvent.click(screen.getByTitle('New Session'));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  // --- AI Watch button ---

  it('renders watch button on session tabs when onToggleWatch is provided', () => {
    const items = [makeTabItem('s-1')];
    const { container } = render(
      <Bar {...defaultProps} tabItems={items} visibleTabIds={['s-1']} onToggleWatch={() => {}} />
    );
    expect(container.querySelector('.tab-watch-btn')).toBeTruthy();
  });

  it('does not render watch button on feature tabs', () => {
    const items: TabItem[] = [
      makeTabItem('lv-1', { kind: 'feature', displayName: 'Log Viewer', featureType: 'log-viewer' }),
    ];
    const { container } = render(
      <Bar {...defaultProps} tabItems={items} visibleTabIds={['lv-1']} onToggleWatch={() => {}} />
    );
    expect(container.querySelector('.tab-watch-btn')).toBeNull();
  });

  it('does not render watch button when onToggleWatch is not provided', () => {
    const items = [makeTabItem('s-1')];
    const { container } = render(
      <Bar {...defaultProps} tabItems={items} visibleTabIds={['s-1']} />
    );
    expect(container.querySelector('.tab-watch-btn')).toBeNull();
  });

  it('clicking watch button calls onToggleWatch and does not select tab', () => {
    const onToggleWatch = vi.fn();
    const onSelect = vi.fn();
    const items = [makeTabItem('s-1')];
    render(
      <Bar {...defaultProps} tabItems={items} visibleTabIds={['s-1']} onSelect={onSelect} onToggleWatch={onToggleWatch} />
    );
    fireEvent.click(screen.getByLabelText('Start AI Watch'));
    expect(onToggleWatch).toHaveBeenCalledWith('s-1');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('adds active-pane-tab class on the active tab', () => {
    const items = [makeTabItem('a'), makeTabItem('b')];
    const { container } = render(
      <Bar {...defaultProps} tabItems={items} activeTabId="b" visibleTabIds={['a', 'b']} />
    );
    const tabs = rows(container);
    expect(tabs[0].classList.contains('active-pane-tab')).toBe(false);
    expect(tabs[1].classList.contains('active-pane-tab')).toBe(true);
  });

  it('adds is-ai-tab class on AI chat feature tabs', () => {
    const items: TabItem[] = [
      makeTabItem('ai-1', { kind: 'feature', displayName: 'AI Chat', featureType: 'ai-chat', isAiTab: true }),
      makeTabItem('lv-1', { kind: 'feature', displayName: 'Log Viewer', featureType: 'log-viewer' }),
    ];
    const { container } = render(
      <Bar {...defaultProps} tabItems={items} visibleTabIds={['ai-1', 'lv-1']} />
    );
    const tabs = rows(container);
    expect(tabs[0].classList.contains('is-ai-tab')).toBe(true);
    expect(tabs[1].classList.contains('is-ai-tab')).toBe(false);
  });

  it('adds gemini-linked-tab class when isWatching is true', () => {
    const items = [makeTabItem('s-1', { isWatching: true })];
    const { container } = render(
      <Bar {...defaultProps} tabItems={items} visibleTabIds={['s-1']} onToggleWatch={() => {}} />
    );
    expect(container.querySelector('.tab.gemini-linked-tab')).toBeTruthy();
    expect(container.querySelector('.tab-watch-btn.watching')).toBeTruthy();
  });

  it('does not add gemini-linked-tab class when isWatching is false', () => {
    const items = [makeTabItem('s-1', { isWatching: false })];
    const { container } = render(
      <Bar {...defaultProps} tabItems={items} visibleTabIds={['s-1']} onToggleWatch={() => {}} />
    );
    expect(container.querySelector('.tab.gemini-linked-tab')).toBeNull();
  });

  it('adds connecting class when status is connecting', () => {
    const items = [makeTabItem('s-1', { status: 'connecting' })];
    const { container } = render(
      <Bar {...defaultProps} tabItems={items} visibleTabIds={['s-1']} />
    );
    const tab = firstRow(container);
    expect(tab?.classList.contains('connecting')).toBe(true);
    expect(tab?.classList.contains('error')).toBe(false);
  });

  it('does not add connecting class when status is connected', () => {
    const items = [makeTabItem('s-1', { status: 'connected' })];
    const { container } = render(
      <Bar {...defaultProps} tabItems={items} visibleTabIds={['s-1']} />
    );
    const tab = firstRow(container);
    expect(tab?.classList.contains('connecting')).toBe(false);
  });

  it('connecting and error are mutually exclusive on a tab', () => {
    const items = [makeTabItem('s-1', { status: 'error' })];
    const { container } = render(
      <Bar {...defaultProps} tabItems={items} visibleTabIds={['s-1']} />
    );
    const tab = firstRow(container);
    expect(tab?.classList.contains('error')).toBe(true);
    expect(tab?.classList.contains('connecting')).toBe(false);
  });

  // --- Drag hides the Web Browser pane's native webview ---

  it('dragging a tab sets sessionDragging, and drag end clears it', () => {
    useUiOverlayStore.setState({ sessionDragging: false });
    const items = [makeTabItem('a'), makeTabItem('b')];
    const { container } = render(
      <Bar {...defaultProps} tabItems={items} visibleTabIds={['a', 'b']} />
    );
    const tab = firstRow(container) as HTMLElement;

    fireEvent.dragStart(tab, { dataTransfer: makeDataTransfer() });
    expect(useUiOverlayStore.getState().sessionDragging).toBe(true);

    fireEvent.dragEnd(tab, { dataTransfer: makeDataTransfer() });
    expect(useUiOverlayStore.getState().sessionDragging).toBe(false);
  });

  // --- Tab context menu ---

  it('right-click on SSH session tab shows Watch + Save to Host Tree (no Bookmark)', () => {
    const items = [makeTabItem('s-1', { protocol: 'ssh' })];
    render(
      <Bar
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
      <Bar
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
      <Bar {...defaultProps} tabItems={off} visibleTabIds={['s-1']} onToggleWatch={() => {}} />,
    );
    fireEvent.contextMenu(screen.getByText('Session s-1'));
    expect(screen.getByText('AI Watch')).toBeTruthy();
    expect(screen.queryByText('Stop AI Watch')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });

    const on = [makeTabItem('s-1', { protocol: 'ssh', isWatching: true })];
    rerender(
      <Bar {...defaultProps} tabItems={on} visibleTabIds={['s-1']} onToggleWatch={() => {}} />,
    );
    fireEvent.contextMenu(screen.getByText('Session s-1'));
    expect(screen.getByText('Stop AI Watch')).toBeTruthy();
    expect(screen.queryByText('AI Watch')).toBeNull();
  });

  it('clicking the Watch item calls onToggleWatch and closes the menu', () => {
    const onToggleWatch = vi.fn();
    const items = [makeTabItem('s-1', { protocol: 'ssh' })];
    render(
      <Bar {...defaultProps} tabItems={items} visibleTabIds={['s-1']} onToggleWatch={onToggleWatch} />,
    );
    fireEvent.contextMenu(screen.getByText('Session s-1'));
    fireEvent.click(screen.getByText('AI Watch'));
    expect(onToggleWatch).toHaveBeenCalledWith('s-1');
    expect(screen.queryByText('AI Watch')).toBeNull();
  });

  it('non-SSH/Telnet session tab shows Watch but NOT Save to Host Tree', () => {
    const items = [makeTabItem('s-1', { protocol: 'serial' })];
    render(
      <Bar
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
      <Bar {...defaultProps} tabItems={items} visibleTabIds={['s-1']} onSaveToHostTree={() => {}} />,
    );
    fireEvent.contextMenu(screen.getByText('Session s-1'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('clicking the Save item calls onSaveToHostTree and closes the menu', () => {
    const onSaveToHostTree = vi.fn();
    const items = [makeTabItem('s-1', { protocol: 'ssh' })];
    render(
      <Bar
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
      <Bar {...defaultProps} tabItems={items} visibleTabIds={['wb-1']} onBookmark={onBookmark} />,
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
    render(<Bar {...defaultProps} tabItems={items} visibleTabIds={['wb-1']} />);
    fireEvent.contextMenu(screen.getByText('Web'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('right-click on a tab with no menu still suppresses the default menu', () => {
    const items: TabItem[] = [
      makeTabItem('lv-1', { kind: 'feature', displayName: 'Log Viewer', featureType: 'log-viewer' }),
    ];
    render(
      <Bar {...defaultProps} tabItems={items} visibleTabIds={['lv-1']} onSaveToHostTree={() => {}} />,
    );
    // fireEvent returns false when a handler called preventDefault (default suppressed).
    const notPrevented = fireEvent.contextMenu(screen.getByText('Log Viewer'));
    expect(notPrevented).toBe(false);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Escape key closes the context menu', () => {
    const items = [makeTabItem('s-1', { protocol: 'ssh' })];
    render(
      <Bar
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

  it('sets isWatching from the watched-sessions map', () => {
    const sessions = [makeSession('s-1'), makeSession('s-2')];
    const items = buildTabItems(sessions, [], ['s-1', 's-2'], new Map([['s-2', { tabId: 't1', colorIndex: 0 }]]));
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

  it('sets isWatching to false for all when the watched map is empty', () => {
    const sessions = [makeSession('s-1')];
    const items = buildTabItems(sessions, [], ['s-1'], new Map());
    expect(items[0].isWatching).toBe(false);
  });
});

describe('TabBar — "Watch in ▸" picker', () => {
  const conversations = [
    { id: 'c1', title: 'Chat 1', colorIndex: 0 },
    { id: 'c2', title: 'Chat 2', colorIndex: 1 },
  ];

  it('one-click toggles watch when there are 0–1 conversations (no picker)', () => {
    const onToggleWatch = vi.fn();
    const onWatchInConversation = vi.fn();
    render(
      <Bar
        {...defaultProps}
        tabItems={[makeTabItem('s-1')]}
        visibleTabIds={['s-1']}
        onToggleWatch={onToggleWatch}
        onWatchInConversation={onWatchInConversation}
        conversations={[conversations[0]]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /start ai watch/i }));
    expect(onToggleWatch).toHaveBeenCalledWith('s-1');
    expect(onWatchInConversation).not.toHaveBeenCalled();
    expect(screen.queryByText('Watch in')).toBeNull();
  });

  it('opens the picker (not one-click) when 2+ conversations exist', () => {
    const onToggleWatch = vi.fn();
    const onWatchInConversation = vi.fn();
    render(
      <Bar
        {...defaultProps}
        tabItems={[makeTabItem('s-1')]}
        visibleTabIds={['s-1']}
        onToggleWatch={onToggleWatch}
        onWatchInConversation={onWatchInConversation}
        conversations={conversations}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /start ai watch/i }));
    expect(onToggleWatch).not.toHaveBeenCalled();
    expect(screen.getByText('Watch in')).toBeTruthy();
    expect(screen.getByText('Chat 1')).toBeTruthy();
    expect(screen.getByText('Chat 2')).toBeTruthy();
    expect(screen.getByText('New conversation')).toBeTruthy();
  });

  it('routes a conversation pick and "New conversation" to onWatchInConversation', () => {
    const onWatchInConversation = vi.fn();
    render(
      <Bar
        {...defaultProps}
        tabItems={[makeTabItem('s-1', { isWatching: true, watchColorIndex: 0, watchOwnerTabId: 'c1' })]}
        visibleTabIds={['s-1']}
        onToggleWatch={() => {}}
        onWatchInConversation={onWatchInConversation}
        conversations={conversations}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /ai watch/i }));
    fireEvent.click(screen.getByText('Chat 2'));
    expect(onWatchInConversation).toHaveBeenCalledWith('s-1', 'c2');

    // Re-open and pick New conversation.
    fireEvent.click(screen.getByRole('button', { name: /ai watch/i }));
    fireEvent.click(screen.getByText('New conversation'));
    expect(onWatchInConversation).toHaveBeenCalledWith('s-1', 'new');
  });
});

describe('TabBar — groups, unread output and moving tabs', () => {
  const items = [makeTabItem('a'), makeTabItem('b', { detail: 'SSH · 192.0.2.2' }), makeTabItem('c')];

  it('puts shown tabs under "On screen" with their pane mark, the rest under "Hidden"', () => {
    const { container } = render(<Bar {...defaultProps} tabItems={items} visibleTabIds={['c', 'a']} />);
    const shown = container.querySelector('.tab-group-shown')!;
    const hidden = container.querySelector('.tab-group-hidden')!;
    expect(Array.from(shown.querySelectorAll('[data-session-id]')).map((e) => e.getAttribute('data-session-id'))).toEqual(['c', 'a']);
    expect(Array.from(hidden.querySelectorAll('[data-session-id]')).map((e) => e.getAttribute('data-session-id'))).toEqual(['b']);
    expect(shown.querySelector('[data-pane-badge="0"]')?.textContent).toBe('1');
    expect(shown.querySelector('[data-pane-badge="1"]')?.textContent).toBe('2');
    expect(screen.getByText('SSH · 192.0.2.2')).toBeTruthy();
  });

  it('a hidden tab with new output shows the count and the newest line', () => {
    useTabActivityStore.setState({ activity: { b: { lines: 3, lastLine: '%LINK-3-UPDOWN: Gi0 up' } } });
    const { container } = render(<Bar {...defaultProps} tabItems={items} visibleTabIds={['a']} />);
    expect(screen.getByText('+3')).toBeTruthy();
    expect(screen.getByText('%LINK-3-UPDOWN: Gi0 up').className).toContain('unread');
    expect(container.querySelector('[data-session-id="b"] .tab-state-dot')?.className).toContain('unread');
  });

  it('a shown tab never shows unread output', () => {
    useTabActivityStore.setState({ activity: { a: { lines: 3, lastLine: 'x' } } });
    render(<Bar {...defaultProps} tabItems={items} visibleTabIds={['a']} />);
    expect(screen.queryByText('+3')).toBeNull();
  });

  function drag(from: Element, to: Element, toClient = { clientY: 0, clientX: 0 }) {
    const dt = makeDataTransfer();
    fireEvent.dragStart(from, { dataTransfer: dt });
    fireEvent.dragOver(to, { dataTransfer: dt, ...toClient });
    fireEvent.drop(to, { dataTransfer: dt });
    fireEvent.dragEnd(from, { dataTransfer: dt });
  }

  it('dropping a hidden tab on a shown one puts it in that pane', () => {
    const onPlace = vi.fn();
    const { container } = render(<Bar {...defaultProps} tabItems={items} visibleTabIds={['a']} onPlace={onPlace} />);
    drag(container.querySelector('[data-session-id="b"]')!, container.querySelector('[data-session-id="a"]')!);
    expect(onPlace).toHaveBeenCalledWith('b', '0');
  });

  it('dropping a shown tab on the hidden group takes it off screen', () => {
    const onHide = vi.fn();
    const { container } = render(<Bar {...defaultProps} tabItems={items} visibleTabIds={['a']} onHide={onHide} />);
    drag(container.querySelector('[data-session-id="a"]')!, container.querySelector('.tab-group-hidden')!);
    expect(onHide).toHaveBeenCalledWith('a');
  });

  it('dropping a hidden tab on another hidden one reorders them', () => {
    const onMoveHidden = vi.fn();
    const { container } = render(<Bar {...defaultProps} tabItems={items} visibleTabIds={[]} onMoveHidden={onMoveHidden} />);
    // jsdom rects are all zero, so any pointer position counts as the lower half.
    drag(container.querySelector('[data-session-id="a"]')!, container.querySelector('[data-session-id="c"]')!, { clientY: 10, clientX: 10 });
    expect(onMoveHidden).toHaveBeenCalledWith('a', 'c', 'after');
  });

  it('the filter narrows both groups', () => {
    const { container } = render(<Bar {...defaultProps} tabItems={items} visibleTabIds={['a']} />);
    fireEvent.change(screen.getByLabelText('Filter tabs'), { target: { value: '192.0.2.2' } });
    expect(Array.from(rows(container)).map((e) => e.getAttribute('data-session-id'))).toEqual(['b']);
  });

  it('horizontally, hidden tabs that do not fit go into the More menu', () => {
    // jsdom measures every element as 0 px wide, so nothing hidden fits inline.
    const { container } = render(
      <Bar {...defaultProps} tabItems={items} visibleTabIds={['a']} orientation="horizontal" />
    );
    expect(container.querySelectorAll('.tab-group-hidden [data-session-id]')).toHaveLength(0);
    fireEvent.click(screen.getByText('Hidden 2'));
    const menu = screen.getAllByRole('menu').find((m) => m.classList.contains('tab-overflow-menu'))!;
    expect(within(menu).getByText('Session b')).toBeTruthy();
    fireEvent.click(within(menu).getByText('Session c'));
    expect(screen.queryByText('Hidden 2')).toBeTruthy();
  });
});

describe('hiddenTabsThatFit', () => {
  it('fits what the row can hold and leaves room for the More button when some are left over', () => {
    // 1000 - 2*160 - 96 = 584 → 3 fit at 150 each; all 3 fit, so no More button.
    expect(hiddenTabsThatFit(1000, 2, 3, false)).toBe(3);
    // 5 hidden: only 3 fit, so the More button takes 76 → 508 → 3 still fit.
    expect(hiddenTabsThatFit(1000, 2, 5, false)).toBe(3);
    // Narrow row: nothing fits.
    expect(hiddenTabsThatFit(300, 2, 4, false)).toBe(0);
    // Compact tabs are narrower, so more of them fit.
    expect(hiddenTabsThatFit(1000, 2, 9, true)).toBe(4);
  });
});

describe('TabBar keyboard', () => {
  it('moves between the tabs on screen only, never pulling a hidden tab in', () => {
    const onSelect = vi.fn();
    const items = [makeTabItem('a'), makeTabItem('b'), makeTabItem('c')];
    const { container } = render(
      <Bar tabItems={items} activeTabId="b" visibleTabIds={['a', 'b']} onSelect={onSelect} />
    );
    const list = container.querySelector('.tab-list')!;
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    // Wraps to the first shown tab instead of selecting hidden 'c'.
    expect(onSelect).toHaveBeenLastCalledWith('a');
    fireEvent.keyDown(list, { key: 'End' });
    expect(onSelect).not.toHaveBeenCalledWith('c');
  });

  it('leaves Home/End and the arrows to the filter box', () => {
    const onSelect = vi.fn();
    const items = [makeTabItem('a'), makeTabItem('b')];
    const { container } = render(
      <Bar tabItems={items} activeTabId="b" visibleTabIds={['a', 'b']} onSelect={onSelect} />
    );
    const filter = container.querySelector('.tab-filter')!;
    for (const key of ['Home', 'End', 'ArrowUp', 'ArrowDown']) {
      const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      filter.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
    }
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('TabBar keeping the active tab in view', () => {
  it('never scrolls the horizontal row, which has no way to scroll back', () => {
    const items = [makeTabItem('a'), makeTabItem('b')];
    const { container, rerender } = render(
      <Bar tabItems={items} activeTabId="a" visibleTabIds={['a', 'b']} orientation="horizontal" />
    );
    const list = container.querySelector<HTMLElement>('.tab-list')!;
    rerender(<Bar tabItems={items} activeTabId="b" visibleTabIds={['a', 'b']} orientation="horizontal" />);
    expect(list.scrollLeft).toBe(0);
    expect(list.scrollTop).toBe(0);
  });

  it('scrolls the vertical list just enough to show the active row', () => {
    const items = [makeTabItem('a'), makeTabItem('b')];
    const { container, rerender } = render(
      <Bar tabItems={items} activeTabId="a" visibleTabIds={['a', 'b']} />
    );
    const list = container.querySelector<HTMLElement>('.tab-list')!;
    const rowB = container.querySelector<HTMLElement>('[data-session-id="b"]')!;
    list.getBoundingClientRect = () => ({ top: 0, bottom: 100 }) as DOMRect;
    rowB.getBoundingClientRect = () => ({ top: 110, bottom: 140 }) as DOMRect;
    rerender(<Bar tabItems={items} activeTabId="b" visibleTabIds={['a', 'b']} />);
    expect(list.scrollTop).toBe(40);
  });
});
