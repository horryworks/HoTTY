import { describe, it, expect, beforeEach } from 'vitest';
import { newRequestId, noteRequest, isStaleRequest, resetRequestTracker } from './aiRequestTracker';

describe('aiRequestTracker', () => {
    beforeEach(() => {
        resetRequestTracker();
    });

    it('hands out a fresh id for every send', () => {
        const a = newRequestId();
        const b = newRequestId();
        expect(a).toBeTruthy();
        expect(a).not.toBe(b);
    });

    it('treats the latest send of a conversation as current', () => {
        noteRequest('pane-1::tab-1', 'req-1');
        expect(isStaleRequest('pane-1::tab-1', 'req-1')).toBe(false);
    });

    it('marks a replaced send as stale once a newer one is noted', () => {
        noteRequest('pane-1::tab-1', 'req-1');
        noteRequest('pane-1::tab-1', 'req-2');
        expect(isStaleRequest('pane-1::tab-1', 'req-1')).toBe(true);
        expect(isStaleRequest('pane-1::tab-1', 'req-2')).toBe(false);
    });

    it('never treats an event without a request id as stale', () => {
        noteRequest('pane-1::tab-1', 'req-1');
        expect(isStaleRequest('pane-1::tab-1', undefined)).toBe(false);
        expect(isStaleRequest('pane-1::tab-1', '')).toBe(false);
    });

    it('never treats a conversation with no record as stale (send started in another window)', () => {
        expect(isStaleRequest('pane-9::tab-9', 'req-from-elsewhere')).toBe(false);
    });

    it('keeps conversations apart', () => {
        noteRequest('pane-1::tab-1', 'req-a');
        noteRequest('pane-1::tab-2', 'req-b');
        expect(isStaleRequest('pane-1::tab-1', 'req-a')).toBe(false);
        expect(isStaleRequest('pane-1::tab-2', 'req-b')).toBe(false);
        expect(isStaleRequest('pane-1::tab-1', 'req-b')).toBe(true);
    });

    it('forgets every send on reset', () => {
        noteRequest('pane-1::tab-1', 'req-1');
        noteRequest('pane-1::tab-1', 'req-2');
        resetRequestTracker();
        expect(isStaleRequest('pane-1::tab-1', 'req-1')).toBe(false);
    });
});
