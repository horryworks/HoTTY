import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
    useNetboxStartupSync,
    NETBOX_STARTUP_SYNC_DELAY_MS,
    type NetboxStartupSyncOptions,
} from './useNetboxStartupSync';

function opts(over: Partial<NetboxStartupSyncOptions> = {}): NetboxStartupSyncOptions {
    return {
        isMainWindow: true,
        ready: true,
        enabled: true,
        configured: true,
        sync: vi.fn(),
        delayMs: 50,
        ...over,
    };
}

describe('useNetboxStartupSync', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('syncs once, after the delay', () => {
        const sync = vi.fn();
        renderHook(() => useNetboxStartupSync(opts({ sync })));

        expect(sync).not.toHaveBeenCalled();
        vi.advanceTimersByTime(50);
        expect(sync).toHaveBeenCalledTimes(1);
    });

    // The regression this hook exists for. Inline in `App`, `sync` sat in the
    // effect's dependency array while `useNetboxSync` returned a fresh object
    // every render: each re-render cleared the pending timer and the once-only
    // guard then refused to reschedule, so the startup sync never ran at all.
    it('still syncs when the caller passes a new closure on every render', () => {
        const sync = vi.fn();
        const { rerender } = renderHook(() =>
            // A fresh closure each render, exactly like `App` does.
            useNetboxStartupSync(opts({ sync: () => sync() })),
        );

        rerender();
        rerender();
        rerender();

        vi.advanceTimersByTime(50);
        expect(sync).toHaveBeenCalledTimes(1);
    });

    it('does not cancel a scheduled sync when a condition flips mid-delay', () => {
        const sync = vi.fn();
        const { rerender } = renderHook(
            (p: NetboxStartupSyncOptions) => useNetboxStartupSync(p),
            { initialProps: opts({ sync }) },
        );

        vi.advanceTimersByTime(20);
        rerender(opts({ sync, configured: false }));
        vi.advanceTimersByTime(30);

        expect(sync).toHaveBeenCalledTimes(1);
    });

    it('runs the sync that was current when the timer fired', () => {
        const first = vi.fn();
        const second = vi.fn();
        const { rerender } = renderHook(
            (p: NetboxStartupSyncOptions) => useNetboxStartupSync(p),
            { initialProps: opts({ sync: first }) },
        );

        rerender(opts({ sync: second }));
        vi.advanceTimersByTime(50);

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['a secondary window', { isMainWindow: false }],
        ['the host tree is not ready', { ready: false }],
        ['the setting is off', { enabled: false }],
        ['no base URL is configured', { configured: false }],
    ])('does not sync when %s', (_label, over) => {
        const sync = vi.fn();
        renderHook(() => useNetboxStartupSync(opts({ sync, ...over })));

        vi.advanceTimersByTime(50);
        expect(sync).not.toHaveBeenCalled();
    });

    it('syncs once the conditions become true later', () => {
        const sync = vi.fn();
        const { rerender } = renderHook(
            (p: NetboxStartupSyncOptions) => useNetboxStartupSync(p),
            { initialProps: opts({ sync, ready: false }) },
        );

        vi.advanceTimersByTime(50);
        expect(sync).not.toHaveBeenCalled();

        rerender(opts({ sync, ready: true }));
        vi.advanceTimersByTime(50);
        expect(sync).toHaveBeenCalledTimes(1);
    });

    it('never schedules a second sync in the same launch', () => {
        const sync = vi.fn();
        const { rerender } = renderHook(
            (p: NetboxStartupSyncOptions) => useNetboxStartupSync(p),
            { initialProps: opts({ sync }) },
        );

        vi.advanceTimersByTime(50);
        rerender(opts({ sync, ready: false }));
        rerender(opts({ sync, ready: true }));
        vi.advanceTimersByTime(500);

        expect(sync).toHaveBeenCalledTimes(1);
    });

    it('drops a pending sync on unmount', () => {
        const sync = vi.fn();
        const { unmount } = renderHook(() => useNetboxStartupSync(opts({ sync })));

        unmount();
        vi.advanceTimersByTime(50);
        expect(sync).not.toHaveBeenCalled();
    });

    it('defaults to the documented startup delay', () => {
        const sync = vi.fn();
        renderHook(() => useNetboxStartupSync({ ...opts({ sync }), delayMs: undefined }));

        vi.advanceTimersByTime(NETBOX_STARTUP_SYNC_DELAY_MS - 1);
        expect(sync).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(sync).toHaveBeenCalledTimes(1);
    });
});
