/**
 * Short, stable, human-readable aliases for the terminals a chat tab watches, used
 * by the AI to route a command to a specific terminal via a `target=<alias>` tag on
 * its execute fence (Phase 2 multi-watch). The SAME builder produces the alias list
 * injected into the system prompt AND resolves the alias at run time, so the two can
 * never disagree.
 */

/** Normalize a display name to a compact alias token: lowercase, runs of
 *  non-alphanumerics collapsed to '-', trimmed. Empty input yields 'term'. */
export function slugifyAlias(name: string): string {
    const slug = (name || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return slug || 'term';
}

export interface AliasEntry {
    sessionId: string;
    alias: string;
    displayName: string;
    live: boolean;
}

export interface AliasInput {
    sessionId: string;
    displayName: string;
    status?: string;
}

/**
 * Build deterministic, collision-free aliases for a tab's watched terminals, in
 * insertion order. On a slug collision the later entry gets a numeric suffix
 * (`web`, `web-2`, `web-3`).
 */
export function buildAliasEntries(watched: AliasInput[]): AliasEntry[] {
    const used = new Map<string, number>();
    return watched.map((w) => {
        const base = slugifyAlias(w.displayName || w.sessionId);
        const seen = used.get(base) ?? 0;
        used.set(base, seen + 1);
        const alias = seen === 0 ? base : `${base}-${seen + 1}`;
        return {
            sessionId: w.sessionId,
            alias,
            displayName: w.displayName,
            live: w.status === 'connected',
        };
    });
}

/** Resolve an AI-declared `target=<alias>` (case-insensitive) to a watched session
 *  id, or undefined when it names nothing this tab watches (hallucinated target). */
export function resolveAlias(entries: AliasEntry[], alias: string | undefined): string | undefined {
    if (!alias) return undefined;
    const lower = alias.toLowerCase();
    return entries.find((e) => e.alias.toLowerCase() === lower)?.sessionId;
}
