import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import type {
  GcloudCacheSnapshot,
  GcpRefreshProgress,
} from '../../types/appTypes';

let currentSnapshot: GcloudCacheSnapshot = {
  projects: [],
  instancesByProject: {},
  projectErrors: {},
  refreshInProgress: false,
};

const gceIapGetCache = vi.fn(() => Promise.resolve(currentSnapshot));
const gceIapRefreshCache = vi.fn(() => Promise.resolve(currentSnapshot));
const gceIapStartInstance = vi.fn().mockResolvedValue(undefined);
const gceIapStopInstance = vi.fn().mockResolvedValue(undefined);
const gceIapGetInstanceStatus = vi.fn().mockResolvedValue('PROVISIONING');

let emitProgress: ((p: GcpRefreshProgress) => void) | null = null;
let emitUpdated: (() => void) | null = null;

vi.mock('../../services/tauriService', () => ({
  tauriService: {
    gceIapGetCache: () => gceIapGetCache(),
    gceIapRefreshCache: () => gceIapRefreshCache(),
    gceIapStartInstance: (p: string, z: string, i: string) =>
      gceIapStartInstance(p, z, i),
    gceIapStopInstance: (p: string, z: string, i: string) =>
      gceIapStopInstance(p, z, i),
    gceIapGetInstanceStatus: (p: string, z: string, i: string) =>
      gceIapGetInstanceStatus(p, z, i),
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
  },
}));

import {
  GcpInstancesPane,
  STATUS_INITIAL_DELAY_MS,
  STATUS_POLL_INTERVAL_MS,
} from './GcpInstancesPane';

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
    lastRefreshedMs: 1_700_000_000_000,
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
    gceIapStopInstance.mockClear();
    gceIapGetInstanceStatus.mockClear();
    gceIapGetInstanceStatus.mockResolvedValue('PROVISIONING');
    emitProgress = null;
    emitUpdated = null;
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

  it('does NOT auto-refresh when cache already has data', async () => {
    setSnapshot(populatedSnapshot());
    render(<GcpInstancesPane />);
    await waitFor(() => expect(gceIapGetCache).toHaveBeenCalled());
    // Give any chained microtasks a chance to run.
    await new Promise((r) => setTimeout(r, 0));
    expect(gceIapRefreshCache).not.toHaveBeenCalled();
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

  it('Stop button calls gceIapStopInstance for running VM', async () => {
    setSnapshot(populatedSnapshot());
    render(<GcpInstancesPane />);
    await waitFor(() => expect(screen.getByText('vm-prod')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Stop vm-prod'));
    await waitFor(() =>
      expect(gceIapStopInstance).toHaveBeenCalledWith('proj-a', 'us-central1-a', 'vm-prod'),
    );
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

  it('shows the "not authenticated" hint when auth.authenticated is false', async () => {
    setSnapshot({
      gcloud: { available: true },
      auth: { authenticated: false },
      projects: [],
      instancesByProject: {},
      projectErrors: {},
      lastRefreshedMs: 1_700_000_000_000,
      refreshInProgress: false,
    });
    render(<GcpInstancesPane />);
    await waitFor(() =>
      expect(screen.getByText(/Not authenticated/)).toBeTruthy(),
    );
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

  it('shows the optimistic "STARTING" label as soon as Start is clicked, before any poll fires', async () => {
    setSnapshot(populatedSnapshot());
    // Hold the gcloud start call open so we can observe the in-flight state.
    let resolveStart: () => void = () => {};
    gceIapStartInstance.mockImplementationOnce(
      () => new Promise<void>((res) => { resolveStart = res; }),
    );
    render(<GcpInstancesPane />);
    await waitFor(() => expect(screen.getByText('vm-stg')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Start vm-stg'));
    // Without waiting for any poll interval, the row's status text should
    // already have moved off the cached TERMINATED to the optimistic STARTING.
    await waitFor(() => expect(screen.getByText('STARTING')).toBeTruthy());

    // Both action buttons should be hidden while pending.
    expect(screen.queryByLabelText('Start vm-stg')).toBeNull();
    expect(screen.queryByLabelText('Stop vm-stg')).toBeNull();

    // Let the start call resolve so the test can clean up.
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
    await waitFor(() => expect(screen.getByText('STOPPING')).toBeTruthy());
    expect(screen.queryByLabelText('Stop vm-prod')).toBeNull();
    expect(screen.queryByLabelText('Start vm-prod')).toBeNull();

    await act(async () => {
      resolveStop();
    });
  });

  it('replaces the optimistic STARTING label with the polled status once a poll resolves', async () => {
    setSnapshot(populatedSnapshot());
    vi.useFakeTimers();
    // Keep gcloud start open so the poll loop drives the UI.
    gceIapStartInstance.mockImplementationOnce(() => new Promise<void>(() => {}));
    gceIapGetInstanceStatus.mockResolvedValue('PROVISIONING');

    try {
      render(<GcpInstancesPane />);
      // First mount reads the cache via a microtask; flush it.
      await act(async () => { await Promise.resolve(); });
      expect(screen.getByText('vm-stg')).toBeTruthy();

      fireEvent.click(screen.getByLabelText('Start vm-stg'));
      // Optimistic label appears immediately, before any poll.
      expect(screen.getByText('STARTING')).toBeTruthy();

      // Advance past the initial delay so the first poll fires + resolves.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(STATUS_INITIAL_DELAY_MS + 50);
      });

      expect(gceIapGetInstanceStatus).toHaveBeenCalledWith('proj-a', 'us-central1-a', 'vm-stg');
      expect(screen.getByText('PROVISIONING')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps polling until the VM reaches RUNNING — does NOT revert to TERMINATED when gcloud start returns', async () => {
    setSnapshot(populatedSnapshot());
    vi.useFakeTimers();
    // gcloud start returns quickly (mirroring the real bug the user saw).
    gceIapStartInstance.mockResolvedValueOnce(undefined);
    // Simulate the VM's real transition over several polls.
    gceIapGetInstanceStatus
      .mockResolvedValueOnce('PROVISIONING')
      .mockResolvedValueOnce('STAGING')
      .mockResolvedValueOnce('RUNNING')
      .mockResolvedValue('RUNNING');

    try {
      render(<GcpInstancesPane />);
      await act(async () => { await Promise.resolve(); });

      fireEvent.click(screen.getByLabelText('Start vm-stg'));
      expect(screen.getByText('STARTING')).toBeTruthy();

      // Walk through the poll cycles. After each cycle the row should reflect
      // the latest polled status — never bouncing back to the cached
      // TERMINATED even after gcloud start has resolved. Scope assertions to
      // the vm-stg row since vm-prod also displays "RUNNING" from the cache.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(STATUS_INITIAL_DELAY_MS + 50);
      });
      expect(within(rowOf('vm-stg')).getByText('PROVISIONING')).toBeTruthy();
      expect(within(rowOf('vm-stg')).queryByText('TERMINATED')).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(STATUS_POLL_INTERVAL_MS + 50);
      });
      expect(within(rowOf('vm-stg')).getByText('STAGING')).toBeTruthy();
      expect(within(rowOf('vm-stg')).queryByText('TERMINATED')).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(STATUS_POLL_INTERVAL_MS + 50);
      });
      expect(within(rowOf('vm-stg')).getByText('RUNNING')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps polling until the VM reaches TERMINATED — does NOT revert to RUNNING when gcloud stop returns', async () => {
    setSnapshot(populatedSnapshot());
    vi.useFakeTimers();
    gceIapStopInstance.mockResolvedValueOnce(undefined);
    // Real GCE transition: RUNNING (briefly still) -> STOPPING -> TERMINATED.
    gceIapGetInstanceStatus
      .mockResolvedValueOnce('STOPPING')
      .mockResolvedValueOnce('TERMINATED')
      .mockResolvedValue('TERMINATED');

    try {
      render(<GcpInstancesPane />);
      await act(async () => { await Promise.resolve(); });

      fireEvent.click(screen.getByLabelText('Stop vm-prod'));
      // Optimistic STOPPING shows before any poll.
      expect(within(rowOf('vm-prod')).getByText('STOPPING')).toBeTruthy();

      // After the first poll: still STOPPING (from gcloud, matches optimistic).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(STATUS_INITIAL_DELAY_MS + 50);
      });
      expect(within(rowOf('vm-prod')).getByText('STOPPING')).toBeTruthy();

      // After the second poll: TERMINATED, loop exits, snapshot updated.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(STATUS_POLL_INTERVAL_MS + 50);
      });
      expect(within(rowOf('vm-prod')).getByText('TERMINATED')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('suppresses a stale "RUNNING" poll response while stopping — display stays STOPPING', async () => {
    setSnapshot(populatedSnapshot());
    vi.useFakeTimers();
    gceIapStopInstance.mockImplementationOnce(() => new Promise<void>(() => {}));
    // First describe arrives before GCP has registered the stop: still RUNNING.
    // We must NOT show that — it would visibly flip RUNNING ⇄ STOPPING.
    gceIapGetInstanceStatus.mockResolvedValueOnce('RUNNING');

    try {
      render(<GcpInstancesPane />);
      await act(async () => { await Promise.resolve(); });

      fireEvent.click(screen.getByLabelText('Stop vm-prod'));
      expect(within(rowOf('vm-prod')).getByText('STOPPING')).toBeTruthy();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(STATUS_INITIAL_DELAY_MS + 50);
      });
      // The "RUNNING" from gcloud is on the wrong side of the transition for
      // a 'stopping' action — the optimistic STOPPING must remain visible.
      expect(within(rowOf('vm-prod')).getByText('STOPPING')).toBeTruthy();
      expect(within(rowOf('vm-prod')).queryByText('RUNNING')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('suppresses a stale "TERMINATED" poll response while starting — display stays STARTING', async () => {
    setSnapshot(populatedSnapshot());
    vi.useFakeTimers();
    gceIapStartInstance.mockImplementationOnce(() => new Promise<void>(() => {}));
    gceIapGetInstanceStatus.mockResolvedValueOnce('TERMINATED');

    try {
      render(<GcpInstancesPane />);
      await act(async () => { await Promise.resolve(); });

      fireEvent.click(screen.getByLabelText('Start vm-stg'));
      expect(within(rowOf('vm-stg')).getByText('STARTING')).toBeTruthy();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(STATUS_INITIAL_DELAY_MS + 50);
      });
      expect(within(rowOf('vm-stg')).getByText('STARTING')).toBeTruthy();
      expect(within(rowOf('vm-stg')).queryByText('TERMINATED')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does NOT trigger a full cache refresh after a successful Start', async () => {
    setSnapshot(populatedSnapshot());
    vi.useFakeTimers();
    gceIapStartInstance.mockResolvedValueOnce(undefined);
    gceIapGetInstanceStatus.mockResolvedValue('RUNNING');

    try {
      render(<GcpInstancesPane />);
      await act(async () => { await Promise.resolve(); });
      gceIapRefreshCache.mockClear();

      fireEvent.click(screen.getByLabelText('Start vm-stg'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(STATUS_INITIAL_DELAY_MS + 50);
      });
      // The poll saw RUNNING on the first probe; the tracker should exit
      // without ever calling gceIapRefreshCache (which would surface a
      // "Listing projects" progress message).
      expect(gceIapRefreshCache).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the per-VM ⚠ badge and a global error when Start fails', async () => {
    setSnapshot(populatedSnapshot());
    vi.useFakeTimers();
    gceIapStartInstance.mockRejectedValueOnce('quota exceeded');
    gceIapGetInstanceStatus.mockResolvedValue('TERMINATED');

    try {
      render(<GcpInstancesPane />);
      await act(async () => { await Promise.resolve(); });
      expect(screen.getByText('vm-stg')).toBeTruthy();

      fireEvent.click(screen.getByLabelText('Start vm-stg'));

      // Drain initial delay + the post-error final probe.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(STATUS_INITIAL_DELAY_MS + 100);
      });

      expect(screen.getByText(/Start failed.*quota exceeded/)).toBeTruthy();
      expect(screen.getByLabelText(/Error: quota exceeded/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('on Start failure: shows error, probes once more for real status, no full refresh', async () => {
    setSnapshot(populatedSnapshot());
    vi.useFakeTimers();
    gceIapStartInstance.mockRejectedValueOnce('quota exceeded');
    gceIapGetInstanceStatus.mockResolvedValue('TERMINATED');

    try {
      render(<GcpInstancesPane />);
      await act(async () => { await Promise.resolve(); });
      gceIapRefreshCache.mockClear();

      fireEvent.click(screen.getByLabelText('Start vm-stg'));
      // Optimistic.
      expect(screen.getByText('STARTING')).toBeTruthy();

      // Drain the initial delay + the post-error final probe.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(STATUS_INITIAL_DELAY_MS + 50);
      });

      // Global error banner and per-VM badge are shown.
      expect(screen.getByText(/Start failed.*quota exceeded/)).toBeTruthy();
      expect(screen.getByLabelText(/Error: quota exceeded/)).toBeTruthy();
      // No full cache refresh was triggered.
      expect(gceIapRefreshCache).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
