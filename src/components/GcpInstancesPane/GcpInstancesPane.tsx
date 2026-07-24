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
  GcpVmAction,
  GcpVmActionEvent,
} from '../../types/appTypes';
import { STORAGE_KEYS } from '../../constants/storage';
import { useSettingsStore } from '../../stores/settingsStore';
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

/** How long a persisted (disk-loaded) snapshot is considered fresh enough to
 *  show without an automatic background refresh. Older than this on first mount
 *  → revalidate in the background (stale-while-revalidate). 10 minutes. */
const GCP_CACHE_TTL_MS = 10 * 60 * 1000;

function vmKey(sel: { project: string; zone: string; instance: string }): string {
  return `${sel.project}/${sel.zone}/${sel.instance}`;
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
  /** Latest in-flight `gcp-vm-action` per VM, keyed by `vmKey`. Entries appear
   *  when a Start/Stop is registered and are removed when it settles, so an
   *  entry existing IS "this VM is transitioning". The backend owns the poll
   *  loop, so these survive nothing locally — they're rehydrated on mount. */
  const [vmActions, setVmActions] = useState<Map<string, GcpVmActionEvent>>(
    () => new Map(),
  );
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
  const sshUsername = useSettingsStore((s) => s.gcpIapUsername);
  const didInitialFetchRef = useRef(false);

  const refreshAndStore = useCallback(async () => {
    try {
      const snap = await tauriService.gceIapRefreshCache();
      setSnapshot(snap);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  /** Adopt whatever Start/Stops the backend currently has in flight. This is
   *  what makes an action survive the pane unmounting — the tracker runs in the
   *  backend, so a Start issued and then "abandoned" by closing the session
   *  dialog is still there when the pane comes back. */
  const syncVmActions = useCallback(async () => {
    try {
      const actions = await tauriService.gceIapListVmActions();
      setVmActions(new Map(actions.map((a) => [vmKey(a), a])));
    } catch {
      /* Non-fatal — the event stream still drives the UI from here on. */
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
      if (!cancelled) syncVmActions();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshAndStore, syncVmActions]);

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

  /** Patch a single VM's status in this pane's copy of the cache snapshot.
   *  The backend already wrote (and persisted) the same value into the real
   *  cache; mirroring it here avoids a full refetch, which would surface a
   *  "Listing projects..." progress message and clobber other rows. */
  const updateInstanceStatusInSnapshot = useCallback(
    (sel: { project: string; zone: string; instance: string }, status: string) => {
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

  /** Fold one backend `gcp-vm-action` event into the in-flight map. The backend
   *  publishes only forward progress — a poll that lands before the action has
   *  propagated and still reports the pre-action status is dropped there — so
   *  whatever arrives here is safe to display as-is. */
  const applyVmActionEvent = useCallback(
    (evt: GcpVmActionEvent) => {
      const key = vmKey(evt);
      if (evt.action) {
        setVmActions((p) => new Map(p).set(key, evt));
        return;
      }
      // Settled. Mirror the final status into our snapshot copy and drop the
      // in-flight entry so the row falls back to the (now-correct) cache value.
      updateInstanceStatusInSnapshot(evt, evt.status);
      setVmActions((p) => {
        const n = new Map(p);
        n.delete(key);
        return n;
      });
      if (evt.error) {
        const message = evt.error;
        setVmErrors((p) => new Map(p).set(key, message));
        setError(t('panes.gcpInstances.startFailed', { message }));
      }
    },
    [updateInstanceStatusInSnapshot, t],
  );

  // Tracked Start/Stop progress. The backend broadcasts, so this also reflects
  // actions another window started.
  useEffect(() => {
    let unlisten: undefined | (() => void);
    let cancelled = false;
    (async () => {
      const u = await tauriService.onGcpVmAction(applyVmActionEvent);
      if (cancelled) {
        u();
        return;
      }
      unlisten = u;
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [applyVmActionEvent]);

  /** Ask the backend to start or stop a VM. It returns as soon as the action is
   *  registered; every status change after that arrives via `gcp-vm-action`. */
  const beginAction = useCallback(
    async (sel: VmSelection, action: GcpVmAction): Promise<void> => {
      const key = vmKey(sel);
      setError(null);
      setVmErrors((p) => {
        const n = new Map(p);
        n.delete(key);
        return n;
      });
      // Flip the row before the IPC round trip. The backend's first event
      // carries this same placeholder, so this only closes the gap — it never
      // disagrees with what the backend is about to say.
      setVmActions((p) =>
        new Map(p).set(key, {
          ...sel,
          action,
          status: action === 'starting' ? 'STARTING' : 'STOPPING',
        }),
      );
      try {
        if (action === 'starting') {
          await tauriService.gceIapStartInstance(sel.project, sel.zone, sel.instance);
        } else {
          await tauriService.gceIapStopInstance(sel.project, sel.zone, sel.instance);
        }
      } catch (e) {
        const message = String(e);
        setVmErrors((p) => new Map(p).set(key, message));
        setError(
          action === 'starting'
            ? t('panes.gcpInstances.startFailed', { message })
            : t('panes.gcpInstances.stopFailed', { message }),
        );
        // The action was never registered, so no event is coming. Re-read the
        // backend's in-flight set rather than blindly dropping our optimistic
        // entry — the rejection may be *because* another window already has
        // this VM moving.
        syncVmActions();
      }
    },
    [syncVmActions, t],
  );

  const handleStart = useCallback(
    (sel: VmSelection) => beginAction(sel, 'starting'),
    [beginAction],
  );

  const handleStop = useCallback(
    (sel: VmSelection) => beginAction(sel, 'stopping'),
    [beginAction],
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

  const handleSshUserChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    useSettingsStore.getState().update('gcpIapUsername', e.target.value);
  }, []);

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
      <div className="gcp-pane-sshuser">
        <label className="gcp-pane-sshuser-label" htmlFor="gcp-ssh-user">
          {t('panes.gcpInstances.sshUserLabel')}
        </label>
        <input
          id="gcp-ssh-user"
          type="text"
          className="gcp-pane-sshuser-input"
          placeholder={t('panes.gcpInstances.sshUserPlaceholder')}
          value={sshUsername}
          onChange={handleSshUserChange}
          title={t('panes.gcpInstances.sshUserHint')}
        />
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
                            // A tracked action's status wins while it is in
                            // flight (it is fresher than the cache and already
                            // filtered to forward progress by the backend);
                            // otherwise show the cached status.
                            const inFlight = vmActions.get(key);
                            const displayStatus = inFlight?.status ?? inst.status;
                            const transitional =
                              inFlight !== undefined || isTransitional(displayStatus);
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
