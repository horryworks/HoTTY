import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';

// --- Mocks ---

const mockOpenSession = vi.fn().mockReturnValue('sess-1');
const mockCloseSession = vi.fn().mockResolvedValue(undefined);

// Sessions map exposed to tests so individual tests can plant a session whose
// term.focus is observable.
type FocusableTerm = { focus: ReturnType<typeof vi.fn> };
const mockSessions = new Map<string, { id: string; term: FocusableTerm }>();

// Capture the onPasteRequest callback App passes into useSessionManager so
// tests can drive the paste flow without going through xterm.
let capturedOnPasteRequest: ((sessionId: string) => void | Promise<void>) | null = null;

vi.mock('./hooks/useSessionManager', () => ({
  useSessionManager: (opts: { onPasteRequest?: (sessionId: string) => void } = {}) => {
    capturedOnPasteRequest = opts.onPasteRequest ?? null;
    return {
      sessions: mockSessions,
      openSession: mockOpenSession,
      closeSession: mockCloseSession,
    };
  },
}));

vi.mock('./services/tauriService', () => ({
  tauriService: {
    // useAiAuthOwner (mounted once in App)
    aiSetProvider: vi.fn().mockResolvedValue(undefined),
    aiAuthAuto: vi.fn().mockResolvedValue(false),
    dpapiDecrypt: vi.fn().mockResolvedValue(''),
    onAiAuthResult: vi.fn().mockResolvedValue(() => {}),
    onAiAuthLogout: vi.fn().mockResolvedValue(() => {}),
    readClipboard: vi.fn().mockResolvedValue(''),
    sendInput: vi.fn().mockResolvedValue(undefined),
    pingMonitorStop: vi.fn().mockResolvedValue(undefined),
    getAppVersion: vi.fn().mockResolvedValue('2.0.0-beta1'),
    setWindowTitle: vi.fn().mockResolvedValue(undefined),
    onSessionData: vi.fn().mockResolvedValue(() => {}),
    onSessionStatus: vi.fn().mockResolvedValue(() => {}),
    confirmDialog: vi.fn().mockResolvedValue(false),
    showContextMenu: vi.fn().mockResolvedValue(null),
    logDebug: vi.fn().mockResolvedValue(undefined),
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

vi.mock('./components/PingMonitorPane/PingMonitorPane', () => ({
  PingMonitorPane: () => <div data-testid="ping-monitor" />,
}));

vi.mock('./components/SessionDialog/SessionDialog', () => ({
  SessionDialog: ({ open, onClose, onConnect, onCancelConnect }: {
    open: boolean;
    onClose: () => void;
    onConnect: (payload: unknown) => void;
    onCancelConnect?: (sessionId: string) => void;
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
        {/* Stands in for the dialog's in-progress Cancel (Esc / Cancel button). */}
        <button
          data-testid="abort-connect"
          onClick={() => onCancelConnect?.('sess-1')}
        >
          Abort
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

vi.mock('./components/IapVmStartModal/IapVmStartModal', () => ({
  IapVmStartModal: () => null,
}));

// Capture the modal props so tests can invoke onConfirm/onCancel without
// rendering the real modal (which would auto-focus its Paste button).
let pasteModalProps: {
  content: string;
  onConfirm: () => void;
  onCancel: () => void;
} | null = null;
vi.mock('./components/PasteConfirmationModal/PasteConfirmationModal', () => ({
  PasteConfirmationModal: (props: {
    content: string;
    onConfirm: () => void;
    onCancel: () => void;
  }) => {
    pasteModalProps = props;
    return <div data-testid="paste-modal" />;
  },
}));

vi.mock('./components/UpdateNotification/UpdateNotification', () => ({
  UpdateNotification: () => null,
}));

import App from './App';
import { useSettingsStore } from './stores/settingsStore';
import { usePaneStore } from './stores/paneStore';
import { tauriService } from './services/tauriService';

describe('App', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
    usePaneStore.setState({
      layoutMode: '1x1',
      activePaneId: '0',
      paneAllocations: {},
      sessionOrder: [],
    });
    mockOpenSession.mockReset().mockReturnValue('sess-1');
    mockCloseSession.mockReset().mockResolvedValue(undefined);
    mockSessions.clear();
    capturedOnPasteRequest = null;
    pasteModalProps = null;
    (tauriService.readClipboard as Mock).mockReset().mockResolvedValue('');
    (tauriService.sendInput as Mock).mockReset().mockResolvedValue(undefined);
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

  it('allocates the pane at submit time, not on connect', () => {
    // Regression guard for the Huawei width latch: the pane must be allocated
    // while the session is still 'connecting' so TerminalXtermHost mounts and
    // xterm reports its measured size before the backend allocates the pty.
    // Deferring this to 'connected' made resolve_initial_pty_size time out and
    // fall back to 80x24, pinning width-latching devices to 80 columns.
    render(<App />);
    fireEvent.click(screen.getByTestId('new-btn'));
    fireEvent.click(screen.getByTestId('submit-connect'));
    expect(Object.values(usePaneStore.getState().paneAllocations)).toContain('sess-1');
    // The dialog stays open on top until the session reaches 'connected'.
    expect(screen.getByTestId('connect-form')).toBeTruthy();
  });

  it('releases the pane when an in-progress connection is cancelled', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('new-btn'));
    fireEvent.click(screen.getByTestId('submit-connect'));
    expect(Object.values(usePaneStore.getState().paneAllocations)).toContain('sess-1');

    fireEvent.click(screen.getByTestId('abort-connect'));
    expect(mockCloseSession).toHaveBeenCalledWith('sess-1');
    expect(Object.values(usePaneStore.getState().paneAllocations)).not.toContain('sess-1');
    expect(usePaneStore.getState().sessionOrder).not.toContain('sess-1');
  });

  // Helper: drive the paste-confirmation modal flow up to the point where the
  // modal is rendered and pasteModalProps is captured.
  async function openPasteModalFor(sessionId: string, clipboardText: string) {
    (tauriService.readClipboard as Mock).mockResolvedValueOnce(clipboardText);
    render(<App />);
    expect(capturedOnPasteRequest).not.toBeNull();
    await act(async () => {
      await capturedOnPasteRequest!(sessionId);
    });
    await waitFor(() => expect(pasteModalProps).not.toBeNull());
  }

  it('restores focus to the originating terminal after paste modal confirm', async () => {
    const focus = vi.fn();
    mockSessions.set('s-1', { id: 's-1', term: { focus } });
    await openPasteModalFor('s-1', 'hello');
    expect(pasteModalProps!.content).toBe('hello');

    act(() => {
      pasteModalProps!.onConfirm();
    });

    expect(tauriService.sendInput).toHaveBeenCalledWith('s-1', 'hello');
    // Focus is scheduled in a microtask so the modal can fully unmount first.
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('normalizes CRLF and LF to CR when pasting (no double-newline echo)', async () => {
    const focus = vi.fn();
    mockSessions.set('s-1', { id: 's-1', term: { focus } });
    // Mixed input: Windows CRLF, bare LF, and a bare CR that must be preserved.
    await openPasteModalFor('s-1', 'a\r\nb\nc\rd');

    act(() => {
      pasteModalProps!.onConfirm();
    });

    expect(tauriService.sendInput).toHaveBeenCalledWith('s-1', 'a\rb\rc\rd');
  });

  it('restores focus to the originating terminal after paste modal cancel', async () => {
    const focus = vi.fn();
    mockSessions.set('s-1', { id: 's-1', term: { focus } });
    await openPasteModalFor('s-1', 'hello');

    act(() => {
      pasteModalProps!.onCancel();
    });

    // Cancel must NOT send the clipboard content.
    expect(tauriService.sendInput).not.toHaveBeenCalled();
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    expect(focus).toHaveBeenCalledTimes(1);
  });
});
