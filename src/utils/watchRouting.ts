/**
 * Pure routing decision for the AI "Watch" toggle: given the session the user is
 * watching and the current tabs of an AI Chat pane, decide how to map it onto a
 * tab. Extracted from App.tsx so the (otherwise hard-to-reach) toggle logic is
 * unit-testable — mirroring `evaluateWatchPoll` / `selectAutoRebinds`.
 *
 * Cases:
 *  - 'unlink'   — a tab already links this session AND it's active → toggle off.
 *  - 'switch'   — a tab already links this session but isn't active → switch to it.
 *  - 'relink'   — the active tab is empty OR holds a stale (non-live) link →
 *                 relink it in place. `evictSessionId` is the dead link whose
 *                 watch buffer should be dropped (set only for the stale case).
 *  - 'new-tab'  — the active tab holds a DIFFERENT live link (a genuinely
 *                 different terminal) → create a new tab for this session.
 *
 * The stale-link case is the key fix: after a watched SSH connection drops and
 * the user reconnects (new session id) and presses Watch, the active tab still
 * holds the dead id. Treating that like "no link" relinks it to the live session
 * instead of spawning a confusing second tab still pointed at the dead one.
 */

export interface WatchTabLike {
    id: string;
    linkedSessionId?: string;
}

export type WatchRouting =
    | { action: 'unlink'; tabId: string }
    | { action: 'switch'; tabId: string }
    | { action: 'relink'; tabId: string; evictSessionId?: string }
    | { action: 'new-tab' };

export function decideWatchRouting(
    sessionId: string,
    tabs: WatchTabLike[],
    activeTabId: string,
    isLive: (id: string) => boolean,
): WatchRouting {
    const matching = tabs.find((t) => t.linkedSessionId === sessionId);
    if (matching) {
        return matching.id === activeTabId
            ? { action: 'unlink', tabId: matching.id }
            : { action: 'switch', tabId: matching.id };
    }

    const activeTab = tabs.find((t) => t.id === activeTabId);
    const activeLink = activeTab?.linkedSessionId;
    const activeLinkIsStale = !!activeLink && !isLive(activeLink);
    if (activeTab && (!activeLink || activeLinkIsStale)) {
        return {
            action: 'relink',
            tabId: activeTab.id,
            evictSessionId: activeLinkIsStale ? activeLink : undefined,
        };
    }

    return { action: 'new-tab' };
}
