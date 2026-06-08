// ── AI command leading-sleep detection ──
// Pure parser that detects a *leading* `sleep N` on an AI-issued command so the
// caller can run the wait CLIENT-SIDE instead of sending it to the device.
//
// Why: a `sleep` sent to the terminal produces no output, so the watch poll's
// idle timeout (aiCommandIdleTimeoutSecs, default 10s) fires long before the
// sleep finishes and the AI proceeds prematurely. Converting a leading sleep to
// a client-side delay lets us simply NOT start the watch poll for the wait, then
// run any chained remainder afterwards. Extracted from App.tsx wiring so the
// parsing is unit-testable (per .claude/rules: logic in a util, App.tsx wires).

export interface SleepDelayParse {
    /** Parsed sleep duration in ms (UNclamped — the caller applies the max cap). */
    delayMs: number;
    /** Command remaining after the leading sleep; '' when the sleep is standalone. */
    rest: string;
    /** The matched "sleep N[unit]" text, surfaced in logs and the countdown UI. */
    rawSleep: string;
}

// Leading `sleep N[unit]`, anchored to the start. Case-sensitive on purpose:
// coreutils `sleep` is, and being strict avoids mis-detecting a real device
// command. `[ \t]+` (not `\s+`) requires a real space after the word so
// `sleep_check` / `sleepy` never match. The trailing group is the separator
// between the sleep and any remainder: end-of-string, newline, `&&`, or `;`.
const LEADING_SLEEP = /^\s*sleep[ \t]+(\d+\.?\d*|\.\d+)([smhd]?)\s*($|\n|&&|;)/;

const UNIT_MS: Record<string, number> = {
    '': 1000,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
};

/**
 * Parse a single leading `sleep N[unit]` off the front of a command.
 *
 * Returns `null` when the command does NOT begin with a sleep — the caller then
 * runs it on the device unchanged. Only the FIRST sleep is parsed: a `rest` that
 * itself begins with another `sleep` (e.g. `sleep 5 && sleep 3 && foo`) is left
 * verbatim so the caller can re-enter and delay each one individually.
 */
export function parseLeadingSleep(cmd: string): SleepDelayParse | null {
    const m = LEADING_SLEEP.exec(cmd);
    if (!m) return null;

    const value = parseFloat(m[1]);
    if (!Number.isFinite(value)) return null;
    const delayMs = Math.round(value * UNIT_MS[m[2]]);

    // Remainder is everything after the full match; strip only leading whitespace
    // (a stray separator left behind is harmless — the shell would tolerate it too).
    const rest = cmd.slice(m.index + m[0].length).replace(/^\s+/, '');
    const rawSleep = `sleep ${m[1]}${m[2]}`;

    return { delayMs, rest, rawSleep };
}

/**
 * Clamp a requested delay to a maximum (seconds). `maxSecs <= 0` disables the cap.
 * Returns the clamped duration in ms and whether clamping occurred.
 */
export function clampDelay(delayMs: number, maxSecs: number): { delayMs: number; wasClamped: boolean } {
    const maxMs = maxSecs > 0 ? maxSecs * 1000 : 0;
    if (maxMs > 0 && delayMs > maxMs) return { delayMs: maxMs, wasClamped: true };
    return { delayMs, wasClamped: false };
}

/**
 * Build the synthetic "terminal output" posted back to the AI after a standalone
 * client-side sleep delay, so the conversation continues as if the wait ran on
 * the device. Mirrors the `Terminal Output (Command: …)` shape the AI already
 * parses, with a cap note when the requested delay was clamped.
 */
export function syntheticDelayMessage(
    cmd: string,
    clampedMs: number,
    requestedMs: number,
    wasClamped: boolean,
): string {
    const secs = Math.round(clampedMs / 1000);
    const capNote = wasClamped ? ` (requested ${Math.round(requestedMs / 1000)}s, capped at ${secs}s)` : '';
    return `Terminal Output (Command: ${cmd}):\n[client-side delay complete: waited ${secs} seconds${capNote}]`;
}
