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
