import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// --- Mocks ---

const mockOpenSession = vi.fn().mockReturnValue('sess-1');
const mockCloseSession = vi.fn().mockResolvedValue(undefined);
vi.mock('./hooks/useSessionManager', () => ({
  useSessionManager: () => ({
    sessions: new Map(),
    openSession: mockOpenSession,
    closeSession: mockCloseSession,
  }),
}));

vi.mock('./services/tauriService', () => ({
  tauriService: {
    readClipboard: vi.fn().mockResolvedValue(''),
    sendInput: vi.fn().mockResolvedValue(undefined),
    pingMonitorStop: vi.fn().mockResolvedValue(undefined),
    textEditorApproveDroppedFile: vi.fn().mockResolvedValue(undefined),
    getAppVersion: vi.fn().mockResolvedValue('2.0.0-beta1'),
    setWindowTitle: vi.fn().mockResolvedValue(undefined),
    onSessionData: vi.fn().mockResolvedValue(() => {}),
    onSessionStatus: vi.fn().mockResolvedValue(() => {}),
    onWindowCloseRequested: vi.fn().mockResolvedValue(() => {}),
    destroyWindow: vi.fn().mockResolvedValue(undefined),
    confirmDialog: vi.fn().mockResolvedValue(false),
    showContextMenu: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('./utils/applyTheme', () => ({
  applyTheme: vi.fn(),
}));

vi.mock('./themes/defaults', () => {
  const t = {
    terminal: {
      foreground: '#fff',
      background: '#000',
      backgroundInactive: '#111',
      paneBackground: '#222',
    },
  };
  return {
    getTheme: () => t,
    DEFAULT_THEMES: { dark: t, light: t, medium: t },
    DEFAULT_THEME_IDS: ['dark', 'light', 'medium'],
  };
});

// Stub child components to isolate App logic
vi.mock('./components/GridLayout/GridLayout', () => ({
  GridLayout: ({ renderPane }: { renderPane: (id: string) => React.ReactNode }) => (
    <div data-testid="grid-layout">{renderPane('0')}</div>
  ),
}));

vi.mock('./components/Sidebar/Sidebar', () => ({
  Sidebar: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sidebar">{children}</div>
  ),
}));

vi.mock('./components/Sidebar/sidebarHelpers', () => ({
  sidebarPaneId: (edge: string) => `bar-${edge}`,
}));

vi.mock('./components/AppSidebar/AppSidebar', () => ({
  AppSidebar: ({ onOpenSettings, onOpenHelp }: { onOpenSettings: () => void; onOpenHelp: () => void }) => (
    <div>
      <button data-testid="open-settings" onClick={onOpenSettings}>Settings</button>
      <button data-testid="open-help" onClick={onOpenHelp}>Help</button>
    </div>
  ),
}));

vi.mock('./components/TabBar/TabBar', () => ({
  TabBar: ({ onNew, onSelect, onClose }: {
    onNew: () => void;
    onSelect: (id: string) => void;
    onClose: (id: string) => void;
  }) => (
    <div data-testid="tab-bar">
      <button data-testid="new-btn" onClick={onNew}>New</button>
      <button data-testid="select-btn" onClick={() => onSelect('sess-1')}>Select</button>
      <button data-testid="close-btn" onClick={() => onClose('sess-1')}>Close</button>
    </div>
  ),
}));

vi.mock('./components/TabBar/tabBarHelpers', () => ({
  buildTabItems: () => [],
}));

vi.mock('./components/Terminal/Terminal', () => ({
  TerminalView: () => <div data-testid="terminal" />,
}));

vi.mock('./components/LogViewerPane/LogViewerPane', () => ({
  LogViewerPane: () => <div data-testid="log-viewer" />,
}));

vi.mock('./components/TextEditorPane/TextEditorPane', () => ({
  TextEditorPane: () => <div data-testid="text-editor" />,
}));

vi.mock('./components/FileExplorerPane/FileExplorerPane', () => ({
  FileExplorerPane: () => <div data-testid="file-explorer" />,
}));

vi.mock('./components/PingMonitorPane/PingMonitorPane', () => ({
  PingMonitorPane: () => <div data-testid="ping-monitor" />,
}));

vi.mock('./components/SessionDialog/SessionDialog', () => ({
  SessionDialog: ({ open, onClose, onConnect }: {
    open: boolean;
    onClose: () => void;
    onConnect: (payload: unknown) => void;
  }) =>
    open ? (
      <div data-testid="connect-form">
        <button data-testid="cancel-connect" onClick={onClose}>Cancel</button>
        <button
          data-testid="submit-connect"
          onClick={() => onConnect({ protocol: 'ssh', config: {} })}
        >
          Connect
        </button>
      </div>
    ) : null,
}));

vi.mock('./components/SettingsModal/SettingsModal', () => ({
  SettingsModal: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <div data-testid="settings-modal">
        <button data-testid="close-settings" onClick={onClose}>Close</button>
      </div>
    ) : null,
}));

vi.mock('./components/HelpModal/HelpModal', () => ({
  HelpModal: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <div data-testid="help-modal">
        <button data-testid="close-help" onClick={onClose}>Close</button>
      </div>
    ) : null,
}));

vi.mock('./components/SshHostKeyModal/SshHostKeyModal', () => ({
  SshHostKeyModal: () => null,
}));

vi.mock('./components/PasteConfirmationModal/PasteConfirmationModal', () => ({
  PasteConfirmationModal: () => null,
}));

vi.mock('./components/UpdateNotification/UpdateNotification', () => ({
  UpdateNotification: () => null,
}));

import App from './App';
import { useSettingsStore } from './stores/settingsStore';

describe('App', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
    mockOpenSession.mockReset().mockReturnValue('sess-1');
    mockCloseSession.mockReset().mockResolvedValue(undefined);
  });

  it('renders without crashing', () => {
    const { container } = render(<App />);
    expect(container.querySelector('.app-root')).toBeTruthy();
  });

  it('renders core layout elements', () => {
    render(<App />);
    expect(screen.getByTestId('tab-bar')).toBeTruthy();
    expect(screen.getByTestId('grid-layout')).toBeTruthy();
    expect(screen.getByTestId('open-settings')).toBeTruthy();
  });

  it('opens ConnectForm when new-tab button is clicked', () => {
    render(<App />);
    expect(screen.queryByTestId('connect-form')).toBeNull();
    fireEvent.click(screen.getByTestId('new-btn'));
    expect(screen.getByTestId('connect-form')).toBeTruthy();
  });

  it('closes ConnectForm on cancel', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('new-btn'));
    expect(screen.getByTestId('connect-form')).toBeTruthy();
    fireEvent.click(screen.getByTestId('cancel-connect'));
    expect(screen.queryByTestId('connect-form')).toBeNull();
  });

  it('opens and closes SettingsModal', () => {
    render(<App />);
    expect(screen.queryByTestId('settings-modal')).toBeNull();
    fireEvent.click(screen.getByTestId('open-settings'));
    expect(screen.getByTestId('settings-modal')).toBeTruthy();
    fireEvent.click(screen.getByTestId('close-settings'));
    expect(screen.queryByTestId('settings-modal')).toBeNull();
  });

  it('opens and closes HelpModal', () => {
    render(<App />);
    expect(screen.queryByTestId('help-modal')).toBeNull();
    fireEvent.click(screen.getByTestId('open-help'));
    expect(screen.getByTestId('help-modal')).toBeTruthy();
    fireEvent.click(screen.getByTestId('close-help'));
    expect(screen.queryByTestId('help-modal')).toBeNull();
  });

  it('submitting ConnectForm calls openSession', async () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('new-btn'));
    fireEvent.click(screen.getByTestId('submit-connect'));
    await waitFor(() => {
      expect(mockOpenSession).toHaveBeenCalledTimes(1);
    });
  });
});
