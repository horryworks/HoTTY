import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInteractiveFlow } from './useInteractiveFlow';
import type { PromptPattern } from '../types/appTypes';

let sessionDataCallback: ((sessionId: string, data: string) => void) | null = null;

vi.mock('../services/electronService', () => ({
    onSessionData: vi.fn((cb: (sessionId: string, data: string) => void) => {
        sessionDataCallback = cb;
        return vi.fn(); // cleanup fn
    }),
    logDebug: vi.fn(),
}));

const makePromptPatterns = (): PromptPattern[] => [
    { id: 'p1', name: 'bash', pattern: '\\$\\s*$' },
];

const makeOptions = (overrides?: Partial<Parameters<typeof useInteractiveFlow>[0]>) => ({
    promptPatterns: makePromptPatterns(),
    onFeedbackReady: vi.fn(),
    ...overrides,
});

beforeEach(() => {
    vi.clearAllMocks();
});

// ── Initial state ──

describe('useInteractiveFlow — initial state', () => {
    it('trackings is empty on mount', () => {
        const { result } = renderHook(() => useInteractiveFlow(makeOptions()));
        expect(result.current.trackings).toEqual({});
    });
});

// ── startTracking ──

describe('useInteractiveFlow — startTracking', () => {
    it('adds a tracking entry with the correct aiSessionId and originalCommand', () => {
        const { result } = renderHook(() => useInteractiveFlow(makeOptions()));

        act(() => {
            result.current.startTracking('term-1', 'ai-1', 'ls -la');
        });

        expect(result.current.trackings['term-1']).toBeDefined();
        expect(result.current.trackings['term-1'].aiSessionId).toBe('ai-1');
        expect(result.current.trackings['term-1'].originalCommand).toBe('ls -la');
    });

    it('initialises the buffer as an empty string', () => {
        const { result } = renderHook(() => useInteractiveFlow(makeOptions()));

        act(() => {
            result.current.startTracking('term-2', 'ai-2', 'pwd');
        });

        expect(result.current.trackings['term-2'].buffer).toBe('');
    });

    it('records a startTime close to Date.now()', () => {
        const before = Date.now();
        const { result } = renderHook(() => useInteractiveFlow(makeOptions()));

        act(() => {
            result.current.startTracking('term-3', 'ai-3', 'whoami');
        });

        const after = Date.now();
        const { startTime } = result.current.trackings['term-3'];
        expect(startTime).toBeGreaterThanOrEqual(before);
        expect(startTime).toBeLessThanOrEqual(after);
    });

    it('can track multiple terminal sessions independently', () => {
        const { result } = renderHook(() => useInteractiveFlow(makeOptions()));

        act(() => {
            result.current.startTracking('term-a', 'ai-a', 'cmd-a');
            result.current.startTracking('term-b', 'ai-b', 'cmd-b');
        });

        expect(Object.keys(result.current.trackings)).toHaveLength(2);
        expect(result.current.trackings['term-a'].aiSessionId).toBe('ai-a');
        expect(result.current.trackings['term-b'].aiSessionId).toBe('ai-b');
    });
});

// ── cancelTracking ──

describe('useInteractiveFlow — cancelTracking', () => {
    it('removes an existing tracking entry', () => {
        const { result } = renderHook(() => useInteractiveFlow(makeOptions()));

        act(() => {
            result.current.startTracking('term-1', 'ai-1', 'ls');
        });
        expect(result.current.trackings['term-1']).toBeDefined();

        act(() => {
            result.current.cancelTracking('term-1');
        });
        expect(result.current.trackings['term-1']).toBeUndefined();
    });

    it('does nothing when called for a non-existent session', () => {
        const { result } = renderHook(() => useInteractiveFlow(makeOptions()));

        // Should not throw and trackings should remain empty
        act(() => {
            result.current.cancelTracking('nonexistent');
        });

        expect(result.current.trackings).toEqual({});
    });

    it('only removes the targeted session, leaving others intact', () => {
        const { result } = renderHook(() => useInteractiveFlow(makeOptions()));

        act(() => {
            result.current.startTracking('term-a', 'ai-a', 'cmd-a');
            result.current.startTracking('term-b', 'ai-b', 'cmd-b');
        });

        act(() => {
            result.current.cancelTracking('term-a');
        });

        expect(result.current.trackings['term-a']).toBeUndefined();
        expect(result.current.trackings['term-b']).toBeDefined();
    });
});

// ── sendNow ──

describe('useInteractiveFlow — sendNow', () => {
    it('calls onFeedbackReady with formatted result text and removes tracking', () => {
        const onFeedbackReady = vi.fn();
        const { result } = renderHook(() =>
            useInteractiveFlow(makeOptions({ onFeedbackReady }))
        );

        act(() => {
            result.current.startTracking('term-1', 'ai-1', 'cat /etc/hosts');
        });

        act(() => {
            result.current.sendNow('term-1');
        });

        expect(onFeedbackReady).toHaveBeenCalledTimes(1);

        const [calledAiSessionId, calledResultText, calledTermSessionId] =
            onFeedbackReady.mock.calls[0];

        expect(calledAiSessionId).toBe('ai-1');
        expect(calledTermSessionId).toBe('term-1');
        // Result text must contain the manual-send marker and the original command
        expect(calledResultText).toContain('Manual Send');
        expect(calledResultText).toContain('cat /etc/hosts');

        // Tracking must be removed
        expect(result.current.trackings['term-1']).toBeUndefined();
    });

    it('includes the current buffer content in the result text', () => {
        const onFeedbackReady = vi.fn();
        const { result } = renderHook(() =>
            useInteractiveFlow(makeOptions({ onFeedbackReady }))
        );

        act(() => {
            result.current.startTracking('term-1', 'ai-1', 'df -h');
        });

        act(() => {
            result.current.sendNow('term-1');
        });

        const [, resultText] = onFeedbackReady.mock.calls[0];
        // Buffer is empty on manual send (no data was fed via onSessionData in this test)
        expect(typeof resultText).toBe('string');
        expect(resultText).toContain('df -h');
    });

    it('does nothing when called for a non-existent session', () => {
        const onFeedbackReady = vi.fn();
        const { result } = renderHook(() =>
            useInteractiveFlow(makeOptions({ onFeedbackReady }))
        );

        act(() => {
            result.current.sendNow('nonexistent');
        });

        expect(onFeedbackReady).not.toHaveBeenCalled();
        expect(result.current.trackings).toEqual({});
    });
});

// ── Prompt detection via onSessionData ──

describe('useInteractiveFlow — prompt detection', () => {
    const stablePatterns = makePromptPatterns();

    it('detects prompt and calls onFeedbackReady after stabilization', () => {
        vi.useFakeTimers();
        const onFeedbackReady = vi.fn();
        const opts = { promptPatterns: stablePatterns, onFeedbackReady };
        const { result } = renderHook(() => useInteractiveFlow(opts));

        act(() => {
            result.current.startTracking('term-1', 'ai-1', 'ls');
        });

        // Simulate terminal output followed by prompt
        act(() => {
            sessionDataCallback?.('term-1', 'file1 file2\n$ ');
        });

        expect(onFeedbackReady).not.toHaveBeenCalled();

        // Advance past stabilization timeout (400ms)
        act(() => {
            vi.advanceTimersByTime(500);
        });

        expect(onFeedbackReady).toHaveBeenCalledTimes(1);
        expect(onFeedbackReady.mock.calls[0][0]).toBe('ai-1');
        expect(onFeedbackReady.mock.calls[0][2]).toBe('term-1');

        vi.useRealTimers();
    });

    it('handles split ANSI sequences across data chunks', () => {
        vi.useFakeTimers();
        const onFeedbackReady = vi.fn();
        const opts = { promptPatterns: stablePatterns, onFeedbackReady };
        const { result } = renderHook(() => useInteractiveFlow(opts));

        act(() => {
            result.current.startTracking('term-1', 'ai-1', 'ls');
        });

        // Chunk 1: prompt followed by incomplete ANSI escape
        act(() => {
            sessionDataCallback?.('term-1', 'output\r\n$ \x1b[');
        });

        // Chunk 2: completes the ANSI sequence
        act(() => {
            sessionDataCallback?.('term-1', '?2004h');
        });

        // After ANSI stripping on full buffer, lastLine should be "$ "
        act(() => {
            vi.advanceTimersByTime(500);
        });

        expect(onFeedbackReady).toHaveBeenCalledTimes(1);
        expect(onFeedbackReady.mock.calls[0][0]).toBe('ai-1');

        vi.useRealTimers();
    });

    it('ignores data for sessions not being tracked', () => {
        const onFeedbackReady = vi.fn();
        const opts = { promptPatterns: stablePatterns, onFeedbackReady };
        renderHook(() => useInteractiveFlow(opts));

        act(() => {
            sessionDataCallback?.('unknown-session', '$ ');
        });

        expect(onFeedbackReady).not.toHaveBeenCalled();
    });
});

// ── TTL Cleanup ──

describe('useInteractiveFlow — TTL cleanup', () => {
    const stablePatterns = makePromptPatterns();

    it('calls onFeedbackReady with timeout message when tracking expires', () => {
        vi.useFakeTimers();
        const onFeedbackReady = vi.fn();
        const opts = { promptPatterns: stablePatterns, onFeedbackReady };
        const { result } = renderHook(() => useInteractiveFlow(opts));

        act(() => {
            result.current.startTracking('term-1', 'ai-1', 'long-running-cmd');
        });

        // Advance past TTL (15 minutes) + cleanup interval (1 minute)
        act(() => {
            vi.advanceTimersByTime(16 * 60 * 1000);
        });

        expect(onFeedbackReady).toHaveBeenCalledTimes(1);
        const [aiSessionId, resultText, termSessionId] = onFeedbackReady.mock.calls[0];
        expect(aiSessionId).toBe('ai-1');
        expect(termSessionId).toBe('term-1');
        expect(resultText).toContain('Timed Out');
        expect(resultText).toContain('long-running-cmd');

        // Tracking should be removed
        expect(result.current.trackings['term-1']).toBeUndefined();

        vi.useRealTimers();
    });
});
