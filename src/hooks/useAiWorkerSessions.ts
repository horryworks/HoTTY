import { useCallback, useEffect, useRef } from 'react';
import { tauriService } from '../services/tauriService';
import { useSettingsStore } from '../stores/settingsStore';
import {
    useAiWorkerSessionStore,
    idleWorkers,
    workersForPane,
    workersForTab,
    type AiWorkerSession,
} from '../stores/aiWorkerSessionStore';
import { isWorkerSessionId, makeWorkerSessionId } from '../utils/paneTypes';
import { resolveLoggingForConnect } from '../utils/sessionLogging';
import type { ProtocolId } from '../types/appTypes';
import type { AdoptRequest, AnyConfig } from './useSessionManager';

/**
 * Lifecycle owner for AI WORKER sessions (ADR-AI-007): backend sessions the AI
 * Chat opens on its own behalf that have no tab and no xterm in this window.
 *
 * Mounted ONCE (in App). Owns every piece of Tauri wiring the worker store must
 * not touch: the status/error subscriptions, the idle sweep, the connect /
 * disconnect / resize calls, and "materialize" (attach a real terminal tab to a
 * live worker). The AI orchestrator only ever calls the returned API.
 *
 * Why a worker is cheap to add: `send_input` and the watch buffer are keyed by
 * session id backend-wide, `set_watching` accepts an id before the session
 * exists, and `term_resize` before connect seeds the initial pty size — so a
 * worker is exactly "a session whose window has no terminal for it", which the
 * cross-window AI link already made a supported state.
 */

/** Wide-and-tall pty so device output does not wrap at 80 columns in the capture. */
export const WORKER_PTY_COLS = 160;
export const WORKER_PTY_ROWS = 50;
/** How often the idle sweep runs. The timeout itself is a setting (minutes). */
export const WORKER_IDLE_SWEEP_MS = 30_000;
/**
 * After a worker ends (disconnected / error) it stays in the store, with its final
 * status, for this long before being dropped — so the orchestrator's 200 ms poll
 * can read the failure reason instead of finding the id simply missing.
 */
export const WORKER_REMOVE_GRACE_MS = 3_000;

export interface OpenWorkerSpec {
    paneId: string;
    tabId: string;
    /** `connectRequestKey` of the request this worker satisfies. */
    key: string;
    displayName: string;
    protocol: ProtocolId;
    /** FULL connect config incl. secrets — consumed by `connect_session` and not retained. */
    config: AnyConfig;
    host: string;
    port?: number;
    username?: string;
    /** The user must log in by hand: materialize into a tab as soon as it connects. */
    manualLogin: boolean;
}

export interface UseAiWorkerSessionsOptions {
    /** Attach a terminal to a live backend session (useSessionManager.adoptSession). */
    adoptSession: (req: AdoptRequest) => void;
    /** Allocate a pane/tab for a newly adopted session (usePaneStore.addSession). */
    addSessionToStore: (id: string) => void;
    /** A worker left (ended or closed): the owning conversation should drop its link. */
    onWorkerGone?: (worker: AiWorkerSession) => void;
    /** A worker was materialized into a tab (e.g. so the tab can be focused). */
    onWorkerMaterialized?: (worker: AiWorkerSession) => void;
}

export interface UseAiWorkerSessionsReturn {
    /** Start a worker session; returns its id synchronously (connect is fire-and-forget). */
    openWorkerSession: (spec: OpenWorkerSpec) => string;
    /** Disconnect and forget one worker. */
    closeWorkerSession: (id: string) => void;
    closeWorkersForTab: (paneId: string, tabId: string) => void;
    closeWorkersForPane: (paneId: string) => void;
    /** Turn a worker into a real terminal tab (keeps the id). Resolves false if unknown. */
    materializeWorker: (id: string) => Promise<boolean>;
    /** Mark a worker as just-used (resets its idle clock). */
    touchWorker: (id: string) => void;
}

/** Secret-free config for the adopted record: enough for the binding key and Save-to-Host-Tree. */
function configForAdopt(w: AiWorkerSession): AnyConfig {
    const encoding = useSettingsStore.getState().globalEncoding;
    if (w.protocol === 'cmd' || w.protocol === 'powershell' || w.protocol === 'git-bash') {
        return { shellType: w.protocol, encoding };
    }
    return {
        host: w.host,
        port: w.port ?? (w.protocol === 'telnet' ? 23 : 22),
        username: w.username ?? '',
        encoding,
        keepaliveIntervalSecs: 0,
        connectTimeoutSecs: 5,
    };
}

export function useAiWorkerSessions(options: UseAiWorkerSessionsOptions): UseAiWorkerSessionsReturn {
    const optionsRef = useRef(options);
    useEffect(() => { optionsRef.current = options; });

    // Pending "drop after grace" timers, keyed by worker id (idempotent).
    const removeTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    const forget = useCallback((id: string) => {
        const t = removeTimersRef.current.get(id);
        if (t) {
            clearTimeout(t);
            removeTimersRef.current.delete(id);
        }
        const w = useAiWorkerSessionStore.getState().workers[id];
        if (!w) return;
        useAiWorkerSessionStore.getState().remove(id);
        optionsRef.current.onWorkerGone?.(w);
    }, []);

    const scheduleForget = useCallback((id: string) => {
        if (removeTimersRef.current.has(id)) return;
        const t = setTimeout(() => {
            removeTimersRef.current.delete(id);
            forget(id);
        }, WORKER_REMOVE_GRACE_MS);
        removeTimersRef.current.set(id, t);
    }, [forget]);

    const materializeWorker = useCallback(async (id: string): Promise<boolean> => {
        const w = useAiWorkerSessionStore.getState().workers[id];
        if (!w) return false;
        let history = '';
        try {
            history = await tauriService.getWatchBuffer(id);
        } catch {
            /* no history — the tab simply starts empty */
        }
        // Re-read: the worker may have ended while we awaited.
        const cur = useAiWorkerSessionStore.getState().workers[id];
        if (!cur) return false;
        const t = removeTimersRef.current.get(id);
        if (t) {
            clearTimeout(t);
            removeTimersRef.current.delete(id);
        }
        optionsRef.current.adoptSession({
            id,
            displayName: cur.displayName,
            protocol: cur.protocol,
            config: configForAdopt(cur),
            status: cur.status,
            errorMessage: cur.errorMessage,
            initialText: history,
        });
        optionsRef.current.addSessionToStore(id);
        // The record now owns the session's lifecycle; the worker entry is gone
        // but the conversation's link (same id) stays, so capture continues.
        useAiWorkerSessionStore.getState().remove(id);
        optionsRef.current.onWorkerMaterialized?.(cur);
        return true;
    }, []);

    // Backend status/error events for worker ids. useSessionManager ignores ids it
    // has no record for, so workers need their own subscription.
    useEffect(() => {
        let cancelled = false;
        const unlisteners: Array<() => void> = [];
        // `Promise.resolve` + the typeof guard keep this tolerant of a stubbed
        // tauriService (tests that mount App mock only what they exercise).
        const track = (p: Promise<() => void> | undefined) => {
            Promise.resolve(p).then((fn) => {
                if (typeof fn !== 'function') return;
                if (cancelled) fn(); else unlisteners.push(fn);
            }).catch(() => {});
        };
        track(tauriService.onSessionStatus(({ sessionId, status }) => {
            if (!isWorkerSessionId(sessionId)) return;
            const store = useAiWorkerSessionStore.getState();
            const w = store.workers[sessionId];
            if (!w) return;
            if (status === 'connected') {
                store.setStatus(sessionId, 'connected');
                store.touch(sessionId);
                // A human has to log in: give them a terminal right away.
                if (w.manualLogin) void materializeWorker(sessionId);
                return;
            }
            if (status === 'disconnected') {
                // Keep an error's message if one arrived first.
                if (w.status !== 'error') store.setStatus(sessionId, 'disconnected');
                scheduleForget(sessionId);
            }
        }));
        track(tauriService.onSessionError(({ sessionId, error }) => {
            if (!isWorkerSessionId(sessionId)) return;
            const store = useAiWorkerSessionStore.getState();
            if (!store.workers[sessionId]) return;
            store.setStatus(sessionId, 'error', error);
            scheduleForget(sessionId);
        }));
        return () => {
            cancelled = true;
            for (const u of unlisteners) u();
        };
    }, [materializeWorker, scheduleForget]);

    // Idle sweep: disconnect workers nobody has used for `aiWorkerIdleTimeoutMins`.
    // No envelope is sent to the model on purpose (that would start an unprompted
    // turn); the next send's capability block simply no longer lists the alias.
    useEffect(() => {
        const iv = setInterval(() => {
            const mins = useSettingsStore.getState().aiWorkerIdleTimeoutMins;
            const idle = idleWorkers(useAiWorkerSessionStore.getState().workers, mins > 0 ? mins * 60_000 : 0);
            for (const w of idle) {
                tauriService.disconnectSession(w.id).catch(() => {});
                useAiWorkerSessionStore.getState().setStatus(w.id, 'disconnected');
                scheduleForget(w.id);
            }
        }, WORKER_IDLE_SWEEP_MS);
        return () => clearInterval(iv);
    }, [scheduleForget]);

    useEffect(() => {
        const timers = removeTimersRef.current;
        return () => {
            for (const t of timers.values()) clearTimeout(t);
            timers.clear();
        };
    }, []);

    const openWorkerSession = useCallback((spec: OpenWorkerSpec): string => {
        const id = makeWorkerSessionId();
        const now = Date.now();
        useAiWorkerSessionStore.getState().upsert({
            id,
            key: spec.key,
            displayName: spec.displayName,
            protocol: spec.protocol,
            host: spec.host,
            port: spec.port,
            username: spec.username,
            status: 'connecting',
            paneId: spec.paneId,
            tabId: spec.tabId,
            openedAt: now,
            lastUsedAt: now,
            manualLogin: spec.manualLogin,
        });
        // Fire-and-forget, like openSession: the caller polls the store/status.
        void (async () => {
            try {
                // Seed the initial pty size BEFORE connect (see term_resize): a
                // worker has no xterm to measure, and 80x24 would wrap every
                // device table in the capture.
                await tauriService.resize(id, WORKER_PTY_COLS, WORKER_PTY_ROWS).catch(() => {});
                const logging = await resolveLoggingForConnect();
                // The conversation may have been closed while we awaited — and
                // `resolveLoggingForConnect` can block on the ADR-010 native
                // folder-approval dialog, so that window is wide. `closeWorkerSession`
                // only calls `disconnectSession` (a no-op before the session exists)
                // and then forgets the entry, so connecting now would create a live
                // backend session with no id anywhere in the renderer: unclosable,
                // uncounted against the cap, and missed by the idle sweep.
                if (!useAiWorkerSessionStore.getState().workers[id]) return;
                await tauriService.connectSession(id, spec.protocol, spec.config, logging.enabled, logging.path);
                // Closed while the connect itself was in flight: the disconnect
                // `closeWorkerSession` issued then found nothing to close, so tear
                // the now-real session down here instead of leaking it.
                if (!useAiWorkerSessionStore.getState().workers[id]) {
                    tauriService.disconnectSession(id).catch(() => {});
                }
            } catch (e) {
                const store = useAiWorkerSessionStore.getState();
                if (!store.workers[id]) return;
                if (store.workers[id].status !== 'error') store.setStatus(id, 'error', String(e));
                scheduleForget(id);
            }
        })();
        return id;
    }, [scheduleForget]);

    const closeWorkerSession = useCallback((id: string) => {
        if (!useAiWorkerSessionStore.getState().workers[id]) return;
        tauriService.disconnectSession(id).catch(() => {});
        forget(id);
    }, [forget]);

    const closeWorkersForTab = useCallback((paneId: string, tabId: string) => {
        for (const w of workersForTab(useAiWorkerSessionStore.getState().workers, paneId, tabId)) {
            closeWorkerSession(w.id);
        }
    }, [closeWorkerSession]);

    const closeWorkersForPane = useCallback((paneId: string) => {
        for (const w of workersForPane(useAiWorkerSessionStore.getState().workers, paneId)) {
            closeWorkerSession(w.id);
        }
    }, [closeWorkerSession]);

    const touchWorker = useCallback((id: string) => {
        useAiWorkerSessionStore.getState().touch(id);
    }, []);

    return { openWorkerSession, closeWorkerSession, closeWorkersForTab, closeWorkersForPane, materializeWorker, touchWorker };
}
