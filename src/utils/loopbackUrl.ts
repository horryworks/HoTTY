// Where a local AI server lives, for the consent gate (ADR-AI-009): a server on
// this PC needs no consent, one on another machine needs it once per host.
// Mirrors `is_loopback_base_url` in src-tauri/src/services/base_url.rs.

/** The host (with port) of a base URL, lower-cased; null when it is not a URL. */
export function urlHost(url: string): string | null {
    try {
        const host = new URL(url).host.toLowerCase();
        return host || null;
    } catch {
        return null;
    }
}

/** True when the URL points at this PC: `localhost`, 127.0.0.0/8 or `::1`. */
export function isLoopbackUrl(url: string): boolean {
    let hostname: string;
    try {
        hostname = new URL(url).hostname.toLowerCase();
    } catch {
        return false;
    }
    if (hostname === 'localhost' || hostname === '[::1]') return true;
    return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}
