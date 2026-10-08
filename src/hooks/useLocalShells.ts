import { useEffect, useState } from 'react';
import { tauriService } from '../services/tauriService';

/**
 * What the New Session menu can start without a dialog. `undefined` means not
 * known yet; an empty list / `null` path means not installed.
 */
export interface LocalShells {
    wslDistros: string[] | undefined;
    gitBashPath: string | null | undefined;
}

// The last answer, so a menu opened again shows its rows at once while the
// fresh check runs. Asking needs wsl.exe and a disk search, which take a moment.
let lastKnown: LocalShells = { wslDistros: undefined, gitBashPath: undefined };

/** Re-check the installed WSL distributions and Git Bash each time `active` turns on. */
export function useLocalShells(active: boolean): LocalShells {
    const [shells, setShells] = useState<LocalShells>(lastKnown);

    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        const update = (patch: Partial<LocalShells>) => {
            lastKnown = { ...lastKnown, ...patch };
            if (!cancelled) setShells(lastKnown);
        };
        // An async wrapper so a call that throws before returning a promise
        // still lands in the catch and reads as "not installed".
        void (async () => tauriService.listWslDistributions())()
            .then((d) => update({ wslDistros: d }))
            .catch(() => update({ wslDistros: [] }));
        void (async () => tauriService.detectGitBash())()
            .then((p) => update({ gitBashPath: p ?? null }))
            .catch(() => update({ gitBashPath: null }));
        return () => { cancelled = true; };
    }, [active]);

    return shells;
}

/** Forget the remembered answer. For tests. */
export function resetLocalShellsCache(): void {
    lastKnown = { wslDistros: undefined, gitBashPath: undefined };
}
