import { describe, it, expect } from 'vitest';
import { evaluateWatchPoll, PROMPT_PATTERN, type WatchPollInput } from './aiCommandWatch';

// Sensible defaults: past the send window, fresh activity, timers not elapsed.
function input(overrides: Partial<WatchPollInput> = {}): WatchPollInput {
    return {
        newContent: 'some output',
        attemptsMs: 5000,
        sendWindowMs: 450,
        idleMs: 10_000,
        msSinceLastChange: 0,
        msSinceStart: 1000,
        safetyCapMs: 30 * 60 * 1000,
        ...overrides,
    };
}

describe('evaluateWatchPoll', () => {
    it('waits while still inside the send window, even if a prompt char is present', () => {
        expect(evaluateWatchPoll(input({ attemptsMs: 200, sendWindowMs: 450, newContent: 'x]' })))
            .toEqual({ action: 'wait' });
    });

    it('matches a trailing shell prompt for each supported char', () => {
        for (const tail of [']', '>', '#', '$']) {
            const r = evaluateWatchPoll(input({ newContent: `<hostname${tail}` }));
            expect(r, `tail=${tail}`).toEqual({ action: 'prompt', matchedAtEnd: true });
        }
    });

    it('matches a prompt with trailing whitespace', () => {
        expect(evaluateWatchPoll(input({ newContent: 'host] ' })))
            .toEqual({ action: 'prompt', matchedAtEnd: true });
    });

    it('reports matchedAtEnd=false when a prompt char appears mid-string', () => {
        // A ']' mid-buffer but the string does not END at a prompt -> no trailing match,
        // so it falls through to wait (no timer elapsed).
        const r = evaluateWatchPoll(input({ newContent: 'a]b c]d more text', msSinceLastChange: 0 }));
        expect(r).toEqual({ action: 'wait' });
    });

    it('does NOT treat an interactive [Y/N]: prompt as a shell prompt (run 1 regression)', () => {
        // Trailing ':' is not a prompt char; with idle elapsed this must idle-timeout.
        const r = evaluateWatchPoll(input({
            newContent: 'Warning: Continue? Please select [Y/N]:',
            msSinceLastChange: 10_000,
        }));
        expect(r).toEqual({ action: 'idle' });
    });

    it('idle-times-out when output exists but the buffer has gone quiet', () => {
        expect(evaluateWatchPoll(input({ newContent: 'partial output', msSinceLastChange: 10_000 })))
            .toEqual({ action: 'idle' });
    });

    it('idle-times-out with ZERO output (silent/hung device) — the fix', () => {
        expect(evaluateWatchPoll(input({ newContent: '', msSinceLastChange: 10_000 })))
            .toEqual({ action: 'idle' });
    });

    it('does not idle-time-out before idleMs elapses', () => {
        expect(evaluateWatchPoll(input({ newContent: '', msSinceLastChange: 9_999 })))
            .toEqual({ action: 'wait' });
    });

    it('never idle-times-out when idle is disabled (idleMs = 0)', () => {
        expect(evaluateWatchPoll(input({ idleMs: 0, newContent: '', msSinceLastChange: 10_000_000 })))
            .toEqual({ action: 'wait' });
    });

    it('falls back to the safety cap when idle is disabled and the cap elapses', () => {
        expect(evaluateWatchPoll(input({
            idleMs: 0,
            newContent: '',
            msSinceStart: 30 * 60 * 1000,
        }))).toEqual({ action: 'safety' });
    });

    it('prefers idle over safety when both timers have elapsed', () => {
        expect(evaluateWatchPoll(input({
            newContent: '',
            msSinceLastChange: 10_000,
            msSinceStart: 30 * 60 * 1000,
        }))).toEqual({ action: 'idle' });
    });

    it('waits when past the send window with no prompt and no timer elapsed', () => {
        expect(evaluateWatchPoll(input({ newContent: 'still working...', msSinceLastChange: 500 })))
            .toEqual({ action: 'wait' });
    });
});

describe('PROMPT_PATTERN', () => {
    it('matches recognized trailing prompts and rejects interactive / mid-line chars', () => {
        expect(PROMPT_PATTERN.test('host]')).toBe(true);
        expect(PROMPT_PATTERN.test('host>')).toBe(true);
        expect(PROMPT_PATTERN.test('host#  ')).toBe(true);
        expect(PROMPT_PATTERN.test('[Y/N]:')).toBe(false);
        expect(PROMPT_PATTERN.test('value]more')).toBe(false);
    });
});
