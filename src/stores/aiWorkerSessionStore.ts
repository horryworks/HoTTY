import { create } from 'zustand';
import type { ProtocolId } from '../types/appTypes';

/**
 * Registry of AI WORKER sessions: backend sessions the AI Chat opened on its own
 * behalf (via a `connect` fence) that have NO tab and NO xterm in this window.
 * Their output exists only in the backend watch buffer; the AI reads it through
 * the same `Terminal Output` envelopes as any watched terminal.
 *
 * NOT persisted — a worker dies with the window (the backend tears down every
 * session the window owns) and there is nothing to restore. Written only by
 * `useAiWorkerSessions` (which also owns the Tauri event wiring — this module
 * must stay free of `tauriService` so it is safe to import from anywhere).
 *
 * A worker holds NO connection config: the secrets were handed to
 * `connect_session` once and are zeroized backend-side after auth. `host` /
 * `port` / `username` are kept for display and for duplicate detection only.
 */
export type AiWorkerStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface AiWorkerSession {
    /** `h-…` (see `WORKER_SESSION_PREFIX`) — never allocated to a pane. */
    id: string;
    /** The request key (`connectRequestKey`) this worker satisfies. */
    key: string;
    displayName: string;
    protocol: ProtocolId;
    host: string;
    port?: number;
    username?: string;
    status: AiWorkerStatus;
    errorMessage?: string;
    /** The conversation that owns it (closing the tab/pane closes the worker). */
    paneId: string;
    tabId: string;
    openedAt: number;
    /** Bumped on every AI command; drives the idle auto-disconnect. */
    lastUsedAt: number;
    /** The user must log in by hand → materialize into a tab as soon as it connects. */
    manualLogin: boolean;
}

interface AiWorkerSessionState {
    workers: Readonly<Record<string, AiWorkerSession>>;
    upsert: (w: AiWorkerSession) => void;
    setStatus: (id: string, status: AiWorkerStatus, errorMessage?: string) => void;
    touch: (id: string, now?: number) => void;
    remove: (id: string) => void;
    clear: () => void;
}

export const useAiWorkerSessionStore = create<AiWorkerSessionState>((set) => ({
    workers: {},
    upsert: (w) => set((s) => ({ workers: { ...s.workers, [w.id]: w } })),
    setStatus: (id, status, errorMessage) => set((s) => {
        const cur = s.workers[id];
        if (!cur || (cur.status === status && cur.errorMessage === errorMessage)) return s;
        return { workers: { ...s.workers, [id]: { ...cur, status, errorMessage } } };
    }),
    touch: (id, now = Date.now()) => set((s) => {
        const cur = s.workers[id];
        if (!cur) return s;
        return { workers: { ...s.workers, [id]: { ...cur, lastUsedAt: now } } };
    }),
    remove: (id) => set((s) => {
        if (!(id in s.workers)) return s;
        const next = { ...s.workers };
        delete next[id];
        return { workers: next };
    }),
    clear: () => set({ workers: {} }),
}));

// ── Pure selectors ───────────────────────────────────────────────────────────

export function isWorkerLive(w: AiWorkerSession): boolean {
    return w.status === 'connected' || w.status === 'connecting';
}

export function workersForTab(workers: Readonly<Record<string, AiWorkerSession>>, paneId: string, tabId: string): AiWorkerSession[] {
    return Object.values(workers).filter((w) => w.paneId === paneId && w.tabId === tabId);
}

export function workersForPane(workers: Readonly<Record<string, AiWorkerSession>>, paneId: string): AiWorkerSession[] {
    return Object.values(workers).filter((w) => w.paneId === paneId);
}

/** Workers that have sat unused past `idleMs` (0 = never). */
export function idleWorkers(
    workers: Readonly<Record<string, AiWorkerSession>>,
    idleMs: number,
    now: number = Date.now(),
): AiWorkerSession[] {
    if (idleMs <= 0) return [];
    return Object.values(workers).filter((w) => w.status === 'connected' && now - w.lastUsedAt >= idleMs);
}
