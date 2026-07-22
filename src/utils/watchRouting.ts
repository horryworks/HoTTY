/**
 * Pure routing decision for the AI "Watch" toggle. Phase 2: a chat tab watches a
 * SET of terminals, and toggling Watch on a terminal ADDS it to (or REMOVES it
 * from) the ACTIVE tab's watched set — rather than the old one-tab-per-terminal
 * routing. Extracted so the (otherwise hard-to-reach) toggle logic is unit-
 * testable, mirroring `evaluateWatchPoll` / `selectAutoRebinds`.
 *
 * Cases:
 *  - 'create' — no AI Chat state/tab exists yet → seed a fresh tab watching this
 *               session (cold start).
 *  - 'remove' — the active tab already watches this session → toggle it off
 *               (drop it from the set).
 *  - 'add'    — the active tab does not watch this session → add it to the set.
 *
 * Staleness is no longer handled here: a disconnected watched terminal keeps its
 * (greyed) entry in the set and auto-rebinds on reconnect, so there is no
 * "relink a dead link" routing to do.
 */

interface WatchTabLike {
    id: string;
    linkedSessions: { sessionId: string }[];
}

export type WatchToggle =
    | { action: 'create' }
    | { action: 'add'; tabId: string }
    | { action: 'remove'; tabId: string };

export function decideWatchToggle(
    sessionId: string,
    activeTab: WatchTabLike | undefined,
): WatchToggle {
    if (!activeTab) return { action: 'create' };
    return activeTab.linkedSessions.some((w) => w.sessionId === sessionId)
        ? { action: 'remove', tabId: activeTab.id }
        : { action: 'add', tabId: activeTab.id };
}

/**
 * Plan for the "Watch in ▸" picker (shown when 2+ conversations exist, so the
 * destination is explicit). SINGLE-OWNER: a terminal is watched by at most one
 * conversation, so choosing a destination MOVES it there.
 *
 *  - target = a conversation that already owns it  → toggle OFF (pure remove).
 *  - target = a different conversation             → move (remove from its current
 *                                                    owner, add to target).
 *  - target = 'new'                                → move into a fresh conversation.
 *
 * `removeFrom` lists every conversation currently holding the session (normally
 * ≤1 given the invariant; more only if a stale duplicate slipped through). `addTo`
 * is the destination tab id, `'new'`, or `null` when the click was a toggle-off.
 */
export interface WatchInPlan {
    removeFrom: string[];
    addTo: string | 'new' | null;
}

export function planWatchIn(
    sessionId: string,
    tabs: WatchTabLike[],
    target: string | 'new',
): WatchInPlan {
    const ownerIds = tabs
        .filter((t) => t.linkedSessions.some((w) => w.sessionId === sessionId))
        .map((t) => t.id);
    if (target === 'new') return { removeFrom: ownerIds, addTo: 'new' };
    if (ownerIds.includes(target)) return { removeFrom: [target], addTo: null };
    return { removeFrom: ownerIds, addTo: target };
}
