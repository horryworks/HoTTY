import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SessionDialog } from './SessionDialog';
import type { SessionRecord } from '../../hooks/useSessionManager';
import type { SessionRecordStatus } from '../../types/appTypes';
import { STORAGE_KEYS } from '../../constants/storage';
import { useSidebarLayoutStore } from '../../stores/sidebarLayoutStore';
import { useBookmarkStore } from '../../stores/bookmarkStore';

const makeSessions = (entries: Array<[string, SessionRecordStatus]>): Map<string, SessionRecord> => {
  const m = new Map<string, SessionRecord>();
  for (const [id, status] of entries) {
    m.set(id, { id, status } as unknown as SessionRecord);
  }
  return m;
};

/** Captured `iap-connect-progress` callback so tests can push connect-phase events. */
let emitIapProgress: ((p: { sessionId: string; phase: string }) => void) | null = null;

// Mock tauriService
vi.mock('../../services/tauriService', () => ({
  tauriService: {
    focusWindow: vi.fn(),
    exportHtree: vi.fn(),
    selectImportFile: vi.fn(),
    decryptImportFile: vi.fn(),
    gceIapCheckGcloud: vi.fn(),
    gceIapCheckAuth: vi.fn(),
    gceIapListProjects: vi.fn(),
    gceIapListZones: vi.fn(),
    gceIapListInstances: vi.fn(),
    onIapConnectProgress: (cb: (p: { sessionId: string; phase: string }) => void) => {
      emitIapProgress = cb;
      return Promise.resolve(() => {
        emitIapProgress = null;
      });
    },
    openExternal: vi.fn(),
    logDebug: vi.fn(),
    listSerialPorts: vi.fn().mockResolvedValue([]),
    listWslDistributions: vi.fn().mockResolvedValue([]),
    detectGitBash: vi.fn().mockResolvedValue(null),
    dpapiEncryptBatch: vi.fn(async (values: string[]) => values.map(v => `[SAFE]${v}`)),
    dpapiDecryptBatch: vi.fn(async (values: string[]) => values.map(v => v.replace(/^\[SAFE\]/, ''))),
    migrateHostTreeCredentials: vi.fn(async (treeJson: string) => treeJson),
  },
  isEncrypted: (value: string) => value.startsWith('[DPAPI]') || value.startsWith('[SAFE]'),
}));

// Mock dialog plugin
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  onConnect: vi.fn(),
};

describe('SessionDialog', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    emitIapProgress = null;
    // Tests assume the dialog opens on the Hosts tab; reset the persisted store
    // (which other tests / cases may have switched) and the bookmark tree.
    useSidebarLayoutStore.setState({ activeSidebarTab: 'hosts' });
    useBookmarkStore.setState({ tree: [] });
  });

  it('renders nothing when not open', () => {
    const { container } = render(<SessionDialog {...defaultProps} open={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders when open', () => {
    render(<SessionDialog {...defaultProps} />);
    expect(screen.getByText('New Session')).toBeTruthy();
  });

  it('shows two-panel layout with tree and form', () => {
    const { container } = render(<SessionDialog {...defaultProps} />);
    expect(container.querySelector('.host-panel')).toBeTruthy();
    expect(container.querySelector('.form-panel')).toBeTruthy();
    expect(container.querySelector('.panel-divider')).toBeTruthy();
  });

  it('shows protocol selector', () => {
    render(<SessionDialog {...defaultProps} />);
    expect(screen.getByText('Protocol')).toBeTruthy();
    expect(screen.getByText('SSH')).toBeTruthy();
  });

  it('shows Connect button', () => {
    render(<SessionDialog {...defaultProps} />);
    expect(screen.getByText('Connect')).toBeTruthy();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<SessionDialog {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByText('\u2715'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows host tree empty message when tree is empty', () => {
    render(<SessionDialog {...defaultProps} />);
    expect(screen.getByText(/Right-click or use the \+ buttons/)).toBeTruthy();
  });

  it('shows encoding selector', () => {
    render(<SessionDialog {...defaultProps} />);
    expect(screen.getByText('Encoding')).toBeTruthy();
  });

  it('shows Host/IP and Port fields for SSH protocol', () => {
    render(<SessionDialog {...defaultProps} />);
    expect(screen.getByText('Host/IP')).toBeTruthy();
    expect(screen.getByText('Port')).toBeTruthy();
    expect(screen.getByText('Username')).toBeTruthy();
    expect(screen.getByText('Password')).toBeTruthy();
  });

  it('shows Private Key Path for SSH protocol', () => {
    render(<SessionDialog {...defaultProps} />);
    expect(screen.getByText('Private Key Path (optional)')).toBeTruthy();
  });

  it('shows resize handle', () => {
    const { container } = render(<SessionDialog {...defaultProps} />);
    expect(container.querySelector('.dialog-resize-handle')).toBeTruthy();
  });

  describe('New Connection status banner', () => {
    it('shows "New Connection" when nothing is selected', () => {
      const { container } = render(<SessionDialog {...defaultProps} />);
      const banner = container.querySelector('.form-status-banner .banner-new');
      expect(banner?.textContent).toContain('New Connection');
    });

    it('shows the New Connection pseudo-row in the host tree', () => {
      const { container } = render(<SessionDialog {...defaultProps} />);
      const row = container.querySelector('.host-tree-row.new-connection');
      expect(row).toBeTruthy();
      // With no host selected, the pseudo-row should be highlighted.
      expect(row?.classList.contains('selected')).toBe(true);
    });

    it('switches the banner to "Editing: ..." with a × button when a host is clicked', async () => {
      localStorage.setItem(STORAGE_KEYS.HOST_TREE, JSON.stringify([
        { id: 'host-banner-1', type: 'host', name: 'Sample Box', entry: { protocol: 'ssh', host: '10.0.0.5', port: 22 } },
      ]));
      render(<SessionDialog {...defaultProps} />);
      await act(async () => {
        fireEvent.click(screen.getByText('Sample Box'));
      });
      expect(screen.getByText(/Editing:/)).toBeTruthy();
      expect(screen.getByLabelText('Clear form and start new connection')).toBeTruthy();
    });

    it('× clears the form immediately when the form is not dirty', async () => {
      localStorage.setItem(STORAGE_KEYS.HOST_TREE, JSON.stringify([
        { id: 'host-banner-2', type: 'host', name: 'Sample Box', entry: { protocol: 'ssh', host: '10.0.0.6', port: 22 } },
      ]));
      const { container } = render(<SessionDialog {...defaultProps} />);
      await act(async () => {
        fireEvent.click(screen.getByText('Sample Box'));
      });
      // Banner is in the editing state.
      expect(screen.getByText(/Editing:/)).toBeTruthy();
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Clear form and start new connection'));
      });
      // No ConfirmModal because nothing was edited after selection.
      expect(container.querySelector('.confirm-modal-overlay')).toBeNull();
      // Banner is back to the new-connection state.
      const banner = container.querySelector('.banner-new');
      expect(banner).toBeTruthy();
    });

    it('shows the discard confirmation when × is clicked with unsaved changes', async () => {
      localStorage.setItem(STORAGE_KEYS.HOST_TREE, JSON.stringify([
        { id: 'host-banner-3', type: 'host', name: 'Sample Box', entry: { protocol: 'ssh', host: '10.0.0.7', port: 22, username: 'alice' } },
      ]));
      const { container } = render(<SessionDialog {...defaultProps} />);
      await act(async () => {
        fireEvent.click(screen.getByText('Sample Box'));
      });
      // Edit the host field to make the form dirty.
      const hostInput = container.querySelector('input[placeholder="example.com"]') as HTMLInputElement;
      expect(hostInput).toBeTruthy();
      await act(async () => {
        fireEvent.change(hostInput, { target: { value: '10.0.0.99' } });
      });
      // Click × — should show discard confirmation.
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Clear form and start new connection'));
      });
      expect(container.querySelector('.confirm-modal-overlay')).toBeTruthy();
      expect(screen.getByText('Discard')).toBeTruthy();
    });

    it('Cancel on the discard modal preserves the current form state', async () => {
      localStorage.setItem(STORAGE_KEYS.HOST_TREE, JSON.stringify([
        { id: 'host-banner-4', type: 'host', name: 'Sample Box', entry: { protocol: 'ssh', host: '10.0.0.8', port: 22, username: 'alice' } },
      ]));
      const { container } = render(<SessionDialog {...defaultProps} />);
      await act(async () => {
        fireEvent.click(screen.getByText('Sample Box'));
      });
      const hostInput = container.querySelector('input[placeholder="example.com"]') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(hostInput, { target: { value: '10.0.0.99' } });
      });
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Clear form and start new connection'));
      });
      // Cancel the discard.
      await act(async () => {
        fireEvent.click(screen.getByText('Cancel'));
      });
      // Modal closed, banner is still in editing state, host field is preserved.
      expect(container.querySelector('.confirm-modal-overlay')).toBeNull();
      expect(screen.getByText(/Editing:/)).toBeTruthy();
      expect((container.querySelector('input[placeholder="example.com"]') as HTMLInputElement).value).toBe('10.0.0.99');
    });

    it('Discard confirms and clears the form', async () => {
      localStorage.setItem(STORAGE_KEYS.HOST_TREE, JSON.stringify([
        { id: 'host-banner-5', type: 'host', name: 'Sample Box', entry: { protocol: 'ssh', host: '10.0.0.9', port: 22, username: 'alice' } },
      ]));
      const { container } = render(<SessionDialog {...defaultProps} />);
      await act(async () => {
        fireEvent.click(screen.getByText('Sample Box'));
      });
      const hostInput = container.querySelector('input[placeholder="example.com"]') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(hostInput, { target: { value: '10.0.0.99' } });
      });
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Clear form and start new connection'));
      });
      await act(async () => {
        fireEvent.click(screen.getByText('Discard'));
      });
      // Modal closed, banner reset, host field cleared.
      expect(container.querySelector('.confirm-modal-overlay')).toBeNull();
      expect(container.querySelector('.banner-new')).toBeTruthy();
      expect((container.querySelector('input[placeholder="example.com"]') as HTMLInputElement).value).toBe('');
    });

    it('does NOT prompt when switching from a typed New Connection to a saved host — the input is stashed as a draft', async () => {
      localStorage.setItem(STORAGE_KEYS.HOST_TREE, JSON.stringify([
        { id: 'host-banner-6', type: 'host', name: 'Sample Box', entry: { protocol: 'ssh', host: '10.0.0.10', port: 22, username: 'alice' } },
      ]));
      const { container } = render(<SessionDialog {...defaultProps} />);
      // Type something in New Connection mode.
      const hostInput = container.querySelector('input[placeholder="example.com"]') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(hostInput, { target: { value: '10.0.0.50' } });
      });
      // Click a saved host — should switch immediately with no Discard prompt.
      await act(async () => {
        fireEvent.click(screen.getByText('Sample Box'));
      });
      expect(container.querySelector('.confirm-modal-overlay')).toBeNull();
      expect(screen.getByText(/Editing:/)).toBeTruthy();
    });

    it('restores the typed New Connection draft when × is clicked from a saved host', async () => {
      localStorage.setItem(STORAGE_KEYS.HOST_TREE, JSON.stringify([
        { id: 'host-banner-7', type: 'host', name: 'Sample Box', entry: { protocol: 'ssh', host: '10.0.0.11', port: 22, username: 'alice' } },
      ]));
      const { container } = render(<SessionDialog {...defaultProps} />);
      // Type in New Connection.
      const hostInput = container.querySelector('input[placeholder="example.com"]') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(hostInput, { target: { value: '10.0.0.50' } });
      });
      // Switch to saved host (stashes draft).
      await act(async () => {
        fireEvent.click(screen.getByText('Sample Box'));
      });
      // Banner is in editing state.
      expect(screen.getByText(/Editing:/)).toBeTruthy();
      // Click × to return to New Connection — draft should be restored.
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Clear form and start new connection'));
      });
      expect(container.querySelector('.banner-new')).toBeTruthy();
      const restoredHostInput = container.querySelector('input[placeholder="example.com"]') as HTMLInputElement;
      expect(restoredHostInput.value).toBe('10.0.0.50');
    });

    it('preserves the form values after Connect so that auth-failure retry works', async () => {
      // onConnect only initiates the attempt — the backend reports success
      // or failure asynchronously, so we deliberately keep the form populated
      // so the user can edit (e.g. fix a wrong password) and retry without
      // re-typing everything.
      const onConnect = vi.fn();
      const { container } = render(<SessionDialog {...defaultProps} onConnect={onConnect} />);
      const hostInput = container.querySelector('input[placeholder="example.com"]') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(hostInput, { target: { value: '10.0.0.99' } });
      });
      const usernameInput = container.querySelectorAll('input[type="text"]')[1] as HTMLInputElement;
      await act(async () => {
        fireEvent.change(usernameInput, { target: { value: 'bob' } });
      });
      await act(async () => {
        fireEvent.click(screen.getByText('Connect'));
      });
      expect(onConnect).toHaveBeenCalledTimes(1);
      // Form still holds the typed values for the next retry attempt.
      const stillHostInput = container.querySelector('input[placeholder="example.com"]') as HTMLInputElement;
      expect(stillHostInput.value).toBe('10.0.0.99');
    });

    it('clears the form and the draft when a saved-host connect transitions to "connected"', async () => {
      localStorage.setItem(STORAGE_KEYS.HOST_TREE, JSON.stringify([
        { id: 'host-success-1', type: 'host', name: 'Sample Box', entry: { protocol: 'ssh', host: '10.0.0.20', port: 22, username: 'alice' } },
      ]));
      const onConnect = vi.fn().mockReturnValue('sess-success');
      let sessions = makeSessions([['sess-success', 'connecting']]);
      const { container, rerender } = render(
        <SessionDialog {...defaultProps} onConnect={onConnect} sessions={sessions} />,
      );
      // Type in New Connection → stashes draft when we navigate to a saved host.
      const hostInput = container.querySelector('input[placeholder="example.com"]') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(hostInput, { target: { value: '10.0.0.99' } });
      });
      await act(async () => {
        fireEvent.click(screen.getByText('Sample Box'));
      });
      // Connect from the saved host edit form.
      await act(async () => {
        fireEvent.click(screen.getByText('Connect'));
      });
      expect(onConnect).toHaveBeenCalledTimes(1);
      // The session transitions to 'connected' — the form and draft should
      // both be cleared by the subscription effect.
      sessions = makeSessions([['sess-success', 'connected']]);
      await act(async () => {
        rerender(<SessionDialog {...defaultProps} onConnect={onConnect} sessions={sessions} />);
      });
      // Form is empty immediately (no need to click × first).
      const hostAfter = container.querySelector('input[placeholder="example.com"]') as HTMLInputElement;
      expect(hostAfter.value).toBe('');
      // Banner is in the new-connection state.
      expect(container.querySelector('.banner-new')).toBeTruthy();
      // The draft was also cleared — × on the New Connection banner is not
      // shown, but if the user navigates to a saved host and back, no draft
      // is restored.
      await act(async () => {
        fireEvent.click(screen.getByText('Sample Box'));
      });
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Clear form and start new connection'));
      });
      const finalHostInput = container.querySelector('input[placeholder="example.com"]') as HTMLInputElement;
      expect(finalHostInput.value).toBe('');
    });

    it('keeps the New Connection form populated when the initiated session transitions to "connected"', async () => {
      // A manually-entered New Connection (no saved host selected) must retain
      // host/username/password after a successful connect, so the next open is
      // pre-filled for a similar host.
      const onConnect = vi.fn().mockReturnValue('sess-nc');
      let sessions = makeSessions([['sess-nc', 'connecting']]);
      const { container, rerender } = render(
        <SessionDialog {...defaultProps} onConnect={onConnect} sessions={sessions} />,
      );
      const hostInput = container.querySelector('input[placeholder="example.com"]') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(hostInput, { target: { value: '10.0.0.42' } });
      });
      const usernameInput = container.querySelectorAll('input[type="text"]')[1] as HTMLInputElement;
      await act(async () => {
        fireEvent.change(usernameInput, { target: { value: 'carol' } });
      });
      const passwordInput = container.querySelector('input[type="password"]') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(passwordInput, { target: { value: 's3cret' } });
      });
      await act(async () => {
        fireEvent.click(screen.getByText('Connect'));
      });
      expect(onConnect).toHaveBeenCalledTimes(1);
      // Backend reports success — the New Connection form must NOT be cleared.
      sessions = makeSessions([['sess-nc', 'connected']]);
      await act(async () => {
        rerender(<SessionDialog {...defaultProps} onConnect={onConnect} sessions={sessions} />);
      });
      const hostAfter = container.querySelector('input[placeholder="example.com"]') as HTMLInputElement;
      const usernameAfter = container.querySelectorAll('input[type="text"]')[1] as HTMLInputElement;
      const passwordAfter = container.querySelector('input[type="password"]') as HTMLInputElement;
      expect(hostAfter.value).toBe('10.0.0.42');
      expect(usernameAfter.value).toBe('carol');
      expect(passwordAfter.value).toBe('s3cret');
    });

    it('preserves the draft when the initiated session fails (auth error)', async () => {
      localStorage.setItem(STORAGE_KEYS.HOST_TREE, JSON.stringify([
        { id: 'host-fail-1', type: 'host', name: 'Sample Box', entry: { protocol: 'ssh', host: '10.0.0.21', port: 22, username: 'alice' } },
      ]));
      const onConnect = vi.fn().mockReturnValue('sess-fail');
      let sessions = makeSessions([['sess-fail', 'connecting']]);
      const { container, rerender } = render(
        <SessionDialog {...defaultProps} onConnect={onConnect} sessions={sessions} />,
      );
      // Type in New Connection → stashes draft when we navigate to a saved host.
      const hostInput = container.querySelector('input[placeholder="example.com"]') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(hostInput, { target: { value: '10.0.0.77' } });
      });
      await act(async () => {
        fireEvent.click(screen.getByText('Sample Box'));
      });
      await act(async () => {
        fireEvent.click(screen.getByText('Connect'));
      });
      expect(onConnect).toHaveBeenCalledTimes(1);
      // Session goes to 'error' (e.g. auth failure) — draft must survive.
      sessions = makeSessions([['sess-fail', 'error']]);
      await act(async () => {
        rerender(<SessionDialog {...defaultProps} onConnect={onConnect} sessions={sessions} />);
      });
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Clear form and start new connection'));
      });
      const restoredHostInput = container.querySelector('input[placeholder="example.com"]') as HTMLInputElement;
      expect(restoredHostInput.value).toBe('10.0.0.77');
    });

    it('does not clear the draft while the session is still in the "connecting" state', async () => {
      localStorage.setItem(STORAGE_KEYS.HOST_TREE, JSON.stringify([
        { id: 'host-conn-1', type: 'host', name: 'Sample Box', entry: { protocol: 'ssh', host: '10.0.0.22', port: 22, username: 'alice' } },
      ]));
      const onConnect = vi.fn().mockReturnValue('sess-pending');
      let sessions = makeSessions([['sess-pending', 'connecting']]);
      const { container, rerender } = render(
        <SessionDialog {...defaultProps} onConnect={onConnect} sessions={sessions} />,
      );
      const hostInput = container.querySelector('input[placeholder="example.com"]') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(hostInput, { target: { value: '10.0.0.55' } });
      });
      await act(async () => {
        fireEvent.click(screen.getByText('Sample Box'));
      });
      await act(async () => {
        fireEvent.click(screen.getByText('Connect'));
      });
      // Sessions Map updates but the initiated session is still 'connecting'.
      sessions = makeSessions([['sess-pending', 'connecting']]);
      await act(async () => {
        rerender(<SessionDialog {...defaultProps} onConnect={onConnect} sessions={sessions} />);
      });
      // Draft must survive.
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Clear form and start new connection'));
      });
      const restoredHostInput = container.querySelector('input[placeholder="example.com"]') as HTMLInputElement;
      expect(restoredHostInput.value).toBe('10.0.0.55');
    });

    it('replaces the draft each time the user navigates away from New Connection', async () => {
      localStorage.setItem(STORAGE_KEYS.HOST_TREE, JSON.stringify([
        { id: 'host-banner-9', type: 'host', name: 'Sample Box', entry: { protocol: 'ssh', host: '10.0.0.13', port: 22, username: 'alice' } },
      ]));
      const { container } = render(<SessionDialog {...defaultProps} />);
      const hostInput = container.querySelector('input[placeholder="example.com"]') as HTMLInputElement;
      // First draft.
      await act(async () => {
        fireEvent.change(hostInput, { target: { value: 'first.example.com' } });
      });
      await act(async () => {
        fireEvent.click(screen.getByText('Sample Box'));
      });
      // Return to New Connection — first draft restored.
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Clear form and start new connection'));
      });
      // Edit the draft and re-stash it.
      const restoredHostInput = container.querySelector('input[placeholder="example.com"]') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(restoredHostInput, { target: { value: 'second.example.com' } });
      });
      await act(async () => {
        fireEvent.click(screen.getByText('Sample Box'));
      });
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Clear form and start new connection'));
      });
      // The newest typed value wins.
      const finalHostInput = container.querySelector('input[placeholder="example.com"]') as HTMLInputElement;
      expect(finalHostInput.value).toBe('second.example.com');
    });

    it('resets protocol to SSH + port 22 (not stale telnet + port 22) when returning to New Connection from a saved telnet host', async () => {
      // Regression: resetForm reset the port to '22' but left protocol
      // untouched, so leaving a telnet host produced a "Telnet but port 22"
      // mismatch (port only re-derives from the protocol <select> onChange).
      localStorage.setItem(STORAGE_KEYS.HOST_TREE, JSON.stringify([
        { id: 'host-telnet-1', type: 'host', name: 'Telnet Box', entry: { protocol: 'telnet', host: '10.0.0.30', port: 23 } },
      ]));
      const { container } = render(<SessionDialog {...defaultProps} />);
      // Select the saved telnet host → protocol telnet, port 23.
      await act(async () => {
        fireEvent.click(screen.getByText('Telnet Box'));
      });
      expect((container.querySelector('select') as HTMLSelectElement).value).toBe('telnet');
      // Return to New Connection (form not dirty → resets immediately).
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Clear form and start new connection'));
      });
      expect(container.querySelector('.banner-new')).toBeTruthy();
      // A fresh New Connection must be SSH on port 22 — not telnet on 22.
      expect((container.querySelector('select') as HTMLSelectElement).value).toBe('ssh');
      expect((container.querySelector('input[type="number"]') as HTMLInputElement).value).toBe('22');
    });
  });

  describe('In-dialog connect lifecycle (wait / success / failure / cancel)', () => {
    // Fill a New Connection SSH form enough that Connect is enabled.
    const fillNewSsh = async (container: HTMLElement, host = '10.0.0.100', user = 'root') => {
      const hostInput = container.querySelector('input[placeholder="example.com"]') as HTMLInputElement;
      await act(async () => { fireEvent.change(hostInput, { target: { value: host } }); });
      const usernameInput = container.querySelectorAll('input[type="text"]')[1] as HTMLInputElement;
      await act(async () => { fireEvent.change(usernameInput, { target: { value: user } }); });
    };

    it('enters the connecting state and disables Connect while the attempt is in progress', async () => {
      const onConnect = vi.fn().mockReturnValue('sess-c1');
      const sessions = makeSessions([['sess-c1', 'connecting']]);
      const { container } = render(<SessionDialog {...defaultProps} onConnect={onConnect} sessions={sessions} />);
      await fillNewSsh(container);
      await act(async () => { fireEvent.click(screen.getByText('Connect')); });
      expect(onConnect).toHaveBeenCalledTimes(1);
      // Connecting indicator visible; Connect button shows the connecting label and is disabled.
      expect(container.querySelector('.connect-status')).toBeTruthy();
      const submit = container.querySelector('.btn-primary') as HTMLButtonElement;
      expect(submit.textContent).toContain('Connecting');
      expect(submit.disabled).toBe(true);
      // A Cancel button is offered.
      expect(screen.getByText('Cancel')).toBeTruthy();
    });

    it('renders the connect indicator at dialog level (outside the Hosts form-panel) so it shows on every tab', async () => {
      // Regression: the GCP tab connect looked frozen because the "Connecting…"
      // spinner + Cancel lived inside .form-panel, which only renders on Hosts.
      const onConnect = vi.fn().mockReturnValue('sess-dlg');
      const sessions = makeSessions([['sess-dlg', 'connecting']]);
      const { container } = render(<SessionDialog {...defaultProps} onConnect={onConnect} sessions={sessions} />);
      await fillNewSsh(container);
      await act(async () => { fireEvent.click(screen.getByText('Connect')); });
      const banner = container.querySelector('.connect-status-dialog');
      expect(banner).toBeTruthy();
      // Must NOT be nested in the Hosts-only form panel (that was the bug).
      expect(banner!.closest('.form-panel')).toBeNull();
      expect(screen.getByText('Cancel')).toBeTruthy();
    });

    it('shows the IAP connect-phase label from iap-connect-progress next to the spinner', async () => {
      const onConnect = vi.fn().mockReturnValue('sess-phase');
      const sessions = makeSessions([['sess-phase', 'connecting']]);
      const { container } = render(<SessionDialog {...defaultProps} onConnect={onConnect} sessions={sessions} />);
      await fillNewSsh(container);
      await act(async () => { fireEvent.click(screen.getByText('Connect')); });
      // Default generic label before any phase event.
      expect(container.querySelector('.connect-status-text')?.textContent).toContain('Connecting');
      // Backend reports the key-enrollment phase for this session.
      await act(async () => { emitIapProgress?.({ sessionId: 'sess-phase', phase: 'enrolling' }); });
      expect(container.querySelector('.connect-status-text')?.textContent).toContain('Registering SSH key');
    });

    it('calls onConnected when the initiated session becomes connected', async () => {
      const onConnect = vi.fn().mockReturnValue('sess-ok');
      const onConnected = vi.fn();
      let sessions = makeSessions([['sess-ok', 'connecting']]);
      const { container, rerender } = render(
        <SessionDialog {...defaultProps} onConnect={onConnect} onConnected={onConnected} sessions={sessions} />,
      );
      await fillNewSsh(container);
      await act(async () => { fireEvent.click(screen.getByText('Connect')); });
      sessions = makeSessions([['sess-ok', 'connected']]);
      await act(async () => {
        rerender(<SessionDialog {...defaultProps} onConnect={onConnect} onConnected={onConnected} sessions={sessions} />);
      });
      expect(onConnected).toHaveBeenCalledWith('sess-ok');
    });

    it('shows the failure reason inline and preserves the form when the session errors', async () => {
      const onConnect = vi.fn().mockReturnValue('sess-bad');
      const onConnected = vi.fn();
      let sessions = makeSessions([['sess-bad', 'connecting']]);
      const { container, rerender } = render(
        <SessionDialog {...defaultProps} onConnect={onConnect} onConnected={onConnected} sessions={sessions} />,
      );
      await fillNewSsh(container, '203.0.113.9', 'admin');
      await act(async () => { fireEvent.click(screen.getByText('Connect')); });
      // Backend reports failure with a humanized reason on the session record.
      sessions = new Map([['sess-bad', {
        id: 'sess-bad', status: 'error', errorMessage: 'Password authentication failed',
      } as unknown as SessionRecord]]);
      await act(async () => {
        rerender(<SessionDialog {...defaultProps} onConnect={onConnect} onConnected={onConnected} sessions={sessions} />);
      });
      // Reason shown inline; onConnected NOT called; form retained; Connect re-enabled.
      expect(container.querySelector('.connect-status-error')).toBeTruthy();
      expect(screen.getByText('Password authentication failed')).toBeTruthy();
      expect(onConnected).not.toHaveBeenCalled();
      expect((container.querySelector('input[placeholder="example.com"]') as HTMLInputElement).value).toBe('203.0.113.9');
      expect((container.querySelector('.btn-primary') as HTMLButtonElement).disabled).toBe(false);
    });

    it('falls back to a generic reason when the failed record carries no message', async () => {
      const onConnect = vi.fn().mockReturnValue('sess-generic');
      let sessions = makeSessions([['sess-generic', 'connecting']]);
      const { container, rerender } = render(<SessionDialog {...defaultProps} onConnect={onConnect} sessions={sessions} />);
      await fillNewSsh(container);
      await act(async () => { fireEvent.click(screen.getByText('Connect')); });
      sessions = makeSessions([['sess-generic', 'error']]);
      await act(async () => {
        rerender(<SessionDialog {...defaultProps} onConnect={onConnect} sessions={sessions} />);
      });
      expect(container.querySelector('.connect-status-error')?.textContent).toContain('Connection failed');
    });

    it('Cancel aborts the in-progress connection and returns to an editable form', async () => {
      const onConnect = vi.fn().mockReturnValue('sess-cancel');
      const onCancelConnect = vi.fn();
      const sessions = makeSessions([['sess-cancel', 'connecting']]);
      const { container } = render(
        <SessionDialog {...defaultProps} onConnect={onConnect} onCancelConnect={onCancelConnect} sessions={sessions} />,
      );
      await fillNewSsh(container);
      await act(async () => { fireEvent.click(screen.getByText('Connect')); });
      expect(container.querySelector('.connect-status')).toBeTruthy();
      await act(async () => { fireEvent.click(screen.getByText('Cancel')); });
      expect(onCancelConnect).toHaveBeenCalledWith('sess-cancel');
      // Back to editable: connecting indicator gone, Connect enabled.
      expect(container.querySelector('.connect-status')).toBeNull();
      const submit = container.querySelector('.btn-primary') as HTMLButtonElement;
      expect(submit.textContent).toContain('Connect');
      expect(submit.disabled).toBe(false);
    });

    it('Escape cancels the attempt instead of closing the dialog while connecting', async () => {
      const onConnect = vi.fn().mockReturnValue('sess-esc');
      const onClose = vi.fn();
      const onCancelConnect = vi.fn();
      const sessions = makeSessions([['sess-esc', 'connecting']]);
      const { container } = render(
        <SessionDialog {...defaultProps} onConnect={onConnect} onClose={onClose} onCancelConnect={onCancelConnect} sessions={sessions} />,
      );
      await fillNewSsh(container);
      await act(async () => { fireEvent.click(screen.getByText('Connect')); });
      await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
      expect(onCancelConnect).toHaveBeenCalledWith('sess-esc');
      expect(onClose).not.toHaveBeenCalled();
    });

    it('the ✕ button cancels the attempt instead of closing while connecting', async () => {
      const onConnect = vi.fn().mockReturnValue('sess-x');
      const onClose = vi.fn();
      const onCancelConnect = vi.fn();
      const sessions = makeSessions([['sess-x', 'connecting']]);
      const { container } = render(
        <SessionDialog {...defaultProps} onConnect={onConnect} onClose={onClose} onCancelConnect={onCancelConnect} sessions={sessions} />,
      );
      await fillNewSsh(container);
      await act(async () => { fireEvent.click(screen.getByText('Connect')); });
      await act(async () => { fireEvent.click(screen.getByText('✕')); });
      expect(onCancelConnect).toHaveBeenCalledWith('sess-x');
      expect(onClose).not.toHaveBeenCalled();
    });

    it('Escape closes the dialog when no connection is in progress', async () => {
      const onClose = vi.fn();
      render(<SessionDialog {...defaultProps} onClose={onClose} />);
      await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Google Cloud IAP protocol (removed — handled by GCP tab)', () => {
    it('protocol selector does NOT include a Google Cloud IAP option', () => {
      render(<SessionDialog {...defaultProps} />);
      // Hosts-tab dropdown no longer offers IAP — the GCP tab owns IAP
      // discovery and one-shot connections.
      expect(screen.queryByText('Google Cloud IAP')).toBeNull();
    });

    it('does not render the legacy IAP form fields anywhere', () => {
      render(<SessionDialog {...defaultProps} />);
      expect(screen.queryByText('GCP Project')).toBeNull();
      expect(screen.queryByText('Zone')).toBeNull();
      // "Instance" appears in several other contexts; scope to the legacy
      // form's label that we removed.
      expect(screen.queryByText(/handled automatically by gcloud/i)).toBeNull();
    });
  });

  describe('Web bookmarks tab', () => {
    it('switches to the Web tab and shows the bookmark tree', () => {
      render(<SessionDialog {...defaultProps} />);
      fireEvent.click(screen.getByRole('tab', { name: 'Web' }));
      expect(screen.getByText(/No bookmarks yet/)).toBeTruthy();
    });

    it('double-clicking a bookmark opens it and closes the dialog', () => {
      useBookmarkStore.getState().addBookmark(null, 'Docs', 'http://docs.test');
      const onOpenBookmark = vi.fn();
      const onClose = vi.fn();
      render(<SessionDialog {...defaultProps} onOpenBookmark={onOpenBookmark} onClose={onClose} />);
      fireEvent.click(screen.getByRole('tab', { name: 'Web' }));
      fireEvent.doubleClick(screen.getByText('Docs'));
      expect(onOpenBookmark).toHaveBeenCalledWith('http://docs.test');
      expect(onClose).toHaveBeenCalled();
    });

    it('the "New Web Browser" entry opens a blank pane and closes the dialog', () => {
      const onOpenBookmark = vi.fn();
      const onClose = vi.fn();
      render(<SessionDialog {...defaultProps} onOpenBookmark={onOpenBookmark} onClose={onClose} />);
      fireEvent.click(screen.getByRole('tab', { name: 'Web' }));
      fireEvent.click(screen.getByText('New Web Browser'));
      expect(onOpenBookmark).toHaveBeenCalledWith(undefined);
      expect(onClose).toHaveBeenCalled();
    });
  });
});
