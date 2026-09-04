import type { LinkableSession, SessionInfo } from '../types/appTypes';
import type { SessionRecord } from '../hooks/useSessionManager';
import type { AiWorkerSession } from '../stores/aiWorkerSessionStore';
import type { WatchedTerminalInfo } from './aiConnectRequest';

/**
 * One place to answer "what do we know about session id X?" across the three
 * kinds of session an AI Chat tab can watch:
 *
 *   1. a terminal TAB in this window  — `SessionRecord` (xterm + full config)
 *   2. an AI WORKER in this window     — `AiWorkerSession` (backend only, no tab)
 *   3. a session owned by ANOTHER window — `SessionInfo` from `list_all_sessions`
 *      (only host/protocol/liveness are known)
 *
 * Before workers existed, the AI code paths each did their own two-way lookup
 * (record, else cross-window); adding a third kind everywhere would have spread
 * the same `?? ??` chain across useAiChat / useAiOrchestrator / AIChatPane.
 *
 * Secrets never leave this module: `hasPassword` / `hasPrivateKey` are booleans.
 */
export interface SessionView {
    displayName: string;
    /** `SessionRecordStatus` for local kinds; `'connected'` for a remote window's session. */
    status: string;
    /** Humanized connect/runtime error, when `status === 'error'`. */
    errorMessage?: string;
    protocol?: string;
    host?: string;
    port?: number;
    username?: string;
    hasPassword: boolean;
    hasPrivateKey: boolean;
    /** AI worker (no tab in this window). */
    headless: boolean;
    /** Owned by another window — commands still work (backend-global), config unknown. */
    remote: boolean;
}

export interface SessionSources {
    sessions?: ReadonlyMap<string, SessionRecord>;
    workers?: Readonly<Record<string, AiWorkerSession>>;
    /** `list_all_sessions` result (may include this window's own sessions; those are
     *  found via `sessions`/`workers` first). */
    crossWindow?: readonly SessionInfo[];
    /** The link-picker list (already merged), when that is what a component holds. */
    linkable?: ReadonlyMap<string, LinkableSession>;
}

interface ConfigShape {
    host?: unknown;
    port?: unknown;
    username?: unknown;
    password?: unknown;
    privateKeyPath?: unknown;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function viewFromRecord(rec: SessionRecord): SessionView {
    const c = (rec.connectionConfig ?? {}) as ConfigShape;
    return {
        displayName: rec.displayName,
        status: rec.status,
        errorMessage: rec.errorMessage,
        protocol: rec.protocol,
        host: str(c.host),
        port: num(c.port),
        username: str(c.username),
        hasPassword: !!str(c.password),
        hasPrivateKey: !!str(c.privateKeyPath),
        headless: false,
        remote: false,
    };
}

export function viewFromWorker(w: AiWorkerSession): SessionView {
    return {
        displayName: w.displayName,
        status: w.status,
        errorMessage: w.errorMessage,
        protocol: w.protocol,
        host: w.host || undefined, // a local shell worker has no host
        port: w.port,
        username: w.username,
        // A worker never holds its secrets (they went to the backend once); it can
        // therefore only ever lend its login NAME to a `via:` request.
        hasPassword: false,
        hasPrivateKey: false,
        headless: true,
        remote: false,
    };
}

export function lookupSession(id: string, src: SessionSources): SessionView | undefined {
    const rec = src.sessions?.get(id);
    if (rec) return viewFromRecord(rec);
    const w = src.workers?.[id];
    if (w) return viewFromWorker(w);
    const cw = src.crossWindow?.find((s) => s.sessionId === id);
    if (cw) {
        return {
            displayName: cw.host || cw.sessionId,
            status: 'connected',
            protocol: cw.protocol,
            host: cw.host || undefined,
            hasPassword: false,
            hasPrivateKey: false,
            headless: false,
            remote: true,
        };
    }
    const ls = src.linkable?.get(id);
    if (ls) {
        return {
            displayName: ls.displayName,
            status: ls.status,
            host: ls.host,
            hasPassword: false,
            hasPrivateKey: false,
            headless: !!ls.headless,
            remote: !ls.isLocal,
        };
    }
    return undefined;
}

/**
 * Project a view into what the connect resolver is allowed to know.
 *
 * Remote (another window's) sessions ARE projected: the duplicate guard keys off
 * `info.host`, so returning `undefined` for them let one conversation open a
 * second worker to a device already watched in another window — exactly the VTY
 * exhaustion ADR-AI-007 exists to prevent. Their credential flags are forced
 * `false` regardless of the view, since another window's config is not ours to
 * inherit from (`credentialSource: 'inherit'` must never resolve to a remote).
 */
export function toWatchedTerminalInfo(view: SessionView | undefined): WatchedTerminalInfo | undefined {
    if (!view) return undefined;
    if (view.remote) {
        return {
            protocol: view.protocol ?? '',
            status: view.status,
            host: view.host,
            port: view.port,
            username: view.username,
            hasPassword: false,
            hasPrivateKey: false,
            headless: view.headless,
        };
    }
    return {
        protocol: view.protocol ?? '',
        status: view.status,
        host: view.host,
        port: view.port,
        username: view.username,
        hasPassword: view.hasPassword,
        hasPrivateKey: view.hasPrivateKey,
        headless: view.headless,
    };
}
