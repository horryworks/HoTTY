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
    /** The alias fixed when the terminal was linked (`WatchedTerminal.alias`). */
    alias?: string;
}

/**
 * Pick an alias for a terminal being linked that no other watched terminal of
 * the tab already uses: the display name's slug, suffixed `-2`, `-3`, … on a
 * collision. Stored on the link so it never changes afterwards.
 */
export function assignAlias(displayName: string, taken: Iterable<string>): string {
    const used = new Set(taken);
    const base = slugifyAlias(displayName);
    if (!used.has(base)) return base;
    for (let n = 2; ; n++) {
        const candidate = `${base}-${n}`;
        if (!used.has(candidate)) return candidate;
    }
}

/**
 * Build deterministic, collision-free aliases for a tab's watched terminals, in
 * insertion order. An alias stored on the link (`alias`) is used as is — that
 * is what keeps `target=` stable: the model's history refers to a terminal by
 * the alias it was given, so unwatching a neighbour must not shift it. Entries
 * without one (links made before aliases were stored) get the display name's
 * slug; on a collision with ANY earlier alias the later entry gets a numeric
 * suffix (`web`, `web-2`, `web-3`).
 */
export function buildAliasEntries(watched: AliasInput[]): AliasEntry[] {
    const taken = new Set<string>();
    return watched.map((w) => {
        let alias: string;
        if (w.alias && !taken.has(w.alias)) {
            alias = w.alias;
        } else {
            alias = assignAlias(w.alias || w.displayName || w.sessionId, taken);
        }
        taken.add(alias);
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

/**
 * What the chips and run-target labels call each watched terminal.
 *
 * - The live name comes first; when the terminal is gone (an AI worker is
 *   forgotten a few seconds after it ends, another window's terminal leaves the
 *   backend list on disconnect) the name kept on the link stands in, so a
 *   disconnected chip still says which terminal it was.
 * - Two terminals with the same name (two connections to one device) get their
 *   alias appended — the same `-2` the AI uses in `target=` — so the user can
 *   tell them apart and match them to the AI's commands.
 *
 * An entry with no name at all maps to '' (the caller supplies its fallback).
 */
export function watchedTerminalLabels(
    watched: ReadonlyArray<{ sessionId: string; name?: string; alias?: string }>,
    nameOf: (sessionId: string) => string | undefined,
): Map<string, string> {
    const base = watched.map((w) => nameOf(w.sessionId) || w.name || '');
    const counts = new Map<string, number>();
    for (const b of base) if (b) counts.set(b, (counts.get(b) ?? 0) + 1);
    const out = new Map<string, string>();
    watched.forEach((w, i) => {
        const b = base[i];
        out.set(w.sessionId, b && (counts.get(b) ?? 0) > 1 && w.alias ? `${b} (${w.alias})` : b);
    });
    return out;
}
