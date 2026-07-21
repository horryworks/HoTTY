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
