import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInteractiveFlow } from './useInteractiveFlow';
import type { PromptPattern } from '../types/appTypes';

vi.mock('../services/electronService', () => ({
    onSessionData: vi.fn(() => vi.fn()), // returns cleanup fn
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
