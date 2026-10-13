import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// What the machine reports as installed. Each test can change the answers.
const shells = vi.hoisted(() => ({
    listWslDistributions: vi.fn(),
    detectGitBash: vi.fn(),
}));
vi.mock('../services/tauriService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/tauriService')>();
    return { ...actual, tauriService: { ...actual.tauriService, ...shells } };
});

import { useLocalShells, resetLocalShellsCache } from './useLocalShells';

const GIT_BASH = 'C:/Program Files/Git/bin/bash.exe';

/** A promise the test settles by hand. */
function deferred<T>() {
    let resolve: (v: T) => void = () => {};
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

describe('useLocalShells', () => {
    beforeEach(() => {
        resetLocalShellsCache();
        shells.listWslDistributions.mockReset();
        shells.detectGitBash.mockReset();
        shells.listWslDistributions.mockResolvedValue(['Ubuntu-24.04']);
        shells.detectGitBash.mockResolvedValue(GIT_BASH);
    });

    it('reports nothing known yet and asks nothing while inactive', () => {
        const { result } = renderHook(() => useLocalShells(false));
        expect(result.current).toEqual({ wslDistros: undefined, gitBashPath: undefined });
        expect(shells.listWslDistributions).not.toHaveBeenCalled();
        expect(shells.detectGitBash).not.toHaveBeenCalled();
    });

    it('fills in the installed shells once active', async () => {
        const { result } = renderHook(() => useLocalShells(true));
        await waitFor(() =>
            expect(result.current).toEqual({ wslDistros: ['Ubuntu-24.04'], gitBashPath: GIT_BASH })
        );
    });

    it('reads a missing Git Bash as null, not unknown', async () => {
        shells.detectGitBash.mockResolvedValue(undefined);
        const { result } = renderHook(() => useLocalShells(true));
        await waitFor(() => expect(result.current.gitBashPath).toBeNull());
    });

    it('reads a rejected check as "not installed"', async () => {
        shells.listWslDistributions.mockRejectedValue(new Error('wsl.exe not found'));
        shells.detectGitBash.mockRejectedValue(new Error('search failed'));
        const { result } = renderHook(() => useLocalShells(true));
        await waitFor(() => expect(result.current).toEqual({ wslDistros: [], gitBashPath: null }));
    });

    it('reads a check that throws before returning a promise as "not installed"', async () => {
        shells.listWslDistributions.mockImplementation(() => {
            throw new Error('boom');
        });
        shells.detectGitBash.mockImplementation(() => {
            throw new Error('boom');
        });
        const { result } = renderHook(() => useLocalShells(true));
        await waitFor(() => expect(result.current).toEqual({ wslDistros: [], gitBashPath: null }));
    });

    it('fills each answer in as it arrives', async () => {
        const wsl = deferred<string[]>();
        shells.listWslDistributions.mockReturnValue(wsl.promise);
        const { result } = renderHook(() => useLocalShells(true));
        await waitFor(() => expect(result.current.gitBashPath).toBe(GIT_BASH));
        expect(result.current.wslDistros).toBeUndefined();
        wsl.resolve(['Debian']);
        await waitFor(() => expect(result.current.wslDistros).toEqual(['Debian']));
    });

    it('shows the last answer at once on the next mount while re-checking', async () => {
        const first = renderHook(() => useLocalShells(true));
        await waitFor(() => expect(first.result.current.gitBashPath).toBe(GIT_BASH));
        first.unmount();

        shells.listWslDistributions.mockReturnValue(new Promise(() => {}));
        shells.detectGitBash.mockReturnValue(new Promise(() => {}));
        const second = renderHook(() => useLocalShells(true));
        expect(second.result.current).toEqual({ wslDistros: ['Ubuntu-24.04'], gitBashPath: GIT_BASH });
        expect(shells.listWslDistributions).toHaveBeenCalledTimes(2);
    });

    it('re-checks each time it turns active again', async () => {
        const { result, rerender } = renderHook(({ active }) => useLocalShells(active), {
            initialProps: { active: true },
        });
        await waitFor(() => expect(result.current.wslDistros).toEqual(['Ubuntu-24.04']));

        shells.listWslDistributions.mockResolvedValue(['Ubuntu-24.04', 'Debian']);
        rerender({ active: false });
        rerender({ active: true });
        await waitFor(() => expect(result.current.wslDistros).toEqual(['Ubuntu-24.04', 'Debian']));
        expect(shells.listWslDistributions).toHaveBeenCalledTimes(2);
    });

    it('still remembers an answer that lands after unmount', async () => {
        const wsl = deferred<string[]>();
        shells.listWslDistributions.mockReturnValue(wsl.promise);
        const first = renderHook(() => useLocalShells(true));
        first.unmount();
        wsl.resolve(['Debian']);
        // Let the promise chain settle (a macrotask runs after every microtask).
        await new Promise((r) => setTimeout(r, 0));

        shells.listWslDistributions.mockReturnValue(new Promise(() => {}));
        shells.detectGitBash.mockReturnValue(new Promise(() => {}));
        const second = renderHook(() => useLocalShells(true));
        expect(second.result.current.wslDistros).toEqual(['Debian']);
    });

    it('forgets the remembered answer on reset', async () => {
        const first = renderHook(() => useLocalShells(true));
        await waitFor(() => expect(first.result.current.wslDistros).toEqual(['Ubuntu-24.04']));
        first.unmount();
        resetLocalShellsCache();
        const second = renderHook(() => useLocalShells(false));
        expect(second.result.current).toEqual({ wslDistros: undefined, gitBashPath: undefined });
    });
});
