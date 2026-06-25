import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { tauriService } from '../../services/tauriService';
import type {
  GceInstance,
  GcloudCacheSnapshot,
  GcpProject,
  GcpRefreshProgress,
} from '../../types/appTypes';
import { STORAGE_KEYS } from '../../constants/storage';
import {
  getEffectiveIapAccess,
  getEffectiveOsLoginAccess,
  isInstanceAccessible,
} from './gcpAccessHelpers';
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

/** How long a persisted (disk-loaded) snapshot is considered fresh enough to
 *  show without an automatic background refresh. Older than this on first mount
 *  → revalidate in the background (stale-while-revalidate). 10 minutes. */
const GCP_CACHE_TTL_MS = 10 * 60 * 1000;

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

function formatLastRefreshed(t: TFunction, ms?: number): string {
  if (!ms) return t('panes.gcpInstances.lastRefreshNever');
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return t('panes.gcpInstances.lastRefreshUnknown');
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
  const { t } = useTranslation();
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
  const [showInaccessible, setShowInaccessible] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.GCP_SHOW_INACCESSIBLE) === '1';
    } catch {
      return false;
    }
  });
  const [searchQuery, setSearchQuery] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.GCP_SEARCH_QUERY) ?? '';
    } catch {
      return '';
    }
  });
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

  // Initial load: read cache. If it's empty (first ever mount) OR the persisted
  // snapshot is older than the TTL (loaded from disk on a fresh app launch),
  // kick off a background refresh — showing the stale data immediately while it
  // revalidates. A fresh in-memory cache (recent refresh) is reused as-is and
  // requires an explicit Refresh click to re-fetch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await tauriService.gceIapGetCache();
        if (cancelled) return;
        setSnapshot(snap);
        const isEmpty =
          !snap.gcloud && !snap.auth && snap.projects.length === 0 && !snap.lastRefreshedMs;
        const isStale =
          !!snap.lastRefreshedMs && Date.now() - snap.lastRefreshedMs > GCP_CACHE_TTL_MS;
        if ((isEmpty || isStale) && !snap.refreshInProgress && !didInitialFetchRef.current) {
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
        // Superseded by a newer tracker for this VM (or the pane is unmounting).
        // The successor re-initializes this key's pending/live/error maps on
        // start, so we must NOT clear them here — that would wipe the
        // successor's optimistic status. Only retract our own registration, and
        // only if a successor hasn't already replaced it (otherwise we'd delete
        // the successor's ctrl and break its supersede-detection).
        if (activeActionsRef.current.get(key) === ctrl) {
          activeActionsRef.current.delete(key);
        }
        return;
      }

      if (actionError) {
        setError(
          action === 'starting'
            ? t('panes.gcpInstances.startFailed', { message: actionError })
            : t('panes.gcpInstances.stopFailed', { message: actionError }),
        );
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

      // A tracker can lose ownership during the awaits above (actionPromise /
      // the error re-probe) if the user re-clicked Start/Stop. Only commit the
      // snapshot and retract this key's transient state while we're still the
      // active owner — otherwise we'd clobber the successor's maps and write
      // state for a VM whose newer action is mid-flight (or after unmount).
      if (activeActionsRef.current.get(key) === ctrl) {
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
      }
    },
    [updateInstanceStatusInSnapshot, t],
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

  const toggleShowInaccessible = useCallback(() => {
    setShowInaccessible((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEYS.GCP_SHOW_INACCESSIBLE, next ? '1' : '0');
      } catch {
        /* localStorage may be unavailable in some test envs — ignore. */
      }
      return next;
    });
  }, []);

  const persistSearchQuery = useCallback((value: string) => {
    setSearchQuery(value);
    try {
      localStorage.setItem(STORAGE_KEYS.GCP_SEARCH_QUERY, value);
    } catch {
      /* localStorage may be unavailable in some test envs — ignore. */
    }
  }, []);

  const handleSearchChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      persistSearchQuery(e.target.value);
    },
    [persistSearchQuery],
  );

  const clearSearch = useCallback(() => {
    persistSearchQuery('');
  }, [persistSearchQuery]);

  const projects = snapshot.projects;
  const isUnauthenticated = Boolean(snapshot.auth && !snapshot.auth.authenticated);
  const isGcloudMissing = Boolean(snapshot.gcloud && !snapshot.gcloud.available);
  const hasCacheData = snapshot.lastRefreshedMs !== undefined;

  const isRefreshing = snapshot.refreshInProgress || (progress !== null && progress.stage !== 'done');

  /** Number of instances filtered out across all projects (denied IAP access). */
  const hiddenCount = useMemo(() => {
    if (showInaccessible) return 0;
    let n = 0;
    const projAccess = snapshot.projectAccess ?? {};
    for (const p of projects) {
      const pa = projAccess[p.id];
      const insts = snapshot.instancesByProject[p.id] ?? [];
      for (const inst of insts) {
        if (!isInstanceAccessible(inst, pa)) n += 1;
      }
    }
    return n;
  }, [projects, snapshot.instancesByProject, snapshot.projectAccess, showInaccessible]);

  /**
   * Projects to render after applying both the IAP-access gate (`showInaccessible`)
   * and the text search filter (AND). A project is kept when its name partially
   * matches the query (then all access-filtered instances are shown) or when at
   * least one of its instances matches. The IAP gate runs first, so search only
   * ever sees instances the user is allowed to connect to (unless the gate is off).
   */
  const visibleProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const result: Array<{
      project: GcpProject;
      instances: GceInstance[];
      projectError?: string;
    }> = [];
    for (const project of projects) {
      const projectError = snapshot.projectErrors[project.id];
      const allInstances = snapshot.instancesByProject[project.id] ?? [];
      const projAccess = snapshot.projectAccess?.[project.id];
      const accessFiltered = showInaccessible
        ? allInstances
        : allInstances.filter((inst) => isInstanceAccessible(inst, projAccess));

      // Suppress a project entirely when every instance was filtered out by the
      // IAP-tunnel permission gate and there's no project-level error worth
      // keeping visible. Projects with zero instances total stay visible so the
      // user can see they exist.
      const isProjectFullyHidden =
        !showInaccessible && !projectError && allInstances.length > 0 && accessFiltered.length === 0;
      if (isProjectFullyHidden) continue;

      const projectMatches = q === '' || (project.name || project.id).toLowerCase().includes(q);
      const instances =
        q === '' || projectMatches
          ? accessFiltered
          : accessFiltered.filter((inst) => inst.name.toLowerCase().includes(q));

      // Search active and this project neither matches by name nor has any
      // matching instance → hide it.
      if (q !== '' && !projectMatches && instances.length === 0) continue;

      result.push({ project, instances, projectError });
    }
    return result;
  }, [
    projects,
    snapshot.projectErrors,
    snapshot.instancesByProject,
    snapshot.projectAccess,
    showInaccessible,
    searchQuery,
  ]);

  const trimmedQuery = searchQuery.trim();

  const headerSubtitle = useMemo(() => {
    if (isRefreshing) {
      if (!progress) return t('panes.gcpInstances.refreshing');
      if (progress.stage === 'gcloud') return t('panes.gcpInstances.checkingGcloud');
      if (progress.stage === 'auth') return t('panes.gcpInstances.checkingAuth');
      if (progress.stage === 'projects') return t('panes.gcpInstances.listingProjects');
      if (progress.stage === 'instances') {
        const pid = progress.currentProject ?? '';
        return t('panes.gcpInstances.listingInstances', {
          done: progress.done,
          total: progress.total,
          project: pid,
        });
      }
      return t('panes.gcpInstances.finalising');
    }
    if (isGcloudMissing) return t('panes.gcpInstances.gcloudMissing');
    if (isUnauthenticated) return t('panes.gcpInstances.notAuthenticated');
    if (snapshot.auth?.authenticated && snapshot.auth.account)
      return t('panes.gcpInstances.accountAndRefresh', {
        account: snapshot.auth.account,
        time: formatLastRefreshed(t, snapshot.lastRefreshedMs),
      });
    if (!hasCacheData) return t('panes.gcpInstances.clickToLoad');
    return t('panes.gcpInstances.lastRefresh', {
      time: formatLastRefreshed(t, snapshot.lastRefreshedMs),
    });
  }, [
    isRefreshing,
    snapshot.auth,
    snapshot.lastRefreshedMs,
    progress,
    isGcloudMissing,
    isUnauthenticated,
    hasCacheData,
    t,
  ]);

  return (
    <div className="gcp-instances-pane">
      <div className="gcp-pane-header">
        <div className="gcp-pane-title">
          <span aria-hidden="true">☁ </span>{t('panes.gcpInstances.paneTitle')}
        </div>
        <div className="gcp-pane-header-actions">
          {(hiddenCount > 0 || showInaccessible) && (
            <button
              type="button"
              className={`gcp-toggle-btn${showInaccessible ? ' active' : ''}`}
              onClick={toggleShowInaccessible}
              title={
                showInaccessible
                  ? t('panes.gcpInstances.hideInaccessible')
                  : t('panes.gcpInstances.showHidden', { count: hiddenCount })
              }
              aria-label={showInaccessible ? t('panes.gcpInstances.hideInaccessibleAria') : t('panes.gcpInstances.showInaccessibleAria')}
              aria-pressed={showInaccessible}
            >
              {showInaccessible ? '👁' : `🔒 ${hiddenCount}`}
            </button>
          )}
          <button
            type="button"
            className="gcp-refresh-btn"
            onClick={handleRefresh}
            disabled={isRefreshing}
            title={t('panes.gcpInstances.refreshTitle')}
            aria-label={t('panes.gcpInstances.refresh')}
          >
            {isRefreshing ? '⟳' : '↻'}
          </button>
        </div>
      </div>
      <div className="gcp-pane-subtitle">{headerSubtitle}</div>
      <div className="gcp-pane-search">
        <input
          type="text"
          className="gcp-pane-search-input"
          placeholder={t('panes.gcpInstances.searchPlaceholder')}
          value={searchQuery}
          onChange={handleSearchChange}
          aria-label={t('panes.gcpInstances.searchAria')}
        />
        {searchQuery && (
          <button
            type="button"
            className="gcp-pane-search-clear"
            onClick={clearSearch}
            title={t('panes.gcpInstances.clearSearch')}
            aria-label={t('panes.gcpInstances.clearSearch')}
          >
            ×
          </button>
        )}
      </div>
      {error && (
        <div className="gcp-pane-error" role="alert">
          {error}
        </div>
      )}
      <div className="gcp-pane-body">
        {projects.length === 0 ? (
          <div className="gcp-empty">
            {snapshot.refreshInProgress
              ? t('panes.gcpInstances.loading')
              : isGcloudMissing
                ? t('panes.gcpInstances.installGcloud')
                : isUnauthenticated
                  ? t('panes.gcpInstances.runAuthLogin')
                  : t('panes.gcpInstances.noProjects')}
          </div>
        ) : visibleProjects.length === 0 && trimmedQuery !== '' ? (
          <div className="gcp-empty">{t('panes.gcpInstances.noMatches', { query: trimmedQuery })}</div>
        ) : (
          visibleProjects.map(({ project, instances, projectError }) => {
            const collapsed = collapsedProjects.has(project.id);
            const projAccess = snapshot.projectAccess?.[project.id];
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
                      <div className="gcp-zone-empty">{t('panes.gcpInstances.noInstances')}</div>
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
                            const iapAccess = getEffectiveIapAccess(inst, projAccess);
                            const osLoginAccess = getEffectiveOsLoginAccess(inst, projAccess);
                            const isAccessDenied = iapAccess === 'denied';
                            const osLoginMissing = osLoginAccess === 'denied';
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
                            const rowClass =
                              `gcp-instance-row${isSelected ? ' selected' : ''}` +
                              (isAccessDenied ? ' gcp-access-denied' : '');
                            const rowTitle = isAccessDenied
                              ? t('panes.gcpInstances.iapDeniedHint')
                              : osLoginMissing
                                ? t('panes.gcpInstances.osLoginHint')
                                : undefined;
                            return (
                              <div
                                key={key}
                                className={rowClass}
                                onClick={isAccessDenied ? undefined : () => handleSelect(sel)}
                                onDoubleClick={isAccessDenied ? undefined : () => handleActivate(sel)}
                                role="button"
                                tabIndex={isAccessDenied ? -1 : 0}
                                aria-disabled={isAccessDenied || undefined}
                                aria-label={t('panes.gcpInstances.instanceAria', { name: inst.name, status: displayStatus })}
                                title={rowTitle}
                              >
                                <span className="gcp-status-glyph" aria-hidden="true">
                                  {statusGlyph(displayStatus)}
                                </span>
                                <span className="gcp-instance-name">{inst.name}</span>
                                {isAccessDenied && (
                                  <span
                                    className="gcp-instance-locked"
                                    aria-label={t('panes.gcpInstances.noIapPermission')}
                                  >
                                    🔒
                                  </span>
                                )}
                                {!isAccessDenied && osLoginMissing && (
                                  <span
                                    className="gcp-instance-warning"
                                    aria-label={t('panes.gcpInstances.noOsLoginPermission')}
                                    title={t('panes.gcpInstances.osLoginHint')}
                                  >
                                    🔑
                                  </span>
                                )}
                                <span className="gcp-instance-status">{displayStatus}</span>
                                {vmError && (
                                  <span
                                    className="gcp-instance-error"
                                    title={vmError}
                                    aria-label={t('panes.gcpInstances.instanceError', { message: vmError })}
                                  >
                                    ⚠
                                  </span>
                                )}
                                <span className="gcp-instance-actions">
                                  {!isAccessDenied && !isRunning && !transitional && (
                                    <button
                                      type="button"
                                      className="gcp-action-btn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleStart(sel);
                                      }}
                                      title={t('panes.gcpInstances.startVm')}
                                      aria-label={t('panes.gcpInstances.startInstanceAria', { name: inst.name })}
                                    >
                                      ▶
                                    </button>
                                  )}
                                  {!isAccessDenied && isRunning && !transitional && (
                                    <button
                                      type="button"
                                      className="gcp-action-btn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleStop(sel);
                                      }}
                                      title={t('panes.gcpInstances.stopVm')}
                                      aria-label={t('panes.gcpInstances.stopInstanceAria', { name: inst.name })}
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
export { STATUS_INITIAL_DELAY_MS, STATUS_POLL_INTERVAL_MS };
