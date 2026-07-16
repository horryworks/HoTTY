export const TERMINAL_OUTPUT_RE = /^Terminal Output \(Command: ([\s\S]*?)\):\n([\s\S]*)$/;

export function parseTerminalOutputMessage(content: string): { cmd: string; output: string } | null {
    if (!content.startsWith('Terminal Output (Command:')) return null;
    const m = content.match(TERMINAL_OUTPUT_RE);
    return m ? { cmd: m[1], output: m[2] } : null;
}

/**
 * Result note delivered into a chat tab when a command can't run because the
 * linked terminal isn't connected. Uses the `Terminal Output (Command: …)`
 * envelope so it renders as a command result and the model reads it as feedback
 * (rather than re-prepending the watch buffer). `status` is the linked session's
 * current status, or `undefined` when the session is gone entirely.
 */
export function notConnectedNote(cmd: string, status?: string): string {
    const state = status ?? 'disconnected';
    return `Terminal Output (Command: ${cmd}):\n[The linked terminal is not connected (${state}). Reconnect the terminal and press Watch again to re-link this chat.]`;
}

/**
 * Result note delivered into a chat tab when the user explicitly DECLINES to run a
 * suggested command ("Don't Execute"). Reuses the `Terminal Output (Command: …)`
 * envelope so it renders as a command result and the model reads it as feedback
 * (rather than re-prepending the watch buffer). The bracketed instruction tells the
 * model not to re-run and to offer an alternative — the app supplies the fact, the
 * model decides the wording.
 */
export function declinedNote(cmd: string): string {
    return `Terminal Output (Command: ${cmd}):\n[The user chose NOT to run this command. Do not run it. Acknowledge the user's decision and, if it would help, suggest a different approach.]`;
}
