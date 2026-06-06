import { describe, it, expect } from 'vitest';
import {
    streamTimeoutMessage,
    STREAM_IDLE_TIMEOUT_MS,
    STREAM_HARD_CAP_MS,
} from './streamWatchdog';

describe('streamTimeoutMessage', () => {
    it('builds an idle-timeout note with the elapsed seconds', () => {
        const msg = streamTimeoutMessage('', STREAM_IDLE_TIMEOUT_MS, 'idle');
        expect(msg).toBe('Error: AI stream idle for 180s — request cancelled');
    });

    it('builds a hard-cap note distinct from the idle wording', () => {
        const msg = streamTimeoutMessage('', STREAM_HARD_CAP_MS, 'hardcap');
        expect(msg).toBe('Error: AI stream exceeded 600s limit — request cancelled');
    });

    it('preserves partial content above the error note', () => {
        const partial = 'Here is the start of the answer';
        const msg = streamTimeoutMessage(partial, STREAM_IDLE_TIMEOUT_MS, 'idle');
        expect(msg).toBe(`${partial}\n\n[Error: AI stream idle for 180s — request cancelled]`);
        expect(msg.startsWith(partial)).toBe(true);
    });

    it('does not wrap in brackets when there is no partial content', () => {
        const msg = streamTimeoutMessage('', STREAM_HARD_CAP_MS, 'hardcap');
        expect(msg).not.toContain('[');
    });

    it('keeps the hard cap meaningfully larger than the idle window', () => {
        // The hard cap only helps if it outlasts an idle gap; otherwise it would
        // pre-empt legitimately slow-but-alive streams.
        expect(STREAM_HARD_CAP_MS).toBeGreaterThan(STREAM_IDLE_TIMEOUT_MS);
    });
});
