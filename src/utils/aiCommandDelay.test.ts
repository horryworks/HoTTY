import { describe, it, expect } from 'vitest';
import { parseLeadingSleep, clampDelay, syntheticDelayMessage } from './aiCommandDelay';

describe('parseLeadingSleep', () => {
    it('parses a standalone sleep (seconds)', () => {
        expect(parseLeadingSleep('sleep 120')).toEqual({
            delayMs: 120_000,
            rest: '',
            rawSleep: 'sleep 120',
        });
    });

    it('splits a && chained command', () => {
        expect(parseLeadingSleep('sleep 120 && docker exec x')).toEqual({
            delayMs: 120_000,
            rest: 'docker exec x',
            rawSleep: 'sleep 120',
        });
    });

    it('splits a ; chained command', () => {
        expect(parseLeadingSleep('sleep 120 ; validate.php')).toEqual({
            delayMs: 120_000,
            rest: 'validate.php',
            rawSleep: 'sleep 120',
        });
    });

    it('splits a multi-line block whose first line is sleep', () => {
        expect(parseLeadingSleep('sleep 120\nvalidate.php')).toEqual({
            delayMs: 120_000,
            rest: 'validate.php',
            rawSleep: 'sleep 120',
        });
    });

    it('parses fractional seconds', () => {
        expect(parseLeadingSleep('sleep 1.5')).toMatchObject({ delayMs: 1500, rest: '' });
        expect(parseLeadingSleep('sleep .5')).toMatchObject({ delayMs: 500, rest: '' });
    });

    it('applies unit suffixes', () => {
        expect(parseLeadingSleep('sleep 2m')).toMatchObject({ delayMs: 120_000, rawSleep: 'sleep 2m' });
        expect(parseLeadingSleep('sleep 1h')).toMatchObject({ delayMs: 3_600_000 });
        expect(parseLeadingSleep('sleep 1d')).toMatchObject({ delayMs: 86_400_000 });
        expect(parseLeadingSleep('sleep 30s')).toMatchObject({ delayMs: 30_000 });
    });

    it('tolerates leading whitespace', () => {
        expect(parseLeadingSleep('  sleep 5')).toMatchObject({ delayMs: 5000, rest: '' });
    });

    it('parses only the FIRST of chained sleeps (single-level)', () => {
        expect(parseLeadingSleep('sleep 5 && sleep 3 && foo')).toEqual({
            delayMs: 5000,
            rest: 'sleep 3 && foo',
            rawSleep: 'sleep 5',
        });
    });

    it('treats sleep 0 as a zero delay (still a match)', () => {
        expect(parseLeadingSleep('sleep 0')).toEqual({ delayMs: 0, rest: '', rawSleep: 'sleep 0' });
    });

    it('normalises trailing whitespace and CRLF in the remainder', () => {
        expect(parseLeadingSleep('sleep 5 \r\nuptime')).toMatchObject({ delayMs: 5000, rest: 'uptime' });
    });

    it('returns null when there is no leading sleep', () => {
        expect(parseLeadingSleep('sleep')).toBeNull();
        expect(parseLeadingSleep('sleep abc')).toBeNull();
        expect(parseLeadingSleep('sleep5')).toBeNull();
        expect(parseLeadingSleep('echo hi && sleep 5')).toBeNull();
        expect(parseLeadingSleep('sleep_check 5')).toBeNull();
        expect(parseLeadingSleep('')).toBeNull();
    });

    it('is case-sensitive (strict coreutils fidelity)', () => {
        expect(parseLeadingSleep('SLEEP 5')).toBeNull();
    });
});

describe('clampDelay', () => {
    it('passes through when under the cap', () => {
        expect(clampDelay(120_000, 900)).toEqual({ delayMs: 120_000, wasClamped: false });
    });

    it('clamps when over the cap', () => {
        expect(clampDelay(3_600_000, 900)).toEqual({ delayMs: 900_000, wasClamped: true });
    });

    it('treats the exact cap as not clamped', () => {
        expect(clampDelay(900_000, 900)).toEqual({ delayMs: 900_000, wasClamped: false });
    });

    it('disables the cap when maxSecs is 0 or negative', () => {
        expect(clampDelay(86_400_000, 0)).toEqual({ delayMs: 86_400_000, wasClamped: false });
        expect(clampDelay(86_400_000, -1)).toEqual({ delayMs: 86_400_000, wasClamped: false });
    });
});

describe('syntheticDelayMessage', () => {
    it('reports the waited seconds for an uncapped delay', () => {
        expect(syntheticDelayMessage('sleep 10', 10_000, 10_000, false)).toBe(
            'Terminal Output (Command: sleep 10):\n[client-side delay complete: waited 10 seconds]',
        );
    });

    it('adds a cap note when the delay was clamped', () => {
        expect(syntheticDelayMessage('sleep 3600', 900_000, 3_600_000, true)).toBe(
            'Terminal Output (Command: sleep 3600):\n[client-side delay complete: waited 900 seconds (requested 3600s, capped at 900s)]',
        );
    });
});
