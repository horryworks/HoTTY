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

/**
 * Result note when an execute block names a `target=<alias>` that this tab does
 * not watch. The command is deliberately NOT run on a fallback terminal: with
 * AI-opened worker sessions coming and going, a command meant for a closed
 * neighbor must never land on the core device that happens to be last-focused.
 */
export function unknownTargetNote(cmd: string, alias: string): string {
    return `Terminal Output (Command: ${cmd}):\n[target alias "${alias}" is not a watched terminal, so the command was NOT run. Use only an alias from the watched-terminal list, or request the connection again with a connect block.]`;
}

// ── Connection envelopes (ADR-AI-007) ─────────────────────────────────────────
//
// Every outcome of an AI `connect` request is written into the transcript as a
// user-role message with one of these four heads, so (a) the model learns the
// result on its next turn, and (b) the request card can derive its final state
// from the transcript instead of from transient React state. `<key>` is the
// request's `connectRequestKey` (e.g. `ssh:alice@192.0.2.10:22`, `local:powershell`);
// `<alias>` is present only on a successful connect.

export const CONNECT_ENVELOPE_RE =
    /^(Terminal Connected|Connection Failed|Connection Declined|Connection Refused) \(([^()\n]+?)(?: as ([A-Za-z0-9._-]+))?\):\n([\s\S]*)$/;

export type ConnectEnvelopeKind = 'connected' | 'failed' | 'declined' | 'refused';

const ENVELOPE_KIND_BY_HEAD: Record<string, ConnectEnvelopeKind> = {
    'Terminal Connected': 'connected',
    'Connection Failed': 'failed',
    'Connection Declined': 'declined',
    'Connection Refused': 'refused',
};

export interface ConnectEnvelope {
    kind: ConnectEnvelopeKind;
    key: string;
    alias?: string;
    body: string;
}

export function parseConnectEnvelope(content: string): ConnectEnvelope | null {
    if (!content.startsWith('Terminal Connected') && !content.startsWith('Connection ')) return null;
    const m = content.match(CONNECT_ENVELOPE_RE);
    if (!m) return null;
    return { kind: ENVELOPE_KIND_BY_HEAD[m[1]], key: m[2], alias: m[3] || undefined, body: m[4] };
}

/**
 * True for every machine-generated message the app feeds back to the model
 * (command results, connect outcomes). Such a message already carries its own
 * terminal context, so `useAiChat.sendMessage` must NOT prepend the watched
 * terminals' buffers to it, and the transcript renders it as a block, not prose.
 */
export function isMachineEnvelope(text: string): boolean {
    return text.startsWith('Terminal Output (Command:') || parseConnectEnvelope(text) !== null;
}

export function connectedNote(key: string, alias: string, displayName: string, tail: string): string {
    const head = `Terminal Connected (${key} as ${alias}):\n`;
    const note = `[${displayName} is now open — it has no visible tab; its output is captured for you — and watched by this chat as alias "${alias}". Run commands on it with \`\`\`execute target=${alias}. The last screen output follows.]`;
    return tail ? `${head}${note}\n${tail}` : `${head}${note}`;
}

/** The request matched a terminal this chat already watches — nothing was opened. */
export function alreadyOpenNote(key: string, alias: string): string {
    return `Terminal Connected (${key} as ${alias}):\n[Already watched by this chat as alias "${alias}" — no new terminal was opened. Run commands on it with \`\`\`execute target=${alias}.]`;
}

export function connectFailedNote(key: string, reason: string): string {
    return `Connection Failed (${key}):\n[${reason}. Do not retry on your own; explain the situation to the user and continue with the terminals you already have.]`;
}

export function connectDeclinedNote(key: string): string {
    return `Connection Declined (${key}):\n[The user chose NOT to open this connection. Do not request it again. Continue with the terminals you already have, or ask the user how to proceed.]`;
}

export function connectRefusedNote(key: string, reason: string): string {
    return `Connection Refused (${key}):\n[${reason}]`;
}
