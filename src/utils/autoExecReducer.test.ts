import { describe, it, expect } from 'vitest';
import {
    autoExecReducer,
    emptyAutoExecState,
    hasBlock,
    getBlock,
    collectMessageDecorations,
    type AutoExecState,
    type AutoExecDecision,
} from './autoExecReducer';
import type { AutoExecAction } from './autoExecReducer';

// Small helpers to keep the tests terse.
const decision = (over: Partial<AutoExecDecision> = {}): AutoExecDecision => ({
    autoExec: true,
    reason: 'read-only',
    source: 'ai',
    confidence: 0.95,
    ...over,
});

/** Apply a sequence of actions to the empty state. */
function run(...actions: AutoExecAction[]): AutoExecState {
    return actions.reduce(autoExecReducer, emptyAutoExecState);
}

const TAB = 't1';
const BK = '1:display version';

describe('autoExecReducer — reserve', () => {
    it('creates a classifying block', () => {
        const s = run({ type: 'reserve', tabId: TAB, blockKey: BK, command: 'display version' });
        expect(getBlock(s, TAB, BK)).toEqual({ command: 'display version', status: 'classifying' });
        expect(hasBlock(s, TAB, BK)).toBe(true);
    });

    it('is a no-op (same reference) when the block is already reserved', () => {
        const s1 = run({ type: 'reserve', tabId: TAB, blockKey: BK, command: 'display version' });
        const s2 = autoExecReducer(s1, { type: 'reserve', tabId: TAB, blockKey: BK, command: 'display version' });
        expect(s2).toBe(s1); // reference stability → the dedup guard
    });

    it('does not mutate the previous state (immutability)', () => {
        const s1 = run({ type: 'reserve', tabId: TAB, blockKey: BK, command: 'display version' });
        autoExecReducer(s1, { type: 'reserve', tabId: TAB, blockKey: '2:show ip', command: 'show ip' });
        // s1 must be untouched.
        expect(hasBlock(s1, TAB, '2:show ip')).toBe(false);
        expect([...(s1.get(TAB) ?? [])].length).toBe(1);
    });
});

describe('autoExecReducer — abort', () => {
    it('removes a classifying block and drops the empty tab', () => {
        const s = run(
            { type: 'reserve', tabId: TAB, blockKey: BK, command: 'display version' },
            { type: 'abort', tabId: TAB, blockKey: BK },
        );
        expect(hasBlock(s, TAB, BK)).toBe(false);
        expect(s.has(TAB)).toBe(false); // last block removed → tab pruned
    });

    it('keeps sibling blocks when one is aborted', () => {
        const s = run(
            { type: 'reserve', tabId: TAB, blockKey: BK, command: 'display version' },
            { type: 'reserve', tabId: TAB, blockKey: '2:show ip', command: 'show ip' },
            { type: 'abort', tabId: TAB, blockKey: BK },
        );
        expect(hasBlock(s, TAB, BK)).toBe(false);
        expect(hasBlock(s, TAB, '2:show ip')).toBe(true);
    });

    it('never clobbers an executed block', () => {
        const s = run(
            { type: 'reserve', tabId: TAB, blockKey: BK, command: 'display version' },
            { type: 'decide', tabId: TAB, blockKey: BK, decision: decision() },
            { type: 'execute', tabId: TAB, blockKey: BK },
            { type: 'abort', tabId: TAB, blockKey: BK },
        );
        expect(getBlock(s, TAB, BK)?.status).toBe('executed');
    });

    it('is a no-op when the block does not exist', () => {
        const s1 = run({ type: 'reserve', tabId: TAB, blockKey: BK, command: 'display version' });
        const s2 = autoExecReducer(s1, { type: 'abort', tabId: TAB, blockKey: 'nope' });
        expect(s2).toBe(s1);
    });
});

describe('autoExecReducer — decide', () => {
    it('advances classifying → classified and stores the verdict', () => {
        const d = decision({ reason: 'just reads' });
        const s = run(
            { type: 'reserve', tabId: TAB, blockKey: BK, command: 'display version' },
            { type: 'decide', tabId: TAB, blockKey: BK, decision: d },
        );
        expect(getBlock(s, TAB, BK)).toEqual({ command: 'display version', status: 'classified', decision: d });
    });

    it('ignores a verdict for a block that was never reserved', () => {
        const s1 = emptyAutoExecState;
        const s2 = autoExecReducer(s1, { type: 'decide', tabId: TAB, blockKey: BK, decision: decision() });
        expect(s2).toBe(s1);
    });

    it('stores the verdict but keeps a declined block declined (decline wins the race)', () => {
        const d = decision({ autoExec: true, reason: 'reads' });
        const s = run(
            { type: 'reserve', tabId: TAB, blockKey: BK, command: 'display version' },
            { type: 'decline', tabId: TAB, blockKey: BK, command: 'display version' },
            { type: 'decide', tabId: TAB, blockKey: BK, decision: d },
        );
        expect(getBlock(s, TAB, BK)?.status).toBe('declined');
        expect(getBlock(s, TAB, BK)?.decision).toEqual(d);
    });
});

describe('autoExecReducer — execute', () => {
    it('marks a classified block executed', () => {
        const d = decision();
        const s = run(
            { type: 'reserve', tabId: TAB, blockKey: BK, command: 'display version' },
            { type: 'decide', tabId: TAB, blockKey: BK, decision: d },
            { type: 'execute', tabId: TAB, blockKey: BK },
        );
        expect(getBlock(s, TAB, BK)).toEqual({ command: 'display version', status: 'executed', decision: d });
    });

    it('never flips a declined block to executed', () => {
        const s = run(
            { type: 'reserve', tabId: TAB, blockKey: BK, command: 'display version' },
            { type: 'decline', tabId: TAB, blockKey: BK, command: 'display version' },
            { type: 'execute', tabId: TAB, blockKey: BK },
        );
        expect(getBlock(s, TAB, BK)?.status).toBe('declined');
    });

    it('is a no-op when the block does not exist', () => {
        const s1 = emptyAutoExecState;
        const s2 = autoExecReducer(s1, { type: 'execute', tabId: TAB, blockKey: BK });
        expect(s2).toBe(s1);
    });

    it('is a no-op (same reference) when already executed', () => {
        const s1 = run(
            { type: 'reserve', tabId: TAB, blockKey: BK, command: 'display version' },
            { type: 'decide', tabId: TAB, blockKey: BK, decision: decision() },
            { type: 'execute', tabId: TAB, blockKey: BK },
        );
        const s2 = autoExecReducer(s1, { type: 'execute', tabId: TAB, blockKey: BK });
        expect(s2).toBe(s1);
    });
});

describe('autoExecReducer — schedule / cancelSchedule', () => {
    it('advances classified → scheduled with runAt', () => {
        const s = run(
            { type: 'reserve', tabId: TAB, blockKey: BK, command: 'display version' },
            { type: 'decide', tabId: TAB, blockKey: BK, decision: decision() },
            { type: 'schedule', tabId: TAB, blockKey: BK, runAt: 1000 },
        );
        expect(getBlock(s, TAB, BK)?.status).toBe('scheduled');
        expect(getBlock(s, TAB, BK)?.runAt).toBe(1000);
    });

    it('does not schedule a block still classifying', () => {
        const s1 = run({ type: 'reserve', tabId: TAB, blockKey: BK, command: 'display version' });
        const s2 = autoExecReducer(s1, { type: 'schedule', tabId: TAB, blockKey: BK, runAt: 1000 });
        expect(s2).toBe(s1);
        expect(getBlock(s2, TAB, BK)?.status).toBe('classifying');
    });

    it('does not schedule a declined block', () => {
        const s = run(
            { type: 'decline', tabId: TAB, blockKey: BK, command: 'display version' },
            { type: 'schedule', tabId: TAB, blockKey: BK, runAt: 1000 },
        );
        expect(getBlock(s, TAB, BK)?.status).toBe('declined');
    });

    it('cancelSchedule reverts scheduled → classified, clears runAt, keeps the verdict', () => {
        const d = decision();
        const s = run(
            { type: 'reserve', tabId: TAB, blockKey: BK, command: 'display version' },
            { type: 'decide', tabId: TAB, blockKey: BK, decision: d },
            { type: 'schedule', tabId: TAB, blockKey: BK, runAt: 1000 },
            { type: 'cancelSchedule', tabId: TAB, blockKey: BK },
        );
        expect(getBlock(s, TAB, BK)?.status).toBe('classified');
        expect(getBlock(s, TAB, BK)?.runAt).toBeUndefined();
        expect(getBlock(s, TAB, BK)?.decision).toEqual(d);
    });

    it('cancelSchedule is a no-op when the block is not scheduled', () => {
        const s1 = run(
            { type: 'reserve', tabId: TAB, blockKey: BK, command: 'display version' },
            { type: 'decide', tabId: TAB, blockKey: BK, decision: decision() },
        );
        const s2 = autoExecReducer(s1, { type: 'cancelSchedule', tabId: TAB, blockKey: BK });
        expect(s2).toBe(s1);
    });

    it('execute fires a scheduled block → executed and clears runAt', () => {
        const s = run(
            { type: 'reserve', tabId: TAB, blockKey: BK, command: 'display version' },
            { type: 'decide', tabId: TAB, blockKey: BK, decision: decision() },
            { type: 'schedule', tabId: TAB, blockKey: BK, runAt: 1000 },
            { type: 'execute', tabId: TAB, blockKey: BK },
        );
        expect(getBlock(s, TAB, BK)?.status).toBe('executed');
        expect(getBlock(s, TAB, BK)?.runAt).toBeUndefined();
    });

    it('decline on a scheduled block wins (→ declined)', () => {
        const s = run(
            { type: 'reserve', tabId: TAB, blockKey: BK, command: 'display version' },
            { type: 'decide', tabId: TAB, blockKey: BK, decision: decision() },
            { type: 'schedule', tabId: TAB, blockKey: BK, runAt: 1000 },
            { type: 'decline', tabId: TAB, blockKey: BK, command: 'display version' },
        );
        expect(getBlock(s, TAB, BK)?.status).toBe('declined');
    });
});

describe('autoExecReducer — decline', () => {
    it('creates a declined block for a never-reserved command (ask-mode decline)', () => {
        const s = run({ type: 'decline', tabId: TAB, blockKey: BK, command: 'display version' });
        expect(getBlock(s, TAB, BK)).toEqual({ command: 'display version', status: 'declined', decision: undefined });
    });

    it('overwrites a classifying block to declined and preserves an existing verdict', () => {
        const d = decision();
        const s = run(
            { type: 'reserve', tabId: TAB, blockKey: BK, command: 'display version' },
            { type: 'decide', tabId: TAB, blockKey: BK, decision: d },
            { type: 'decline', tabId: TAB, blockKey: BK, command: 'display version' },
        );
        expect(getBlock(s, TAB, BK)?.status).toBe('declined');
        expect(getBlock(s, TAB, BK)?.decision).toEqual(d);
    });

    it('is idempotent (same reference on a second decline)', () => {
        const s1 = run({ type: 'decline', tabId: TAB, blockKey: BK, command: 'display version' });
        const s2 = autoExecReducer(s1, { type: 'decline', tabId: TAB, blockKey: BK, command: 'display version' });
        expect(s2).toBe(s1);
    });
});

describe('autoExecReducer — clearTab / prune / resetAll', () => {
    it('clearTab drops one tab and leaves others', () => {
        const s = run(
            { type: 'reserve', tabId: 't1', blockKey: BK, command: 'display version' },
            { type: 'reserve', tabId: 't2', blockKey: BK, command: 'display version' },
            { type: 'clearTab', tabId: 't1' },
        );
        expect(s.has('t1')).toBe(false);
        expect(s.has('t2')).toBe(true);
    });

    it('clearTab is a no-op (same reference) for an absent tab', () => {
        const s1 = run({ type: 'reserve', tabId: 't1', blockKey: BK, command: 'display version' });
        const s2 = autoExecReducer(s1, { type: 'clearTab', tabId: 'gone' });
        expect(s2).toBe(s1);
    });

    it('prune keeps only live tabs', () => {
        const s = run(
            { type: 'reserve', tabId: 't1', blockKey: BK, command: 'display version' },
            { type: 'reserve', tabId: 't2', blockKey: BK, command: 'display version' },
            { type: 'reserve', tabId: 't3', blockKey: BK, command: 'display version' },
            { type: 'prune', liveTabIds: new Set(['t1', 't3']) },
        );
        expect([...s.keys()].sort()).toEqual(['t1', 't3']);
    });

    it('prune returns the same reference when nothing is dropped', () => {
        const s1 = run(
            { type: 'reserve', tabId: 't1', blockKey: BK, command: 'display version' },
            { type: 'reserve', tabId: 't2', blockKey: BK, command: 'display version' },
        );
        const s2 = autoExecReducer(s1, { type: 'prune', liveTabIds: new Set(['t1', 't2', 't3']) });
        expect(s2).toBe(s1);
    });

    it('resetAll empties the state', () => {
        const s = run(
            { type: 'reserve', tabId: 't1', blockKey: BK, command: 'display version' },
            { type: 'resetAll' },
        );
        expect(s.size).toBe(0);
    });

    it('resetAll on an already-empty state returns the same reference', () => {
        const s2 = autoExecReducer(emptyAutoExecState, { type: 'resetAll' });
        expect(s2).toBe(emptyAutoExecState);
    });
});

describe('autoExecReducer — multi-tab isolation', () => {
    it('the same blockKey in two tabs is tracked independently', () => {
        const s = run(
            { type: 'reserve', tabId: 't1', blockKey: BK, command: 'display version' },
            { type: 'decline', tabId: 't1', blockKey: BK, command: 'display version' },
            { type: 'reserve', tabId: 't2', blockKey: BK, command: 'display version' },
            { type: 'decide', tabId: 't2', blockKey: BK, decision: decision() },
            { type: 'execute', tabId: 't2', blockKey: BK },
        );
        expect(getBlock(s, 't1', BK)?.status).toBe('declined');
        expect(getBlock(s, 't2', BK)?.status).toBe('executed');
    });
});

describe('collectMessageDecorations', () => {
    it('returns empty sets for an unknown tab', () => {
        const d = collectMessageDecorations(emptyAutoExecState, 'nope', 1, ['display version']);
        expect(d.autoExecuted.size).toBe(0);
        expect(d.declined.size).toBe(0);
        expect(d.classifying.size).toBe(0);
        expect(d.verdicts.size).toBe(0);
    });

    it('maps each status to the right decoration set for message index 1', () => {
        const dExec = decision({ reason: 'read-only' });
        const dClassified = decision({ autoExec: false, reason: 'modifies config', source: 'ai' });
        const s = run(
            // executed
            { type: 'reserve', tabId: TAB, blockKey: '1:display version', command: 'display version' },
            { type: 'decide', tabId: TAB, blockKey: '1:display version', decision: dExec },
            { type: 'execute', tabId: TAB, blockKey: '1:display version' },
            // classified but not run
            { type: 'reserve', tabId: TAB, blockKey: '1:save config', command: 'save config' },
            { type: 'decide', tabId: TAB, blockKey: '1:save config', decision: dClassified },
            // classifying in flight
            { type: 'reserve', tabId: TAB, blockKey: '1:show clock', command: 'show clock' },
            // declined
            { type: 'decline', tabId: TAB, blockKey: '1:reboot', command: 'reboot' },
        );

        const d = collectMessageDecorations(s, TAB, 1, [
            'display version', 'save config', 'show clock', 'reboot',
        ]);
        expect([...d.autoExecuted]).toEqual(['display version']);
        expect([...d.declined]).toEqual(['reboot']);
        expect([...d.classifying]).toEqual(['show clock']);
        // Verdicts include the executed block's verdict and the classified one, but
        // NOT the declined block (the UI hides the note for declined commands).
        expect(d.verdicts.get('display version')).toEqual(dExec);
        expect(d.verdicts.get('save config')).toEqual(dClassified);
        expect(d.verdicts.has('reboot')).toBe(false);
    });

    it('surfaces a scheduled block as scheduled (runAt), not as a verdict', () => {
        const s = run(
            { type: 'reserve', tabId: TAB, blockKey: '1:display version', command: 'display version' },
            { type: 'decide', tabId: TAB, blockKey: '1:display version', decision: decision() },
            { type: 'schedule', tabId: TAB, blockKey: '1:display version', runAt: 4242 },
        );
        const d = collectMessageDecorations(s, TAB, 1, ['display version']);
        expect(d.scheduled.get('display version')).toBe(4242);
        expect(d.verdicts.has('display version')).toBe(false);
        expect(d.autoExecuted.size).toBe(0);
    });

    it('scopes lookups to the given message index (blockKey collision across messages)', () => {
        const s = run(
            { type: 'reserve', tabId: TAB, blockKey: '0:display version', command: 'display version' },
            { type: 'decide', tabId: TAB, blockKey: '0:display version', decision: decision() },
            { type: 'execute', tabId: TAB, blockKey: '0:display version' },
        );
        // The same command in message index 2 has a different blockKey → no decoration.
        const d2 = collectMessageDecorations(s, TAB, 2, ['display version']);
        expect(d2.autoExecuted.size).toBe(0);
        // …but message index 0 still resolves.
        const d0 = collectMessageDecorations(s, TAB, 0, ['display version']);
        expect([...d0.autoExecuted]).toEqual(['display version']);
    });
});
