/**
 * Pure state machine for the TRANSIENT states of an AI `connect` request card.
 *
 * Mirrors `autoExecReducer` (same keying, same per-tab scoping, same
 * reference-stability rules) but is deliberately smaller: a connect request's
 * FINAL outcome (opened / failed / declined / refused) is not kept here at all —
 * every outcome produces a machine envelope that is appended to the transcript
 * (`Terminal Connected (…)`, `Connection Failed (…)`, …), and the card derives
 * its terminal state from that envelope. Only the states that exist BEFORE an
 * envelope is written live in this reducer:
 *
 *   evaluate → asking | settled      (settled = outcome already in the transcript)
 *   schedule → scheduled             (auto-open countdown ticking)
 *   cancelSchedule → asking          (user cancelled the countdown → manual buttons)
 *   open → opening                   (openAndWatch in flight)
 *   dialog → dialog                  (waiting on the connection dialog)
 *   settle → settled
 *
 * Keying: `blockKey = "${messageIndex}:connect:${key}"` where `key` is the
 * request's `connectRequestKey`.
 */

import type { GateDecision, ResolvedConnect } from './aiConnectRequest';

export type ConnectStatus = 'asking' | 'scheduled' | 'opening' | 'dialog' | 'settled';

export interface ConnectBlock {
    /** The request key (`connectRequestKey`) — what the envelopes echo. */
    readonly key: string;
    readonly resolved?: ResolvedConnect;
    readonly decision?: GateDecision;
    readonly status: ConnectStatus;
    /** Epoch-ms deadline for a `scheduled` auto-open (drives the countdown). */
    readonly runAt?: number;
    /** True once an auto-open fired from the countdown (→ "Opened automatically" badge). */
    readonly autoOpened?: boolean;
}

export type ConnectState = ReadonlyMap<string, ReadonlyMap<string, ConnectBlock>>;

export type ConnectAction =
    /** Record a freshly evaluated block. `ask`/`auto` → asking; everything else → settled. */
    | { type: 'evaluate'; tabId: string; blockKey: string; key: string; resolved?: ResolvedConnect; decision: GateDecision }
    | { type: 'schedule'; tabId: string; blockKey: string; runAt: number }
    | { type: 'cancelSchedule'; tabId: string; blockKey: string }
    /** The open was fired (manually, or by the countdown when `auto` is true). */
    | { type: 'open'; tabId: string; blockKey: string; auto?: boolean }
    | { type: 'dialog'; tabId: string; blockKey: string }
    | { type: 'settle'; tabId: string; blockKey: string }
    | { type: 'clearTab'; tabId: string }
    | { type: 'prune'; liveTabIds: ReadonlySet<string> }
    | { type: 'resetAll' };

export const emptyConnectState: ConnectState = new Map();

type MutableState = Map<string, Map<string, ConnectBlock>>;

function cloneOuter(state: ConnectState): MutableState {
    const next: MutableState = new Map();
    for (const [tabId, blocks] of state) next.set(tabId, blocks as Map<string, ConnectBlock>);
    return next;
}

function sameBlocks(a: ReadonlyMap<string, ConnectBlock>, b: ReadonlyMap<string, ConnectBlock>): boolean {
    if (a.size !== b.size) return false;
    for (const [k, v] of a) if (b.get(k) !== v) return false;
    return true;
}

function withTab(
    state: ConnectState,
    tabId: string,
    mutate: (blocks: Map<string, ConnectBlock>) => Map<string, ConnectBlock> | null,
): ConnectState {
    const current = state.get(tabId);
    const draft = new Map<string, ConnectBlock>(current ?? []);
    const result = mutate(draft);
    if (result === null || result.size === 0) {
        if (!current) return state;
        const next = cloneOuter(state);
        next.delete(tabId);
        return next;
    }
    if (current && sameBlocks(current, result)) return state;
    const next = cloneOuter(state);
    next.set(tabId, result);
    return next;
}

export function connectRequestReducer(state: ConnectState, action: ConnectAction): ConnectState {
    switch (action.type) {
        case 'evaluate':
            return withTab(state, action.tabId, (blocks) => {
                if (blocks.has(action.blockKey)) return blocks; // double-evaluate guard
                const status: ConnectStatus =
                    action.decision.action === 'ask' || action.decision.action === 'auto' ? 'asking' : 'settled';
                blocks.set(action.blockKey, { key: action.key, resolved: action.resolved, decision: action.decision, status });
                return blocks;
            });

        case 'schedule':
            return withTab(state, action.tabId, (blocks) => {
                const b = blocks.get(action.blockKey);
                if (!b || b.status !== 'asking') return blocks;
                blocks.set(action.blockKey, { ...b, status: 'scheduled', runAt: action.runAt });
                return blocks;
            });

        case 'cancelSchedule':
            return withTab(state, action.tabId, (blocks) => {
                const b = blocks.get(action.blockKey);
                if (!b || b.status !== 'scheduled') return blocks;
                blocks.set(action.blockKey, { ...b, status: 'asking', runAt: undefined });
                return blocks;
            });

        case 'open':
            return withTab(state, action.tabId, (blocks) => {
                const b = blocks.get(action.blockKey);
                if (!b || b.status === 'opening' || b.status === 'settled') return blocks;
                blocks.set(action.blockKey, { ...b, status: 'opening', runAt: undefined, autoOpened: !!action.auto });
                return blocks;
            });

        case 'dialog':
            return withTab(state, action.tabId, (blocks) => {
                const b = blocks.get(action.blockKey);
                if (!b || b.status !== 'asking') return blocks;
                blocks.set(action.blockKey, { ...b, status: 'dialog', runAt: undefined });
                return blocks;
            });

        case 'settle':
            return withTab(state, action.tabId, (blocks) => {
                const b = blocks.get(action.blockKey);
                if (!b || b.status === 'settled') return blocks;
                blocks.set(action.blockKey, { ...b, status: 'settled', runAt: undefined });
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
            return state.size === 0 ? state : emptyConnectState;

        default:
            return state;
    }
}

export function getConnectBlock(state: ConnectState, tabId: string, blockKey: string): ConnectBlock | undefined {
    return state.get(tabId)?.get(blockKey);
}

export function hasConnectBlock(state: ConnectState, tabId: string, blockKey: string): boolean {
    return state.get(tabId)?.has(blockKey) ?? false;
}

export function connectBlockKey(messageIndex: number, key: string): string {
    return `${messageIndex}:connect:${key}`;
}
