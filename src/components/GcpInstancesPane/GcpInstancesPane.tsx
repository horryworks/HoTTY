import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tauriService } from '../../services/tauriService';
import type {
  GceInstance,
  GcloudCacheSnapshot,
  GcpRefreshProgress,
} from '../../types/appTypes';
import './GcpInstancesPane.css';

const EMPTY_SNAPSHOT: GcloudCacheSnapshot = {
  projects: [],
  instancesByProject: {},
  projectErrors: {},
  refreshInProgress: false,
};

interface VmSelection {
  project: string;
  zone: string;
  instance: string;
}

type PendingAction = 'starting' | 'stopping';

/** Initial delay before the first describe — gives the gcloud start/stop API
 *  request a moment to propagate so the first poll isn't just the pre-action
 *  status (which would briefly clobber the optimistic label). */
const STATUS_INITIAL_DELAY_MS = 1500;

/** Cadence of subsequent describes while a start/stop is in flight. */
const STATUS_POLL_INTERVAL_MS = 3000;

/** Safety cap on the start/stop wait loop (5 min). After this the loop bails
 *  out even if the VM hasn't reached the target status. */
const STATUS_POLL_MAX_MS = 5 * 60 * 1000;

const START_TARGETS = ['RUNNING'];
const STOP_TARGETS = ['TERMINATED', 'STOPPED', 'SUSPENDED'];

/**
 * While a start/stop is pending, a freshly-polled live status is "acceptable"
 * to display only if it represents forward progress toward the target. A poll
 * that arrives faster than the gcloud action propagates to GCP can briefly
 * return the pre-action status (TERMINATED while starting; RUNNING while
 * stopping), and displaying that would visibly bounce the row backwards.
 * Filtering it out keeps the optimistic label visible until the API actually
 * reflects the action.
 */
function isLiveStatusOnPath(live: string, action: PendingAction): boolean {
  const s = live.toUpperCase();
  if (action === 'starting') {
    return s === 'PROVISIONING' || s === 'STAGING' || s === 'REPAIRING' || s === 'RUNNING';
  }
  // stopping
  return (
    s === 'STOPPING' ||
    s === 'SUSPENDING' ||
    s === 'TERMINATED' ||
    s === 'STOPPED' ||
    s === 'SUSPENDED'
  );
}

function vmKey(sel: VmSelection): string {
  return `${sel.project}/${sel.zone}/${sel.instance}`;
}

/** Per-VM abort flag for an in-flight start/stop poll loop. */
interface VmAbortFlag {
  aborted: boolean;
}

interface GcpInstancesPaneProps {
  /** Called when the user clicks an instance — same role as HostTree's onSelect. */
  onSelectInstance?: (sel: VmSelection) => void;
  /** Called on double-click — same role as HostTree's onDoubleClickHost. */
  onActivateInstance?: (sel: VmSelection) => void;
}

function statusGlyph(status: string): string {
  const s = status.toUpperCase();
  if (s === 'RUNNING') return '🟢';
  if (s === 'TERMINATED' || s === 'STOPPED' || s === 'SUSPENDED') return '🔴';
  return '🟡';
}

function isTransitional(status: string): boolean {
  const s = status.toUpperCase();
  return (
    s === 'PROVISIONING' ||
    s === 'STAGING' ||
    s === 'STOPPING' ||
    s === 'SUSPENDING' ||
    s === 'REPAIRING'
  );
}

function formatLastRefreshed(ms?: number): string {
  if (!ms) return 'never';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return 'unknown';
  }
}

interface GroupedInstance {
  zone: string;
  instances: GceInstance[];
}

function groupByZone(instances: GceInstance[]): GroupedInstance[] {
  const byZone = new Map<string, GceInstance[]>();
  for (const inst of instances) {
    const zone = inst.zone ?? 'unknown';
    let list = byZone.get(zone);
    if (!list) {
      list = [];
      byZone.set(zone, list);
    }
    list.push(inst);
  }
  return Array.from(byZone.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([zone, instances]) => ({ zone, instances }));
}

export function GcpInstancesPane({
  onSelectInstance,
  onActivateInstance,
}: GcpInstancesPaneProps) {
  const [snapshot, setSnapshot] = useState<GcloudCacheSnapshot>(EMPTY_SNAPSHOT);
  const [progress, setProgress] = useState<GcpRefreshProgress | null>(null);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<VmSelection | null>(null);
  const [pendingActions, setPendingActions] = useState<Map<string, PendingAction>>(
    () => new Map(),
  );
  const [liveStatus, setLiveStatus] = useState<Map<string, string>>(() => new Map());
  const [vmErrors, setVmErrors] = useState<Map<string, string>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const didInitialFetchRef = useRef(false);
  /** Map of vmKey → abort flag for an in-flight start/stop tracking loop. */
  const activeActionsRef = useRef<Map<string, VmAbortFlag>>(new Map());

  const refreshAndStore = useCallback(async () => {
    try {
      const snap = await tauriService.gceIapRefreshCache();
      setSnapshot(snap);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // Initial load: read cache; if empty (= first time the pane mounts), kick off
  // a refresh in the background. Subsequent mounts reuse the cache and require
  // an explicit Refresh click to re-fetch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await tauriService.gceIapGetCache();
        if (cancelled) return;
        setSnapshot(snap);
        const isEmpty =
          !snap.gcloud && !snap.auth && snap.projects.length === 0 && !snap.lastRefreshedMs;
        if (isEmpty && !didInitialFetchRef.current) {
          didInitialFetchRef.current = true;
          refreshAndStore();
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshAndStore]);

  // Event subscriptions: progress + completion.
  useEffect(() => {
    let unlistenProgress: undefined | (() => void);
    let unlistenUpdated: undefined | (() => void);
    let cancelled = false;
    (async () => {
      const p = await tauriService.onGcpRefreshProgress((evt) => {
        setProgress(evt);
      });
      if (cancelled) {
        p();
        return;
      }
      unlistenProgress = p;
      const u = await tauriService.onGcpCacheUpdated(async () => {
        try {
          const snap = await tauriService.gceIapGetCache();
          setSnapshot(snap);
          setProgress(null);
        } catch (e) {
          setError(String(e));
        }
      });
      if (cancelled) {
        u();
        return;
      }
      unlistenUpdated = u;
    })();
    return () => {
      cancelled = true;
      if (unlistenProgress) unlistenProgress();
      if (unlistenUpdated) unlistenUpdated();
    };
  }, []);

  const handleRefresh = useCallback(() => {
    if (snapshot.refreshInProgress) return;
    setError(null);
    refreshAndStore();
  }, [snapshot.refreshInProgress, refreshAndStore]);

  const handleSelect = useCallback(
    (sel: VmSelection) => {
      setSelected(sel);
      onSelectInstance?.(sel);
    },
    [onSelectInstance],
  );

  const handleActivate = useCallback(
    (sel: VmSelection) => {
      setSelected(sel);
      onActivateInstance?.(sel);
    },
    [onActivateInstance],
  );

  /** Patch a single VM's status in the in-memory cache snapshot. Used at the
   *  end of a start/stop tracker so the row reflects the final status without
   *  triggering a full backend refresh (which would surface a "Listing
   *  projects..." progress message and clobber other rows). */
  const updateInstanceStatusInSnapshot = useCallback(
    (sel: VmSelection, status: string) => {
      setSnapshot((prev) => {
        const list = prev.instancesByProject[sel.project];
        if (!list) return prev;
        const target = list.find(
          (i) => i.name === sel.instance && (i.zone ?? '') === sel.zone,
        );
        if (!target || target.status === status) return prev;
        return {
          ...prev,
          instancesByProject: {
            ...prev.instancesByProject,
            [sel.project]: list.map((i) =>
              i.name === sel.instance && (i.zone ?? '') === sel.zone
                ? { ...i, status }
                : i,
            ),
          },
        };
      });
    },
    [],
  );

  /** Drive one start/stop with realtime status tracking. The gcloud action
   *  and the status poll run concurrently; the tracker doesn't end until the
   *  VM actually reaches one of `targetStatuses` (or the action errored out,
   *  or the safety timeout fires). On completion the final status is merged
   *  into the snapshot directly — no full cache refresh. */
  const runActionWithTracking = useCallback(
    async (
      sel: VmSelection,
      action: PendingAction,
      targetStatuses: string[],
      invokeAction: () => Promise<void>,
    ): Promise<void> => {
      const key = vmKey(sel);

      // If a prior tracker for this VM is still running (e.g. user double-
      // clicked Start), tell it to bail out so it doesn't fight ours.
      const prior = activeActionsRef.current.get(key);
      if (prior) prior.aborted = true;
      const ctrl: VmAbortFlag = { aborted: false };
      activeActionsRef.current.set(key, ctrl);

      setError(null);
      setVmErrors((p) => {
        const n = new Map(p);
        n.delete(key);
        return n;
      });
      setLiveStatus((p) => {
        const n = new Map(p);
        n.delete(key);
        return n;
      });
      setPendingActions((p) => new Map(p).set(key, action));

      // Fire the gcloud action without awaiting — the poll loop below drives
      // the UI in parallel. We only need the result at the very end.
      let actionError: string | null = null;
      const actionPromise = invokeAction().then(
        () => undefined,
        (e: unknown) => {
          actionError = String(e);
        },
      );

      // Initial delay so the start/stop request has a moment to register
      // before we describe — otherwise the first poll often returns the
      // pre-action status.
      await new Promise((r) => setTimeout(r, STATUS_INITIAL_DELAY_MS));

      const startedAt = Date.now();
      let finalStatus: string | null = null;
      while (!ctrl.aborted && Date.now() - startedAt < STATUS_POLL_MAX_MS) {
        try {
          const status = await tauriService.gceIapGetInstanceStatus(
            sel.project,
            sel.zone,
            sel.instance,
          );
          if (ctrl.aborted) return;
          setLiveStatus((p) => new Map(p).set(key, status));
          if (targetStatuses.includes(status.toUpperCase())) {
            finalStatus = status;
            break;
          }
        } catch {
          // Transient describe failures are non-fatal; retry next tick.
        }
        if (actionError) break;
        await new Promise((r) => setTimeout(r, STATUS_POLL_INTERVAL_MS));
      }

      // Wait for the gcloud action itself to settle so we know its outcome
      // before reporting (esp. for errors that didn't yet surface in poll).
      await actionPromise;

      if (ctrl.aborted) {
        activeActionsRef.current.delete(key);
        return;
      }

      if (actionError) {
        const verb = action === 'starting' ? 'Start' : 'Stop';
        setError(`${verb} failed: ${actionError}`);
        setVmErrors((p) => new Map(p).set(key, actionError as string));
        // Probe once more so the row doesn't keep showing the optimistic
        // STARTING/STOPPING when the action was rejected.
        try {
          const status = await tauriService.gceIapGetInstanceStatus(
            sel.project,
            sel.zone,
            sel.instance,
          );
          if (!ctrl.aborted) finalStatus = status;
        } catch {
          /* fall through with whatever finalStatus we already have */
        }
      }

      if (finalStatus) {
        updateInstanceStatusInSnapshot(sel, finalStatus);
      }

      setPendingActions((p) => {
        const n = new Map(p);
        n.delete(key);
        return n;
      });
      setLiveStatus((p) => {
        const n = new Map(p);
        n.delete(key);
        return n;
      });
      activeActionsRef.current.delete(key);
    },
    [updateInstanceStatusInSnapshot],
  );

  // Cleanup: abort any in-flight tracker loops on unmount so they stop
  // polling and stop touching React state.
  useEffect(() => {
    const active = activeActionsRef.current;
    return () => {
      active.forEach((ctrl) => {
        ctrl.aborted = true;
      });
      active.clear();
    };
  }, []);

  const handleStart = useCallback(
    (sel: VmSelection) =>
      runActionWithTracking(sel, 'starting', START_TARGETS, () =>
        tauriService.gceIapStartInstance(sel.project, sel.zone, sel.instance),
      ),
    [runActionWithTracking],
  );

  const handleStop = useCallback(
    (sel: VmSelection) =>
      runActionWithTracking(sel, 'stopping', STOP_TARGETS, () =>
        tauriService.gceIapStopInstance(sel.project, sel.zone, sel.instance),
      ),
    [runActionWithTracking],
  );

  const toggleProject = useCallback((id: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const projects = snapshot.projects;
  const isUnauthenticated = Boolean(snapshot.auth && !snapshot.auth.authenticated);
  const isGcloudMissing = Boolean(snapshot.gcloud && !snapshot.gcloud.available);
  const hasCacheData = snapshot.lastRefreshedMs !== undefined;

  const isRefreshing = snapshot.refreshInProgress || (progress !== null && progress.stage !== 'done');

  const headerSubtitle = useMemo(() => {
    if (isRefreshing) {
      if (!progress) return 'Refreshing…';
      if (progress.stage === 'gcloud') return 'Checking gcloud CLI…';
      if (progress.stage === 'auth') return 'Checking authentication…';
      if (progress.stage === 'projects') return 'Listing projects…';
      if (progress.stage === 'instances') {
        const pid = progress.currentProject ?? '';
        return `Listing instances (${progress.done}/${progress.total}) — ${pid}`;
      }
      return 'Finalising…';
    }
    if (isGcloudMissing) return 'gcloud CLI not found';
    if (isUnauthenticated) return 'Not authenticated (run `gcloud auth login`)';
    if (snapshot.auth?.authenticated && snapshot.auth.account)
      return `${snapshot.auth.account} • Last refresh: ${formatLastRefreshed(snapshot.lastRefreshedMs)}`;
    if (!hasCacheData) return 'Click ↻ to load projects';
    return `Last refresh: ${formatLastRefreshed(snapshot.lastRefreshedMs)}`;
  }, [
    isRefreshing,
    snapshot.auth,
    snapshot.lastRefreshedMs,
    progress,
    isGcloudMissing,
    isUnauthenticated,
    hasCacheData,
  ]);

  return (
    <div className="gcp-instances-pane">
      <div className="gcp-pane-header">
        <div className="gcp-pane-title">
          <span aria-hidden="true">☁ </span>Google Cloud GCE
        </div>
        <button
          type="button"
          className="gcp-refresh-btn"
          onClick={handleRefresh}
          disabled={isRefreshing}
          title="Refresh GCP discovery"
          aria-label="Refresh"
        >
          {isRefreshing ? '⟳' : '↻'}
        </button>
      </div>
      <div className="gcp-pane-subtitle">{headerSubtitle}</div>
      {error && (
        <div className="gcp-pane-error" role="alert">
          {error}
        </div>
      )}
      <div className="gcp-pane-body">
        {projects.length === 0 ? (
          <div className="gcp-empty">
            {snapshot.refreshInProgress
              ? 'Loading…'
              : isGcloudMissing
                ? 'Install the gcloud CLI to use this tab.'
                : isUnauthenticated
                  ? 'Run `gcloud auth login` in a terminal, then click ↻.'
                  : 'No projects found.'}
          </div>
        ) : (
          projects.map((project) => {
            const collapsed = collapsedProjects.has(project.id);
            const projectError = snapshot.projectErrors[project.id];
            const instances = snapshot.instancesByProject[project.id] ?? [];
            const grouped = groupByZone(instances);
            return (
              <div key={project.id} className="gcp-project-group">
                <button
                  type="button"
                  className="gcp-project-header"
                  onClick={() => toggleProject(project.id)}
                >
                  <span className={`gcp-chevron${collapsed ? '' : ' expanded'}`} aria-hidden="true">
                    ▶
                  </span>
                  <span className="gcp-project-label">{project.name || project.id}</span>
                  {projectError && (
                    <span className="gcp-project-warning" title={projectError}>
                      ⚠
                    </span>
                  )}
                </button>
                {!collapsed && (
                  <div className="gcp-project-body">
                    {projectError ? (
                      <div className="gcp-project-error">{projectError}</div>
                    ) : grouped.length === 0 ? (
                      <div className="gcp-zone-empty">No instances.</div>
                    ) : (
                      grouped.map(({ zone, instances }) => (
                        <div key={zone} className="gcp-zone-group">
                          <div className="gcp-zone-label">{zone}</div>
                          {instances.map((inst) => {
                            const key = `${project.id}/${zone}/${inst.name}`;
                            const sel: VmSelection = {
                              project: project.id,
                              zone,
                              instance: inst.name,
                            };
                            const isSelected =
                              selected !== null &&
                              selected.project === project.id &&
                              selected.zone === zone &&
                              selected.instance === inst.name;
                            const pending = pendingActions.get(key);
                            const live = liveStatus.get(key);
                            // Display priority:
                            //   1. while pending, the polled live status — but
                            //      only if it represents forward progress
                            //      (filters out stale pre-action statuses that
                            //      gcloud may return before the start/stop
                            //      request propagates).
                            //   2. otherwise the polled live status if any.
                            //   3. optimistic STARTING/STOPPING placeholder.
                            //   4. cache snapshot value.
                            let displayStatus: string;
                            if (pending) {
                              if (live && isLiveStatusOnPath(live, pending)) {
                                displayStatus = live;
                              } else {
                                displayStatus = pending === 'starting' ? 'STARTING' : 'STOPPING';
                              }
                            } else if (live) {
                              displayStatus = live;
                            } else {
                              displayStatus = inst.status;
                            }
                            const transitional =
                              pending !== undefined || isTransitional(displayStatus);
                            const isRunning = displayStatus.toUpperCase() === 'RUNNING';
                            const vmError = vmErrors.get(key);
                            return (
                              <div
                                key={key}
                                className={`gcp-instance-row${isSelected ? ' selected' : ''}`}
                                onClick={() => handleSelect(sel)}
                                onDoubleClick={() => handleActivate(sel)}
                                role="button"
                                tabIndex={0}
                                aria-label={`${inst.name} (${displayStatus})`}
                              >
                                <span className="gcp-status-glyph" aria-hidden="true">
                                  {statusGlyph(displayStatus)}
                                </span>
                                <span className="gcp-instance-name">{inst.name}</span>
                                <span className="gcp-instance-status">{displayStatus}</span>
                                {vmError && (
                                  <span
                                    className="gcp-instance-error"
                                    title={vmError}
                                    aria-label={`Error: ${vmError}`}
                                  >
                                    ⚠
                                  </span>
                                )}
                                <span className="gcp-instance-actions">
                                  {!isRunning && !transitional && (
                                    <button
                                      type="button"
                                      className="gcp-action-btn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleStart(sel);
                                      }}
                                      title="Start VM"
                                      aria-label={`Start ${inst.name}`}
                                    >
                                      ▶
                                    </button>
                                  )}
                                  {isRunning && !transitional && (
                                    <button
                                      type="button"
                                      className="gcp-action-btn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleStop(sel);
                                      }}
                                      title="Stop VM"
                                      aria-label={`Stop ${inst.name}`}
                                    >
                                      ⏹
                                    </button>
                                  )}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export type { VmSelection };
export { STATUS_INITIAL_DELAY_MS, STATUS_POLL_INTERVAL_MS, STATUS_POLL_MAX_MS };
