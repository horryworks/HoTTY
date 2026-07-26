import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import type {
  GcloudCacheSnapshot,
  GcpRefreshProgress,
  GcpVmActionEvent,
} from '../../types/appTypes';

let currentSnapshot: GcloudCacheSnapshot = {
  projects: [],
  instancesByProject: {},
  projectErrors: {},
  refreshInProgress: false,
};

/** In-flight VM actions the fake backend reports from `gceIapListVmActions`. */
let currentVmActions: GcpVmActionEvent[] = [];

const gceIapGetCache = vi.fn(() => Promise.resolve(currentSnapshot));
const gceIapRefreshCache = vi.fn(() => Promise.resolve(currentSnapshot));
const gceIapStartInstance = vi.fn().mockResolvedValue(undefined);
const gceIapStopInstance = vi.fn().mockResolvedValue(undefined);
const gceIapListVmActions = vi.fn(() => Promise.resolve(currentVmActions));
const gceIapRunAuthLogin = vi.fn().mockResolvedValue(undefined);

let emitProgress: ((p: GcpRefreshProgress) => void) | null = null;
let emitUpdated: (() => void) | null = null;
let emitVmAction: ((e: GcpVmActionEvent) => void) | null = null;

vi.mock('../../services/tauriService', () => ({
  tauriService: {
    gceIapGetCache: () => gceIapGetCache(),
    gceIapRefreshCache: () => gceIapRefreshCache(),
    gceIapStartInstance: (p: string, z: string, i: string) =>
      gceIapStartInstance(p, z, i),
    gceIapStopInstance: (p: string, z: string, i: string) =>
      gceIapStopInstance(p, z, i),
    gceIapListVmActions: () => gceIapListVmActions(),
    gceIapRunAuthLogin: () => gceIapRunAuthLogin(),
    onGcpRefreshProgress: (cb: (p: GcpRefreshProgress) => void) => {
      emitProgress = cb;
      return Promise.resolve(() => {
        emitProgress = null;
      });
    },
    onGcpCacheUpdated: (cb: () => void) => {
      emitUpdated = cb;
      return Promise.resolve(() => {
        emitUpdated = null;
      });
    },
    onGcpVmAction: (cb: (e: GcpVmActionEvent) => void) => {
      emitVmAction = cb;
      return Promise.resolve(() => {
        emitVmAction = null;
      });
    },
  },
}));

import { GcpInstancesPane } from './GcpInstancesPane';
import { useSettingsStore } from '../../stores/settingsStore';
import { resolveIapUsername } from '../../utils/iapUsername';

/** Push one backend `gcp-vm-action` event, defaulting to the vm-stg target. */
async function pushVmAction(evt: Partial<GcpVmActionEvent> & { status: string }) {
  await waitFor(() => expect(emitVmAction).not.toBeNull());
  await act(async () => {
    emitVmAction!({
      project: 'proj-a',
      zone: 'us-central1-a',
      instance: 'vm-stg',
      action: 'starting',
      ...evt,
    });
  });
}

function populatedSnapshot(): GcloudCacheSnapshot {
  return {
    gcloud: { available: true, version: '456.0.0' },
    auth: { authenticated: true, account: 'user@example.com' },
    projects: [
      { id: 'proj-a', name: 'Project A' },
      { id: 'proj-b', name: 'Project B' },
    ],
    instancesByProject: {
      'proj-a': [
        { name: 'vm-prod', status: 'RUNNING', zone: 'us-central1-a' },
        { name: 'vm-stg', status: 'TERMINATED', zone: 'us-central1-a' },
      ],
      'proj-b': [],
    },
    projectErrors: {},
    // Fresh timestamp so the stale-while-revalidate logic treats this as a
    // recently-refreshed cache that should NOT auto-refresh on mount.
    lastRefreshedMs: Date.now(),
    refreshInProgress: false,
  };
}

function setSnapshot(s: GcloudCacheSnapshot) {
  currentSnapshot = s;
}

/** Find the .gcp-instance-row container for the given VM name. Scoping
 *  status-text assertions to a single row keeps tests robust when multiple
 *  VMs in the snapshot share a status (e.g. several "RUNNING" rows). */
function rowOf(name: string): HTMLElement {
  const label = screen.getByText(name);
  const row = label.closest('.gcp-instance-row');
  if (!row) throw new Error(`row for ${name} not found`);
  return row as HTMLElement;
}

describe('GcpInstancesPane', () => {
  beforeEach(() => {
    gceIapGetCache.mockClear();
    gceIapRefreshCache.mockClear();
    gceIapStartInstance.mockClear();
    gceIapStartInstance.mockResolvedValue(undefined);
    gceIapStopInstance.mockClear();
    gceIapStopInstance.mockResolvedValue(undefined);
    gceIapListVmActions.mockClear();
    gceIapRunAuthLogin.mockClear();
    gceIapRunAuthLogin.mockResolvedValue(undefined);
    currentVmActions = [];
    emitProgress = null;
    emitUpdated = null;
    emitVmAction = null;
    // Clear persisted UI state (e.g. the GCP search query) so one test's input
    // can't leak into another via localStorage.
    try {
      localStorage.clear();
    } catch {
      /* ignore in environments without localStorage */
    }
    // Reset to empty cache between tests.
    setSnapshot({
      projects: [],
      instancesByProject: {},
      projectErrors: {},
      refreshInProgress: false,
    });
  });

  it('triggers a refresh automatically when the cache is empty on first mount', async () => {
    render(<GcpInstancesPane />);
    await waitFor(() => expect(gceIapGetCache).toHaveBeenCalled());
    await waitFor(() => expect(gceIapRefreshCache).toHaveBeenCalled());
  });

  it('does NOT auto-refresh when cache already has fresh data', async () => {
    setSnapshot(populatedSnapshot());
    render(<GcpInstancesPane />);
    await waitFor(() => expect(gceIapGetCache).toHaveBeenCalled());
    // Give any chained microtasks a chance to run.
    await new Promise((r) => setTimeout(r, 0));
    expect(gceIapRefreshCache).not.toHaveBeenCalled();
  });

  it('auto-refreshes (stale-while-revalidate) when the persisted cache is stale', async () => {
    const snap = populatedSnapshot();
    // Persisted on disk long ago (older than the TTL) — show it immediately but
    // revalidate in the background.
    snap.lastRefreshedMs = Date.now() - (11 * 60 * 1000);
    setSnapshot(snap);
    render(<GcpInstancesPane />);
    // Stale data is still shown right away.
    await waitFor(() => expect(screen.getByText('vm-prod')).toBeTruthy());
    // …and a background refresh is kicked off.
    await waitFor(() => expect(gceIapRefreshCache).toHaveBeenCalled());
  });

  it('renders projects and instances grouped by zone', async () => {
    setSnapshot(populatedSnapshot());
    render(<GcpInstancesPane />);
    await waitFor(() => expect(screen.getByText('Project A')).toBeTruthy());
    expect(screen.getByText('Project B')).toBeTruthy();
    expect(screen.getByText('vm-prod')).toBeTruthy();
    expect(screen.getByText('vm-stg')).toBeTruthy();
    // Zone label appears once (both instances share us-central1-a).
    expect(screen.getAllByText('us-central1-a').length).toBeGreaterThanOrEqual(1);
  });

  it('shows a project error when projectErrors has an entry', async () => {
    const snap = populatedSnapshot();
    snap.projectErrors = { 'proj-a': 'permission denied' };
    snap.instancesByProject['proj-a'] = [];
    setSnapshot(snap);
    render(<GcpInstancesPane />);
    await waitFor(() => expect(screen.getByText('Project A')).toBeTruthy());
    expect(screen.getByText('permission denied')).toBeTruthy();
  });

  it('Refresh button calls gceIapRefreshCache and is disabled while a progress event is in flight', async () => {
    setSnapshot(populatedSnapshot());
    render(<GcpInstancesPane />);
    await waitFor(() => expect(screen.getByText('vm-prod')).toBeTruthy());
    await waitFor(() => expect(emitProgress).not.toBeNull());

    const btn = screen.getByLabelText('Refresh') as HTMLButtonElement;
    fireEvent.click(btn);
    expect(gceIapRefreshCache).toHaveBeenCalledTimes(1);

    // Simulate the backend emitting a refresh-progress event mid-flight; this
    // is what tells the UI that work is happening regardless of the snapshot.
    await act(async () => {
      emitProgress!({ stage: 'projects', done: 0, total: 0 });
    });
    await waitFor(() =>
      expect(screen.getByLabelText('Refresh').hasAttribute('disabled')).toBe(true),
    );
  });

  it('Start button calls gceIapStartInstance with (project, zone, instance) for stopped VM', async () => {
    setSnapshot(populatedSnapshot());
    render(<GcpInstancesPane />);
    await waitFor(() => expect(screen.getByText('vm-stg')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Start vm-stg'));
    await waitFor(() =>
      expect(gceIapStartInstance).toHaveBeenCalledWith('proj-a', 'us-central1-a', 'vm-stg'),
    );
  });

  it('Stop opens a confirmation dialog naming the VM and does not stop until confirmed', async () => {
    setSnapshot(populatedSnapshot());
    render(<GcpInstancesPane />);
    await waitFor(() => expect(screen.getByText('vm-prod')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Stop vm-prod'));
    // The dialog is up and names the VM; nothing has been stopped yet.
    expect(screen.getByText(/Stop "vm-prod"\?/)).toBeTruthy();
    expect(gceIapStopInstance).not.toHaveBeenCalled();
  });

  it('Stop button calls gceIapStopInstance for running VM after confirming the dialog', async () => {
    setSnapshot(populatedSnapshot());
    render(<GcpInstancesPane />);
    await waitFor(() => expect(screen.getByText('vm-prod')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Stop vm-prod'));
    // Confirm via the dialog's danger button (labeled "Stop VM").
    fireEvent.click(screen.getByRole('button', { name: 'Stop VM' }));
    await waitFor(() =>
      expect(gceIapStopInstance).toHaveBeenCalledWith('proj-a', 'us-central1-a', 'vm-prod'),
    );
  });

  it('cancelling the Stop confirmation dialog leaves the VM running', async () => {
    setSnapshot(populatedSnapshot());
    render(<GcpInstancesPane />);
    await waitFor(() => expect(screen.getByText('vm-prod')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Stop vm-prod'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    // Dialog dismissed, no stop issued, and the Stop button is still there.
    expect(screen.queryByText(/Stop "vm-prod"\?/)).toBeNull();
    expect(gceIapStopInstance).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Stop vm-prod')).toBeTruthy();
  });

  it('clicking an instance row calls onSelectInstance with the (project, zone, instance) tuple', async () => {
    setSnapshot(populatedSnapshot());
    const onSelectInstance = vi.fn();
    render(<GcpInstancesPane onSelectInstance={onSelectInstance} />);
    await waitFor(() => expect(screen.getByText('vm-prod')).toBeTruthy());
    fireEvent.click(screen.getByText('vm-prod'));
    expect(onSelectInstance).toHaveBeenCalledWith({
      project: 'proj-a',
      zone: 'us-central1-a',
      instance: 'vm-prod',
    });
  });

  it('double-clicking an instance row calls onActivateInstance', async () => {
    setSnapshot(populatedSnapshot());
    const onActivateInstance = vi.fn();
    render(<GcpInstancesPane onActivateInstance={onActivateInstance} />);
    await waitFor(() => expect(screen.getByText('vm-prod')).toBeTruthy());
    fireEvent.doubleClick(screen.getByText('vm-prod'));
    expect(onActivateInstance).toHaveBeenCalledWith({
      project: 'proj-a',
      zone: 'us-central1-a',
      instance: 'vm-prod',
    });
  });

  it('shows the "not authenticated" hint and a re-login button when auth.authenticated is false', async () => {
    setSnapshot({
      gcloud: { available: true },
      auth: { authenticated: false },
      projects: [],
      instancesByProject: {},
      projectErrors: {},
      lastRefreshedMs: Date.now(),
      refreshInProgress: false,
    });
    render(<GcpInstancesPane />);
    // The status appears both in the header subtitle and the body prompt.
    await waitFor(() =>
      expect(screen.getAllByText(/Not authenticated/).length).toBeGreaterThan(0),
    );
    expect(screen.getByRole('button', { name: 'Run gcloud auth login' })).toBeTruthy();
  });

  it('shows the credentials-expired prompt + re-login button when needsReauth is set (token refresh failed)', async () => {
    setSnapshot({
      gcloud: { available: true, version: '456.0.0' },
      // auth.authenticated stays true — `gcloud auth list` still shows the
      // account — but the refresh could not mint a token.
      auth: { authenticated: true, account: 'user@example.com' },
      projects: [],
      instancesByProject: {},
      projectErrors: {},
      refreshError: 'There was a problem refreshing your current auth token',
      needsReauth: true,
      lastRefreshedMs: Date.now(),
      refreshInProgress: false,
    });
    render(<GcpInstancesPane />);
    await waitFor(() =>
      expect(screen.getAllByText(/credentials have expired/).length).toBeGreaterThan(0),
    );
    expect(screen.getByRole('button', { name: 'Run gcloud auth login' })).toBeTruthy();
    // Not the misleading "No projects found." message.
    expect(screen.queryByText('No projects found.')).toBeNull();
  });

  it('clicking "Run gcloud auth login" launches the OAuth flow and shows the follow-up hint', async () => {
    setSnapshot({
      gcloud: { available: true, version: '456.0.0' },
      auth: { authenticated: true, account: 'user@example.com' },
      projects: [],
      instancesByProject: {},
      projectErrors: {},
      refreshError: 'There was a problem refreshing your current auth token',
      needsReauth: true,
      lastRefreshedMs: Date.now(),
      refreshInProgress: false,
    });
    render(<GcpInstancesPane />);
    const btn = await screen.findByRole('button', { name: 'Run gcloud auth login' });
    fireEvent.click(btn);
    await waitFor(() => expect(gceIapRunAuthLogin).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByText(/Complete the login in your browser/)).toBeTruthy(),
    );
  });

  it('shows a generic refresh-failure message (no re-login button) for a non-reauth error', async () => {
    setSnapshot({
      gcloud: { available: true, version: '456.0.0' },
      auth: { authenticated: true, account: 'user@example.com' },
      projects: [],
      instancesByProject: {},
      projectErrors: {},
      refreshError: 'API rate limit exceeded',
      needsReauth: false,
      lastRefreshedMs: Date.now(),
      refreshInProgress: false,
    });
    render(<GcpInstancesPane />);
    await waitFor(() =>
      expect(screen.getByText(/Could not load GCP data: API rate limit exceeded/)).toBeTruthy(),
    );
    expect(screen.queryByRole('button', { name: 'Run gcloud auth login' })).toBeNull();
  });

  it('updates UI when a cache-updated event fires after refresh', async () => {
    render(<GcpInstancesPane />);
    // Wait until the listener subscribed.
    await waitFor(() => expect(emitUpdated).not.toBeNull());

    // Emulate a backend refresh completing.
    setSnapshot(populatedSnapshot());
    await act(async () => {
      emitUpdated!();
    });
    await waitFor(() => expect(screen.getByText('vm-prod')).toBeTruthy());
  });

  it('renders progress text during an in-flight refresh', async () => {
    render(<GcpInstancesPane />);
    await waitFor(() => expect(emitProgress).not.toBeNull());
    await act(async () => {
      emitProgress!({
        stage: 'instances',
        currentProject: 'proj-a',
        done: 1,
        total: 3,
      });
    });
    await waitFor(() =>
      expect(screen.getByText(/Listing instances \(1\/3\)/)).toBeTruthy(),
    );
  });

  it('shows the optimistic "STARTING" label as soon as Start is clicked, before any event arrives', async () => {
    setSnapshot(populatedSnapshot());
    // Hold the invoke open so nothing but the optimistic update can have run.
    let resolveStart: () => void = () => {};
    gceIapStartInstance.mockImplementationOnce(
      () => new Promise<void>((res) => { resolveStart = res; }),
    );
    render(<GcpInstancesPane />);
    await waitFor(() => expect(screen.getByText('vm-stg')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Start vm-stg'));
    // The row's status text should already have moved off the cached
    // TERMINATED to the optimistic STARTING.
    await waitFor(() => expect(screen.getByText('STARTING')).toBeTruthy());

    // Both action buttons should be hidden while the action is in flight.
    expect(screen.queryByLabelText('Start vm-stg')).toBeNull();
    expect(screen.queryByLabelText('Stop vm-stg')).toBeNull();

    await act(async () => {
      resolveStart();
    });
  });

  it('shows the optimistic "STOPPING" label as soon as Stop is clicked', async () => {
    setSnapshot(populatedSnapshot());
    let resolveStop: () => void = () => {};
    gceIapStopInstance.mockImplementationOnce(
      () => new Promise<void>((res) => { resolveStop = res; }),
    );
    render(<GcpInstancesPane />);
    await waitFor(() => expect(screen.getByText('vm-prod')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Stop vm-prod'));
    fireEvent.click(screen.getByRole('button', { name: 'Stop VM' }));
    await waitFor(() => expect(screen.getByText('STOPPING')).toBeTruthy());
    expect(screen.queryByLabelText('Stop vm-prod')).toBeNull();
    expect(screen.queryByLabelText('Start vm-prod')).toBeNull();

    await act(async () => {
      resolveStop();
    });
  });

  it('replaces the optimistic STARTING label with the backend-reported status', async () => {
    setSnapshot(populatedSnapshot());
    render(<GcpInstancesPane />);
    await waitFor(() => expect(screen.getByText('vm-stg')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Start vm-stg'));
    await waitFor(() => expect(screen.getByText('STARTING')).toBeTruthy());

    await pushVmAction({ action: 'starting', status: 'PROVISIONING' });
    expect(within(rowOf('vm-stg')).getByText('PROVISIONING')).toBeTruthy();
  });

  it('tracks a start to RUNNING — never bouncing back to the cached TERMINATED', async () => {
    setSnapshot(populatedSnapshot());
    render(<GcpInstancesPane />);
    await waitFor(() => expect(screen.getByText('vm-stg')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Start vm-stg'));
    await waitFor(() => expect(screen.getByText('STARTING')).toBeTruthy());

    // Walk the transition the backend reports. Assertions are scoped to the
    // vm-stg row because vm-prod also shows "RUNNING" from the cache.
    await pushVmAction({ action: 'starting', status: 'PROVISIONING' });
    expect(within(rowOf('vm-stg')).getByText('PROVISIONING')).toBeTruthy();
    expect(within(rowOf('vm-stg')).queryByText('TERMINATED')).toBeNull();

    await pushVmAction({ action: 'starting', status: 'STAGING' });
    expect(within(rowOf('vm-stg')).getByText('STAGING')).toBeTruthy();
    expect(within(rowOf('vm-stg')).queryByText('TERMINATED')).toBeNull();

    // Settled: action null, status final. The row keeps RUNNING and the Stop
    // button comes back.
    await pushVmAction({ action: null, status: 'RUNNING' });
    expect(within(rowOf('vm-stg')).getByText('RUNNING')).toBeTruthy();
    expect(screen.getByLabelText('Stop vm-stg')).toBeTruthy();
  });

  it('tracks a stop to TERMINATED — never bouncing back to the cached RUNNING', async () => {
    setSnapshot(populatedSnapshot());
    render(<GcpInstancesPane />);
    await waitFor(() => expect(screen.getByText('vm-prod')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Stop vm-prod'));
    fireEvent.click(screen.getByRole('button', { name: 'Stop VM' }));
    await waitFor(() => expect(within(rowOf('vm-prod')).getByText('STOPPING')).toBeTruthy());

    const target = { instance: 'vm-prod', action: 'stopping' as const };
    await pushVmAction({ ...target, status: 'STOPPING' });
    expect(within(rowOf('vm-prod')).getByText('STOPPING')).toBeTruthy();

    await pushVmAction({ instance: 'vm-prod', action: null, status: 'TERMINATED' });
    expect(within(rowOf('vm-prod')).getByText('TERMINATED')).toBeTruthy();
    expect(screen.getByLabelText('Start vm-prod')).toBeTruthy();
  });

  it('the settled status survives a remount — the reported bug', async () => {
    setSnapshot(populatedSnapshot());
    const { unmount } = render(<GcpInstancesPane />);
    await waitFor(() => expect(screen.getByText('vm-prod')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Stop vm-prod'));
    fireEvent.click(screen.getByRole('button', { name: 'Stop VM' }));
    await pushVmAction({ instance: 'vm-prod', action: null, status: 'TERMINATED' });
    expect(within(rowOf('vm-prod')).getByText('TERMINATED')).toBeTruthy();

    // The pane lives inside SessionDialog and unmounts on every sidebar-tab
    // switch. Because the BACKEND owns the tracker, its cache — not this
    // component's state — is what the remount reads back, so the fresh mount
    // must not resurrect the pre-Stop RUNNING.
    unmount();
    setSnapshot({
      ...populatedSnapshot(),
      instancesByProject: {
        'proj-a': [
          { name: 'vm-prod', status: 'TERMINATED', zone: 'us-central1-a' },
          { name: 'vm-stg', status: 'TERMINATED', zone: 'us-central1-a' },
        ],
        'proj-b': [],
      },
    });
    render(<GcpInstancesPane />);
    await waitFor(() => expect(screen.getByText('vm-prod')).toBeTruthy());
    expect(within(rowOf('vm-prod')).getByText('TERMINATED')).toBeTruthy();
    expect(within(rowOf('vm-prod')).queryByText('RUNNING')).toBeNull();
  });

  it('re-adopts an in-flight action on mount, so a Start survives the dialog closing', async () => {
    setSnapshot(populatedSnapshot());
    // The backend is mid-Start on vm-stg from before this pane existed.
    currentVmActions = [
      {
        project: 'proj-a',
        zone: 'us-central1-a',
        instance: 'vm-stg',
        action: 'starting',
        status: 'PROVISIONING',
      },
    ];

    render(<GcpInstancesPane />);
    await waitFor(() => expect(gceIapListVmActions).toHaveBeenCalled());

    // The row renders as transitioning, not as the cached TERMINATED with a
    // "▶ Start" button for a VM that is already booting.
    await waitFor(() =>
      expect(within(rowOf('vm-stg')).getByText('PROVISIONING')).toBeTruthy(),
    );
    expect(screen.queryByLabelText('Start vm-stg')).toBeNull();
    expect(screen.queryByLabelText('Stop vm-stg')).toBeNull();

    // And the still-live event stream continues to drive it.
    await pushVmAction({ action: null, status: 'RUNNING' });
    expect(within(rowOf('vm-stg')).getByText('RUNNING')).toBeTruthy();
  });

  it('applies an action started by another window (events are broadcast)', async () => {
    setSnapshot(populatedSnapshot());
    render(<GcpInstancesPane />);
    await waitFor(() => expect(screen.getByText('vm-prod')).toBeTruthy());

    // No click here — the event arrives unprompted from another window.
    await pushVmAction({ instance: 'vm-prod', action: 'stopping', status: 'STOPPING' });
    expect(within(rowOf('vm-prod')).getByText('STOPPING')).toBeTruthy();
    expect(screen.queryByLabelText('Stop vm-prod')).toBeNull();
  });

  it('does NOT trigger a full cache refresh when an action settles', async () => {
    setSnapshot(populatedSnapshot());
    render(<GcpInstancesPane />);
    await waitFor(() => expect(screen.getByText('vm-stg')).toBeTruthy());
    gceIapRefreshCache.mockClear();

    fireEvent.click(screen.getByLabelText('Start vm-stg'));
    await pushVmAction({ action: null, status: 'RUNNING' });

    // A refresh would surface a "Listing projects" progress message and
    // clobber other rows; the settled event is enough on its own.
    expect(gceIapRefreshCache).not.toHaveBeenCalled();
  });

  it('shows the per-VM ⚠ badge and a global error when the settled event carries one', async () => {
    setSnapshot(populatedSnapshot());
    render(<GcpInstancesPane />);
    await waitFor(() => expect(screen.getByText('vm-stg')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Start vm-stg'));
    // gcloud rejected the start: the backend re-probed and reports the real
    // status alongside the error.
    await pushVmAction({ action: null, status: 'TERMINATED', error: 'quota exceeded' });

    expect(screen.getByText(/Start failed.*quota exceeded/)).toBeTruthy();
    expect(screen.getByLabelText(/Error: quota exceeded/)).toBeTruthy();
    // The optimistic label is gone — the row shows the real status again.
    expect(within(rowOf('vm-stg')).getByText('TERMINATED')).toBeTruthy();
    expect(screen.getByLabelText('Start vm-stg')).toBeTruthy();
  });

  it('reports a rejected registration and re-syncs the in-flight set', async () => {
    setSnapshot(populatedSnapshot());
    // The backend refuses because an action is already in flight for this VM.
    gceIapStartInstance.mockRejectedValueOnce('already in progress');
    currentVmActions = [];

    render(<GcpInstancesPane />);
    await waitFor(() => expect(screen.getByText('vm-stg')).toBeTruthy());
    gceIapListVmActions.mockClear();

    fireEvent.click(screen.getByLabelText('Start vm-stg'));

    await waitFor(() =>
      expect(screen.getByText(/Start failed.*already in progress/)).toBeTruthy(),
    );
    expect(screen.getByLabelText(/Error: already in progress/)).toBeTruthy();
    // No event is coming for an unregistered action, so the pane re-reads the
    // backend's set rather than trusting its own optimistic entry.
    expect(gceIapListVmActions).toHaveBeenCalled();
    await waitFor(() =>
      expect(within(rowOf('vm-stg')).getByText('TERMINATED')).toBeTruthy(),
    );
  });
});

describe('GcpInstancesPane — SSH user override', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
    setSnapshot(populatedSnapshot());
  });

  function sshUserInput(container: HTMLElement): HTMLInputElement {
    const el = container.querySelector('.gcp-pane-sshuser-input');
    if (!el) throw new Error('SSH user input not found');
    return el as HTMLInputElement;
  }

  it('starts blank, meaning the backend auto-detects the login name', async () => {
    const { container } = render(<GcpInstancesPane />);
    await waitFor(() => expect(gceIapGetCache).toHaveBeenCalled());
    expect(sshUserInput(container).value).toBe('');
  });

  it('writes what the user types into the shared setting', async () => {
    const { container } = render(<GcpInstancesPane />);
    await waitFor(() => expect(gceIapGetCache).toHaveBeenCalled());

    fireEvent.change(sshUserInput(container), { target: { value: 'alice' } });

    expect(useSettingsStore.getState().gcpIapUsername).toBe('alice');
  });

  it('shows a value already in the setting, so it survives a remount', async () => {
    useSettingsStore.getState().update('gcpIapUsername', 'alice');
    const { container } = render(<GcpInstancesPane />);
    await waitFor(() => expect(gceIapGetCache).toHaveBeenCalled());
    expect(sshUserInput(container).value).toBe('alice');
  });

  it('clearing the field restores auto-detection rather than sending a blank name', async () => {
    useSettingsStore.getState().update('gcpIapUsername', 'alice');
    const { container } = render(<GcpInstancesPane />);
    await waitFor(() => expect(gceIapGetCache).toHaveBeenCalled());

    fireEvent.change(sshUserInput(container), { target: { value: '' } });

    expect(useSettingsStore.getState().gcpIapUsername).toBe('');
    expect(resolveIapUsername(undefined, useSettingsStore.getState().gcpIapUsername))
      .toBeUndefined();
  });
});

describe('GcpInstancesPane — search', () => {
  /** Snapshot with two projects, each holding distinctly-named instances. */
  function searchSnapshot(): GcloudCacheSnapshot {
    return {
      gcloud: { available: true, version: '456.0.0' },
      auth: { authenticated: true, account: 'user@example.com' },
      projects: [
        { id: 'proj-web', name: 'Web Project' },
        { id: 'proj-db', name: 'Database Project' },
      ],
      instancesByProject: {
        'proj-web': [
          { name: 'web-server-01', status: 'RUNNING', zone: 'us-central1-a' },
          { name: 'web-server-02', status: 'RUNNING', zone: 'us-central1-a' },
        ],
        'proj-db': [
          { name: 'db-primary', status: 'RUNNING', zone: 'us-east1-b' },
        ],
      },
      projectErrors: {},
      lastRefreshedMs: Date.now(),
      refreshInProgress: false,
    };
  }

  const SEARCH_KEY = 'hotty_gcp_search_query';

  beforeEach(() => {
    gceIapGetCache.mockClear();
    gceIapRefreshCache.mockClear();
    gceIapListVmActions.mockClear();
    currentVmActions = [];
    emitProgress = null;
    emitUpdated = null;
    emitVmAction = null;
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    setSnapshot(searchSnapshot());
  });

  function searchInput(): HTMLInputElement {
    return screen.getByLabelText('Search GCP projects and instances') as HTMLInputElement;
  }

  it('filters to instances whose name partially matches the query (case-insensitive)', async () => {
    render(<GcpInstancesPane />);
    await waitFor(() => expect(screen.getByText('web-server-01')).toBeTruthy());

    fireEvent.change(searchInput(), { target: { value: 'WEB-server' } });

    await waitFor(() => expect(screen.queryByText('db-primary')).toBeNull());
    expect(screen.getByText('web-server-01')).toBeTruthy();
    expect(screen.getByText('web-server-02')).toBeTruthy();
    // The non-matching project disappears entirely.
    expect(screen.queryByText('Database Project')).toBeNull();
  });

  it('shows all instances of a project when the project NAME matches', async () => {
    render(<GcpInstancesPane />);
    await waitFor(() => expect(screen.getByText('db-primary')).toBeTruthy());

    // "database" matches the project name, not any instance name.
    fireEvent.change(searchInput(), { target: { value: 'database' } });

    await waitFor(() => expect(screen.queryByText('web-server-01')).toBeNull());
    expect(screen.getByText('Database Project')).toBeTruthy();
    expect(screen.getByText('db-primary')).toBeTruthy();
  });

  it('shows a "no matches" message when nothing matches', async () => {
    render(<GcpInstancesPane />);
    await waitFor(() => expect(screen.getByText('web-server-01')).toBeTruthy());

    fireEvent.change(searchInput(), { target: { value: 'zzz-nope' } });

    await waitFor(() => expect(screen.getByText(/No matches for/)).toBeTruthy());
    expect(screen.queryByText('web-server-01')).toBeNull();
    expect(screen.queryByText('db-primary')).toBeNull();
  });

  it('clear button (×) resets the filter and shows everything again', async () => {
    render(<GcpInstancesPane />);
    await waitFor(() => expect(screen.getByText('web-server-01')).toBeTruthy());

    fireEvent.change(searchInput(), { target: { value: 'web' } });
    await waitFor(() => expect(screen.queryByText('db-primary')).toBeNull());

    fireEvent.click(screen.getByLabelText('Clear search'));
    await waitFor(() => expect(screen.getByText('db-primary')).toBeTruthy());
    expect(searchInput().value).toBe('');
  });

  it('persists the query to localStorage and restores it on remount', async () => {
    const { unmount } = render(<GcpInstancesPane />);
    await waitFor(() => expect(screen.getByText('web-server-01')).toBeTruthy());

    fireEvent.change(searchInput(), { target: { value: 'web-server' } });
    await waitFor(() => expect(localStorage.getItem(SEARCH_KEY)).toBe('web-server'));

    unmount();

    // Remount: the field is pre-filled and the filter is already applied.
    render(<GcpInstancesPane />);
    await waitFor(() =>
      expect(
        (screen.getByLabelText('Search GCP projects and instances') as HTMLInputElement).value,
      ).toBe('web-server'),
    );
    expect(screen.queryByText('db-primary')).toBeNull();
  });

  it('ANDs the search filter with the IAP-access gate (denied instance stays hidden even if it matches)', async () => {
    const snap = searchSnapshot();
    // Make db-primary explicitly IAP-denied; with the default gate it is hidden.
    snap.instancesByProject['proj-db'] = [
      {
        name: 'db-primary',
        status: 'RUNNING',
        zone: 'us-east1-b',
        access: { iapTunnel: 'denied', osLogin: 'unknown' },
      },
    ];
    setSnapshot(snap);

    render(<GcpInstancesPane />);
    await waitFor(() => expect(screen.getByText('web-server-01')).toBeTruthy());
    // Hidden by the access gate from the start.
    expect(screen.queryByText('db-primary')).toBeNull();

    // Searching for it must NOT reveal it — the access gate still applies (AND).
    fireEvent.change(searchInput(), { target: { value: 'db-primary' } });
    await waitFor(() => expect(screen.getByText(/No matches for/)).toBeTruthy());
    expect(screen.queryByText('db-primary')).toBeNull();
  });
});
