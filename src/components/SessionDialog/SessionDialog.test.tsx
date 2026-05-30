import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SessionDialog } from './SessionDialog';
import type { SessionRecord } from '../../hooks/useSessionManager';
import type { SessionRecordStatus } from '../../types/appTypes';
import { STORAGE_KEYS } from '../../constants/storage';

const makeSessions = (entries: Array<[string, SessionRecordStatus]>): Map<string, SessionRecord> => {
  const m = new Map<string, SessionRecord>();
  for (const [id, status] of entries) {
    m.set(id, { id, status } as unknown as SessionRecord);
  }
  return m;
};

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

    it('clears the form and the draft when the initiated session transitions to "connected"', async () => {
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
});
