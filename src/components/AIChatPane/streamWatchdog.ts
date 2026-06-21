// ── AI Chat stream watchdog ──
// Timeout policy for an in-flight AI response stream, plus the user-facing message
// builder. Kept as a pure module so the timing constants and message text are unit
// testable independently of the React component wiring.
//
// Two complementary limits guard a stream:
//   - IDLE: re-armed on every chunk; fires after a gap of silence (hung connection,
//     unresponsive provider, dropped `done`).
//   - HARD CAP: armed once at stream start and NOT reset by chunks; fires when a
//     provider streams without end (runaway/looping generation), which the idle
//     timer can never catch because chunks keep arriving.

/** Idle gap (no chunk) after which the stream is cancelled. */
export const STREAM_IDLE_TIMEOUT_MS = 180_000;
/** Absolute ceiling for a single stream regardless of chunk activity. */
export const STREAM_HARD_CAP_MS = 600_000;

type StreamTimeoutKind = 'idle' | 'hardcap';

/**
 * Build the model-message body shown when a stream is force-cancelled by a timeout.
 * Any partial text already received is preserved above the error note.
 */
export function streamTimeoutMessage(partial: string, ms: number, kind: StreamTimeoutKind): string {
    const secs = Math.round(ms / 1000);
    const reason = kind === 'idle'
        ? `AI stream idle for ${secs}s — request cancelled`
        : `AI stream exceeded ${secs}s limit — request cancelled`;
    return partial ? `${partial}\n\n[Error: ${reason}]` : `Error: ${reason}`;
}
