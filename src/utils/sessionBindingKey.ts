import type { ProtocolId } from '../types/appTypes';

/**
 * Minimal structural view of a session used to compute its binding key.
 * Kept narrow (no Terminal/FitAddon) so it is trivial to construct in tests.
 */
export interface BindingKeyInput {
    protocol: ProtocolId;
    displayName: string;
    // `object` (not Record<string, unknown>) so the concrete *ConnectionConfig
    // interfaces from appTypes assign without an index signature; narrowed below.
    connectionConfig?: object;
}

/**
 * Derive a *stable* identity for a terminal session that survives
 * disconnect+reconnect. Session ids (`makeSessionId`) are minted fresh on every
 * connect, so AI Chat tabs that watch a terminal need a config-derived key to
 * re-link to the reconnected session.
 *
 * The key is intentionally based on the connection target (host/port/user, serial
 * port, WSL distro, local shell), NOT the ephemeral session id. Two concurrent
 * sessions to the same target therefore share a key — callers that auto-rebind
 * MUST treat a non-unique key as ambiguous and fall back to manual re-linking.
 *
 * Falls back to `protocol:displayName` when the connection config is absent or
 * of an unrecognized shape.
 */
export function sessionBindingKey(rec: BindingKeyInput): string {
    const proto = rec.protocol;
    const c = rec.connectionConfig as Record<string, unknown> | undefined;
    const fallback = `${proto}:${rec.displayName}`;
    if (!c) return fallback;

    const str = (v: unknown): string | undefined =>
        (typeof v === 'string' && v.length > 0) ? v
            : (typeof v === 'number') ? String(v)
                : undefined;

    switch (proto) {
        case 'ssh':
        case 'telnet': {
            const host = str(c.host);
            if (host === undefined) return fallback;
            const port = str(c.port) ?? '';
            const user = str(c.username) ?? '';
            return `${proto}:${user}@${host}:${port}`;
        }
        case 'gcloud-iap': {
            const instance = str(c.instance);
            if (instance === undefined) return fallback;
            return `gcloud-iap:${str(c.project) ?? ''}:${str(c.zone) ?? ''}:${instance}`;
        }
        case 'serial': {
            const path = str(c.path);
            return path === undefined ? fallback : `serial:${path}`;
        }
        case 'wsl':
            return `wsl:${str(c.distribution) ?? 'default'}`;
        case 'cmd':
        case 'powershell':
        case 'git-bash':
            return `local:${str(c.shellType) ?? proto}:${str(c.shellPath) ?? ''}`;
        default:
            return fallback;
    }
}
