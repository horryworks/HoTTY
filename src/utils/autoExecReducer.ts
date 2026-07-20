/**
 * Pure state machine for AI-Chat command auto-execution tracking.
 *
 * This consolidates the five parallel per-tab refs the AIChatPane used to carry
 * (`autoExecProcessedByTabRef`, `autoExecutedByTabRef`, `declinedByTabRef`,
 * `decisionsByTabRef`, `classifyingByTabRef`) plus the `decisionsVersion`
 * re-render counter into ONE immutable structure so the auto-exec flow can be
 * unit-tested in isolation and driven from a `useReducer`.
 *
 * Keying: every block a model message proposes is identified by its
 * `blockKey = "${messageIndex}:${command}"`. That identity is only unique within
 * one conversation (message indices restart at 0 after "New chat"), so the state
 * is scoped per tab and cleared per tab on New chat / tab close.
 *
 * A single block advances through at most these display states:
 *   reserve       → classifying          (AI verdict in flight — "Checking safety…")
 *   decide        → classified           (verdict recorded; Run/Decline + verdict note)
 *   schedule      → scheduled            (safe verdict; auto-run countdown ticking)
 *   cancelSchedule→ classified           (user cancelled the countdown → manual again)
 *   execute       → executed             (auto-ran — "Auto-executed" badge, terminal)
 *   decline       → declined             (user chose "Don't Execute" — terminal)
 *   abort         → (removed)            (classification cancelled before it resolved)
 *
 * `scheduled` is the pre-execution grace window: a command the classifier judged
 * safe waits out a user-configurable countdown (`runAt`) before auto-running, so a
 * human can cancel it. `execute` fires when the countdown elapses; `cancelSchedule`
 * reverts it to `classified` (manual Run/Decline) if the user hits Cancel.
 *
 * `executed` and `declined` are terminal: a late `decide`/`execute`/`schedule` never
 * overrides them, which is what makes "decline wins the classify race" hold.
 * `decline` may also arrive for a block that was never reserved (ask-before-execute
 * mode declines a command the AI classifier never saw), so it creates the entry.
 */

import type { AutoExecDecision } from './aiCommandClassifier';

// Re-exported so reducer consumers get the verdict type without a second import.
export type { AutoExecDecision } from './aiCommandClassifier';

export type AutoExecStatus = 'classifying' | 'classified' | 'scheduled' | 'executed' | 'declined';

export interface AutoExecBlock {
    /** The command text this block tracks (the `command` half of the blockKey). */
    readonly command: string;
    readonly status: AutoExecStatus;
    /** The safety verdict, once classification has resolved. */
    readonly decision?: AutoExecDecision;
    /** Epoch-ms deadline at which a `scheduled` block auto-runs (drives the countdown). */
    readonly runAt?: number;
}

/** Per-tab (`tabId`) map of `blockKey` → block. */
export type AutoExecState = ReadonlyMap<string, ReadonlyMap<string, AutoExecBlock>>;

export type AutoExecAction =
    /** Reserve a block before its (async) classification starts. No-op if the
     *  block already exists — this is the double-classify guard. */
    | { type: 'reserve'; tabId: string; blockKey: string; command: string }
    /** Un-reserve a block whose classification was cancelled before it resolved. */
    | { type: 'abort'; tabId: string; blockKey: string }
    /** Record the resolved verdict. Advances classifying → classified; a
     *  terminal (executed/declined) block keeps its status but stores the verdict. */
    | { type: 'decide'; tabId: string; blockKey: string; decision: AutoExecDecision }
    /** Start the pre-execution countdown for a safe block (classified → scheduled). */
    | { type: 'schedule'; tabId: string; blockKey: string; runAt: number }
    /** Cancel a running countdown, reverting to manual (scheduled → classified). */
    | { type: 'cancelSchedule'; tabId: string; blockKey: string }
    /** Mark a block auto-executed. No-op if the block was already declined. */
    | { type: 'execute'; tabId: string; blockKey: string }
    /** Mark a block declined by the user. Terminal; creates the block if absent. */
    | { type: 'decline'; tabId: string; blockKey: string; command: string }
    /** Drop all tracking for one tab (New chat / tab close). */
    | { type: 'clearTab'; tabId: string }
    /** Drop tracking for every tab not in `liveTabIds` (closed-tab prune). */
    | { type: 'prune'; liveTabIds: ReadonlySet<string> }
    /** Drop all tracking (provider switch / explicit logout). */
    | { type: 'resetAll' };

/** The initial (empty) state. */
export const emptyAutoExecState: AutoExecState = new Map();

// ── Internal helpers ─────────────────────────────────────────────────────────

type MutableState = Map<string, Map<string, AutoExecBlock>>;

/** Shallow-clone the outer map (inner tab maps are shared until replaced). */
function cloneOuter(state: AutoExecState): MutableState {
    const next: MutableState = new Map();
    for (const [tabId, blocks] of state) next.set(tabId, blocks as Map<string, AutoExecBlock>);
    return next;
}

/**
 * Apply `mutate` to a clone of one tab's block map. `mutate` returns the block
 * map to store, or `null` to delete the tab entry. If nothing changed (same
 * reference returned), the original `state` reference is returned so React can
 * bail out of a re-render.
 */
function withTab(
    state: AutoExecState,
    tabId: string,
    mutate: (blocks: Map<string, AutoExecBlock>) => Map<string, AutoExecBlock> | null,
): AutoExecState {
    const current = state.get(tabId);
    const draft = new Map<string, AutoExecBlock>(current ?? []);
    const result = mutate(draft);
    // A null result — or an empty block map — means the tab should not exist
    // (no action ever keeps an empty tab around).
    if (result === null || result.size === 0) {
        if (!current) return state; // already absent → no-op
        const next = cloneOuter(state);
        next.delete(tabId);
        return next;
    }
    // Structurally unchanged (mutate returned the clone with no edits) → keep the
    // original reference so React can bail out of a re-render.
    if (current && sameBlocks(current, result)) return state;
    const next = cloneOuter(state);
    next.set(tabId, result);
    return next;
}

/** Shallow structural equality of two block maps (keys + block references). */
function sameBlocks(a: ReadonlyMap<string, AutoExecBlock>, b: ReadonlyMap<string, AutoExecBlock>): boolean {
    if (a.size !== b.size) return false;
    for (const [k, v] of a) if (b.get(k) !== v) return false;
    return true;
}

// ── Reducer ──────────────────────────────────────────────────────────────────

export function autoExecReducer(state: AutoExecState, action: AutoExecAction): AutoExecState {
    switch (action.type) {
        case 'reserve':
            return withTab(state, action.tabId, (blocks) => {
                if (blocks.has(action.blockKey)) return blocks; // already reserved → no-op
                blocks.set(action.blockKey, { command: action.command, status: 'classifying' });
                return blocks;
            });

        case 'abort':
            return withTab(state, action.tabId, (blocks) => {
                const block = blocks.get(action.blockKey);
                // Only un-reserve a block still awaiting its verdict; never clobber a
                // block that already reached a terminal (executed/declined) state.
                if (!block || block.status !== 'classifying') return blocks;
                blocks.delete(action.blockKey);
                return blocks.size === 0 ? null : blocks;
            });

        case 'decide':
            return withTab(state, action.tabId, (blocks) => {
                const block = blocks.get(action.blockKey);
                if (!block) return blocks; // decide without a reservation → ignore
                const status: AutoExecStatus = block.status === 'classifying' ? 'classified' : block.status;
                blocks.set(action.blockKey, { ...block, status, decision: action.decision });
                return blocks;
            });

        case 'schedule':
            return withTab(state, action.tabId, (blocks) => {
                const block = blocks.get(action.blockKey);
                // Only a freshly-classified block enters the countdown; never resurrect
                // a terminal (executed/declined) or re-arm one already scheduled.
                if (!block || block.status !== 'classified') return blocks;
                blocks.set(action.blockKey, { ...block, status: 'scheduled', runAt: action.runAt });
                return blocks;
            });

        case 'cancelSchedule':
            return withTab(state, action.tabId, (blocks) => {
                const block = blocks.get(action.blockKey);
                if (!block || block.status !== 'scheduled') return blocks;
                blocks.set(action.blockKey, { ...block, status: 'classified', runAt: undefined });
                return blocks;
            });

        case 'execute':
            return withTab(state, action.tabId, (blocks) => {
                const block = blocks.get(action.blockKey);
                // Execute follows decide/schedule; a declined block must not flip to executed.
                if (!block || block.status === 'declined' || block.status === 'executed') return blocks;
                blocks.set(action.blockKey, { ...block, status: 'executed', runAt: undefined });
                return blocks;
            });

        case 'decline':
            return withTab(state, action.tabId, (blocks) => {
                const block = blocks.get(action.blockKey);
                if (block?.status === 'declined') return blocks; // idempotent
                blocks.set(action.blockKey, {
                    command: block?.command ?? action.command,
                    status: 'declined',
                    decision: block?.decision,
                });
                return blocks;
            });

        case 'clearTab':
            return withTab(state, action.tabId, () => null);

        case 'prune': {
            let changed = false;
            const next = cloneOuter(state);
            for (const tabId of next.keys()) {
                if (!action.liveTabIds.has(tabId)) {
                    next.delete(tabId);
                    changed = true;
                }
            }
            return changed ? next : state;
        }

        case 'resetAll':
            return state.size === 0 ? state : emptyAutoExecState;

        default:
            return state;
    }
}

// ── Selectors ────────────────────────────────────────────────────────────────

/** True if a block has already been reserved (drives the reserve dedup guard). */
export function hasBlock(state: AutoExecState, tabId: string, blockKey: string): boolean {
    return state.get(tabId)?.has(blockKey) ?? false;
}

export function getBlock(state: AutoExecState, tabId: string, blockKey: string): AutoExecBlock | undefined {
    return state.get(tabId)?.get(blockKey);
}

export interface MessageDecorations {
    /** Commands that auto-executed → "Auto-executed" badge. */
    autoExecuted: Set<string>;
    /** Commands the user declined → "Declined" badge. */
    declined: Set<string>;
    /** Commands whose classification is in flight → "Checking safety…". */
    classifying: Set<string>;
    /** Command → auto-run deadline (epoch ms) for a block in its countdown window. */
    scheduled: Map<string, number>;
    /** Command → resolved verdict (for the verdict note; declined/scheduled blocks
     *  omitted because the UI shows a badge / countdown for those instead). */
    verdicts: Map<string, AutoExecDecision>;
}

/**
 * Collect the render decorations for one model message. `commands` is the list of
 * execute-block commands parsed from the message (in order); `messageIndex` is
 * its index in the tab's transcript. Mirrors the per-message ref-reading loop the
 * AIChatPane used to run inline.
 */
export function collectMessageDecorations(
    state: AutoExecState,
    tabId: string,
    messageIndex: number,
    commands: string[],
): MessageDecorations {
    const decorations: MessageDecorations = {
        autoExecuted: new Set(),
        declined: new Set(),
        classifying: new Set(),
        scheduled: new Map(),
        verdicts: new Map(),
    };
    const blocks = state.get(tabId);
    if (!blocks) return decorations;
    for (const command of commands) {
        const block = blocks.get(`${messageIndex}:${command}`);
        if (!block) continue;
        switch (block.status) {
            case 'declined':
                decorations.declined.add(command);
                break;
            case 'executed':
                decorations.autoExecuted.add(command);
                if (block.decision) decorations.verdicts.set(command, block.decision);
                break;
            case 'classifying':
                decorations.classifying.add(command);
                break;
            case 'scheduled':
                if (block.runAt !== undefined) decorations.scheduled.set(command, block.runAt);
                break;
            case 'classified':
                if (block.decision) decorations.verdicts.set(command, block.decision);
                break;
        }
    }
    return decorations;
}
