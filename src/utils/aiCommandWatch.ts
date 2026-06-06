// ── AI command-execution watch-poll decision ──
// Pure decision logic for the per-200ms poll that watches a terminal's captured
// output after an AI-issued command, deciding when the command has completed
// (shell prompt returned) or timed out. Extracted from App.tsx's onRunCommand
// poll loop so the timeout semantics are unit-testable.

// Detect a shell prompt: buffer ending with a common prompt char.
//   $ # — bash / sh / Cisco privileged
//   >   — Huawei VRP user view <hostname>, PowerShell, Cisco user mode
//   ]   — Huawei VRP system view [hostname] / sub-views [hostname-mode]
// No /m flag — $ anchors to end-of-string so we only match a real trailing prompt,
// not a stray $ / # / > / ] mid-stream (e.g. cipher hashes / config values). Note
// this deliberately does NOT match interactive prompts ending in ':' (e.g. Huawei
// '[Y/N]:'); a command left at such a prompt falls through to the idle timeout.
export const PROMPT_PATTERN = /[$#>\]]\s*$/;

export type WatchPollResult =
    | { action: 'wait' }
    | { action: 'prompt'; matchedAtEnd: boolean }
    | { action: 'idle' }
    | { action: 'safety' };

export interface WatchPollInput {
    newContent: string;       // captured output since the command started (after startLen)
    attemptsMs: number;       // elapsed poll time so far (attempts * pollIntervalMs)
    sendWindowMs: number;     // time reserved for sending all command lines (+ grace)
    idleMs: number;           // idle timeout; 0 disables it
    msSinceLastChange: number;// time since the buffer last grew
    msSinceStart: number;     // time since the command started
    safetyCapMs: number;      // hard ceiling; 0 disables it
}

export function evaluateWatchPoll(p: WatchPollInput): WatchPollResult {
    // Still sending the command lines (plus a small grace) — give the device time.
    if (p.attemptsMs < p.sendWindowMs) return { action: 'wait' };

    const match = p.newContent.length > 0 ? p.newContent.match(PROMPT_PATTERN) : null;
    if (match) {
        const idx = match.index ?? -1;
        const matchedAtEnd = idx >= 0 && idx + match[0].length === p.newContent.length;
        return { action: 'prompt', matchedAtEnd };
    }

    // Idle takes priority over the safety cap (idleMs << safetyCapMs in practice).
    // Crucially there is NO `newContent.length > 0` guard: a device that returns
    // nothing at all (dead/hung session, suppressed echo) must also time out — that
    // is exactly the "no response from device" case this timeout exists for.
    if (p.idleMs > 0 && p.msSinceLastChange >= p.idleMs) return { action: 'idle' };
    if (p.safetyCapMs > 0 && p.msSinceStart >= p.safetyCapMs) return { action: 'safety' };

    return { action: 'wait' };
}
