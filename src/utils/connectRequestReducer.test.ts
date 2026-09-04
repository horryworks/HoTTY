import { describe, it, expect } from 'vitest';
import {
    connectRequestReducer,
    emptyConnectState,
    getConnectBlock,
    hasConnectBlock,
    connectBlockKey,
    type ConnectState,
} from './connectRequestReducer';
import type { GateDecision } from './aiConnectRequest';

const ASK: GateDecision = { action: 'ask', variant: 'open', reuse: false };
const AUTO: GateDecision = { action: 'auto' };
const REFUSE: GateDecision = { action: 'refuse', reason: 'cap' };

const K = connectBlockKey(3, 'ssh:alice@192.0.2.10:22');

function evaluated(decision: GateDecision = ASK, state: ConnectState = emptyConnectState): ConnectState {
    return connectRequestReducer(state, { type: 'evaluate', tabId: 't1', blockKey: K, key: 'ssh:alice@192.0.2.10:22', decision });
}

describe('connectRequestReducer', () => {
    it('builds the block key from the message index and request key', () => {
        expect(K).toBe('3:connect:ssh:alice@192.0.2.10:22');
    });

    it('evaluate → asking for ask/auto, settled for everything else, and is idempotent', () => {
        const s = evaluated(ASK);
        expect(getConnectBlock(s, 't1', K)?.status).toBe('asking');
        expect(hasConnectBlock(s, 't1', K)).toBe(true);
        expect(evaluated(AUTO)).not.toBe(emptyConnectState);
        expect(getConnectBlock(evaluated(AUTO), 't1', K)?.status).toBe('asking');
        expect(getConnectBlock(evaluated(REFUSE), 't1', K)?.status).toBe('settled');
        // A second evaluate for the same block is a no-op (reference-stable).
        expect(evaluated(REFUSE, s)).toBe(s);
    });

    it('schedule / cancelSchedule round-trip only from asking', () => {
        const s1 = connectRequestReducer(evaluated(AUTO), { type: 'schedule', tabId: 't1', blockKey: K, runAt: 123 });
        expect(getConnectBlock(s1, 't1', K)).toMatchObject({ status: 'scheduled', runAt: 123 });
        const s2 = connectRequestReducer(s1, { type: 'cancelSchedule', tabId: 't1', blockKey: K });
        expect(getConnectBlock(s2, 't1', K)).toMatchObject({ status: 'asking', runAt: undefined });
        // Cannot schedule a settled block.
        const settled = evaluated(REFUSE);
        expect(connectRequestReducer(settled, { type: 'schedule', tabId: 't1', blockKey: K, runAt: 1 })).toBe(settled);
    });

    it('open records whether the countdown fired it, and never reopens a settled block', () => {
        const manual = connectRequestReducer(evaluated(), { type: 'open', tabId: 't1', blockKey: K });
        expect(getConnectBlock(manual, 't1', K)).toMatchObject({ status: 'opening', autoOpened: false });
        const sched = connectRequestReducer(evaluated(AUTO), { type: 'schedule', tabId: 't1', blockKey: K, runAt: 5 });
        const auto = connectRequestReducer(sched, { type: 'open', tabId: 't1', blockKey: K, auto: true });
        expect(getConnectBlock(auto, 't1', K)).toMatchObject({ status: 'opening', autoOpened: true, runAt: undefined });
        const settled = connectRequestReducer(auto, { type: 'settle', tabId: 't1', blockKey: K });
        expect(getConnectBlock(settled, 't1', K)?.status).toBe('settled');
        expect(connectRequestReducer(settled, { type: 'open', tabId: 't1', blockKey: K })).toBe(settled);
    });

    it('dialog only from asking; settle from anything but settled', () => {
        const d = connectRequestReducer(evaluated(), { type: 'dialog', tabId: 't1', blockKey: K });
        expect(getConnectBlock(d, 't1', K)?.status).toBe('dialog');
        expect(connectRequestReducer(d, { type: 'dialog', tabId: 't1', blockKey: K })).toBe(d);
        const s = connectRequestReducer(d, { type: 'settle', tabId: 't1', blockKey: K });
        expect(getConnectBlock(s, 't1', K)?.status).toBe('settled');
        expect(connectRequestReducer(s, { type: 'settle', tabId: 't1', blockKey: K })).toBe(s);
    });

    it('clearTab, prune and resetAll drop tracking', () => {
        const two = connectRequestReducer(evaluated(), { type: 'evaluate', tabId: 't2', blockKey: K, key: 'k', decision: ASK });
        expect(connectRequestReducer(two, { type: 'clearTab', tabId: 't1' }).has('t1')).toBe(false);
        const pruned = connectRequestReducer(two, { type: 'prune', liveTabIds: new Set(['t2']) });
        expect(pruned.has('t1')).toBe(false);
        expect(pruned.has('t2')).toBe(true);
        expect(connectRequestReducer(two, { type: 'prune', liveTabIds: new Set(['t1', 't2']) })).toBe(two);
        expect(connectRequestReducer(two, { type: 'resetAll' })).toBe(emptyConnectState);
        expect(connectRequestReducer(emptyConnectState, { type: 'resetAll' })).toBe(emptyConnectState);
    });

    it('ignores actions for unknown blocks without allocating', () => {
        expect(connectRequestReducer(emptyConnectState, { type: 'open', tabId: 't1', blockKey: K })).toBe(emptyConnectState);
        expect(connectRequestReducer(emptyConnectState, { type: 'clearTab', tabId: 't1' })).toBe(emptyConnectState);
    });
});
