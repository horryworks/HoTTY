/**
 * Moving one AI Chat conversation set between windows (pop-out / pop-in).
 *
 * This module is PURE — it builds, trims, validates and unpacks the payload.
 * The orchestration (who sends, who acks, what is torn down when) lives in
 * `useAiChatWindow`. Keeping the wire format here means the shape can be
 * unit-tested without a window, a store or a Tauri runtime.
 *
 * ## Why the pane id travels
 * The backend keys chat history by `paneId::tabId` (`aiBackendSessionId`). The
 * receiving window therefore adopts the SENDER's pane id verbatim: history,
 * in-flight stream routing and cancellation all keep working, and the Rust side
 * needs no notion of windows moving at all.
 *
 * ## Why it is a move, not a copy
 * A conversation exists in exactly one window. Two live copies would mean two
 * composers, two auto-exec countdowns and two confirmation cards for the same
 * turn — the sender drops its copy as soon as the receiver acknowledges.
 *
 * ## Transport
 * The existing cross-window broadcast (`broadcastSharedChange` /
 * `onSharedStoreChanged`) carries these payloads on their own channels. That
 * command is channel-agnostic, so no backend change is needed.
 */

import type { AiWorkerSession } from '../stores/aiWorkerSessionStore';
import type { AiChatState } from '../hooks/useAiChat';
import type { ChatMessage, TabTokens } from '../hooks/useChatStream';

/** Channel carrying a conversation set from one window to another. */
export const AI_HANDOVER_CHANNEL = 'hotty-ai-handover';

/** Channel carrying the receiver's "I have it" reply back to the sender. */
export const AI_HANDOVER_ACK_CHANNEL = 'hotty-ai-handover-ack';

/**
 * Wire-format version. Bumped when the payload shape changes; a receiver that
 * does not recognise the version refuses the handover instead of unpacking a
 * shape it does not understand. Two HoTTY builds only ever share a process
 * after an in-app version switch, but refusing is still cheaper than corrupting
 * a conversation.
 */
export const AI_HANDOVER_VERSION = 1;

/**
 * How many of the most recent image-bearing user turns keep their attachments
 * when a conversation moves.
 *
 * Images are base64 in the render transcript and the backend allows ~20 MiB of
 * them per session, so an untrimmed payload can be tens of megabytes of JSON
 * over the event bus. The model is unaffected either way — the backend history
 * keeps every image — so what is lost is only the thumbnail in older
 * scrollback, and the receiver says how many were dropped.
 */
export const HANDOVER_IMAGE_TURNS = 2;

/** One tab's transcript, in wire form (Maps do not survive JSON). */
export type HandoverMessages = [tabId: string, messages: ChatMessage[]][];
export type HandoverTokens = [tabId: string, tokens: TabTokens][];

export interface AiHandoverPayload {
  v: number;
  /** Window label this payload is addressed to; every other window ignores it. */
  to: string;
  /** Window label that sent it — where a later pop-in goes back to. */
  from: string;
  /** The conversation's pane id. Reused verbatim; see the module header. */
  paneId: string;
  state: AiChatState;
  messages: HandoverMessages;
  tokens: HandoverTokens;
  /** Worker sessions the conversation opened (ADR-AI-007). Never carries secrets. */
  workers: AiWorkerSession[];
  /** How many older turns had their image attachments trimmed. */
  imagesDropped: number;
}

export interface AiHandoverAck {
  v: number;
  /** Window label that sent the payload being acknowledged. */
  to: string;
  /** Window label acknowledging it. */
  from: string;
  paneId: string;
  /** Worker session ids the receiver actually took ownership of. */
  adopted: string[];
}

/**
 * Drop image attachments from all but the most recent {@link HANDOVER_IMAGE_TURNS}
 * image-bearing user turns of one transcript.
 *
 * Walks backwards so "recent" means recent in the conversation, not in the
 * array's arbitrary tail. Returns the original array untouched when nothing
 * needs trimming, so an image-free conversation costs nothing.
 */
export function trimHandoverImages(
  messages: ChatMessage[],
  keepTurns: number = HANDOVER_IMAGE_TURNS,
): { messages: ChatMessage[]; dropped: number } {
  let seen = 0;
  let dropped = 0;
  const out = messages.slice();
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i];
    if (!m.images || m.images.length === 0) continue;
    seen += 1;
    if (seen <= keepTurns) continue;
    const rest = { ...m };
    delete rest.images;
    out[i] = rest;
    dropped += 1;
  }
  return dropped === 0 ? { messages, dropped: 0 } : { messages: out, dropped };
}

/** Build the payload for moving `paneId`'s conversations to `to`. */
export function buildHandoverPayload(input: {
  to: string;
  from: string;
  paneId: string;
  state: AiChatState;
  messagesByTab: Map<string, ChatMessage[]>;
  tokensByTab: Map<string, TabTokens>;
  workers: AiWorkerSession[];
}): AiHandoverPayload {
  const tabIds = new Set(input.state.tabs.map((t) => t.id));
  let imagesDropped = 0;
  const messages: HandoverMessages = [];
  for (const [tabId, msgs] of input.messagesByTab) {
    // Transcripts for tabs that are no longer in the state would arrive as
    // unreachable entries; drop them rather than move dead weight.
    if (!tabIds.has(tabId)) continue;
    const trimmed = trimHandoverImages(msgs);
    imagesDropped += trimmed.dropped;
    messages.push([tabId, trimmed.messages]);
  }
  const tokens: HandoverTokens = [];
  for (const [tabId, tok] of input.tokensByTab) {
    if (tabIds.has(tabId)) tokens.push([tabId, tok]);
  }
  return {
    v: AI_HANDOVER_VERSION,
    to: input.to,
    from: input.from,
    paneId: input.paneId,
    state: input.state,
    messages,
    tokens,
    workers: input.workers.filter((w) => tabIds.has(w.tabId)),
    imagesDropped,
  };
}

/**
 * Parse a payload received on {@link AI_HANDOVER_CHANNEL}.
 *
 * Returns `null` for anything malformed, unversioned or addressed elsewhere —
 * a broadcast reaches every window, so "not for me" is the common case, not an
 * error. Never throws: a corrupt payload must not take down the listener that
 * every future handover depends on.
 */
export function parseHandoverPayload(raw: string, selfLabel: string): AiHandoverPayload | null {
  const p = safeParse(raw);
  if (!p) return null;
  if (p.v !== AI_HANDOVER_VERSION) return null;
  if (p.to !== selfLabel) return null;
  if (typeof p.from !== 'string' || !p.from) return null;
  if (typeof p.paneId !== 'string' || !p.paneId) return null;
  const state = p.state as AiChatState | undefined;
  if (!state || typeof state !== 'object' || !Array.isArray(state.tabs)) return null;
  if (state.tabs.length === 0) return null;
  if (typeof state.activeTabId !== 'string') return null;
  return {
    v: AI_HANDOVER_VERSION,
    to: p.to,
    from: p.from,
    paneId: p.paneId,
    state,
    messages: entriesOf(p.messages),
    tokens: entriesOf(p.tokens),
    workers: Array.isArray(p.workers) ? (p.workers as AiWorkerSession[]) : [],
    imagesDropped: typeof p.imagesDropped === 'number' ? p.imagesDropped : 0,
  };
}

/** Build the reply the receiver sends once it owns the conversation. */
export function buildHandoverAck(input: {
  to: string;
  from: string;
  paneId: string;
  adopted: string[];
}): AiHandoverAck {
  return { v: AI_HANDOVER_VERSION, ...input };
}

/**
 * Parse an ack received on {@link AI_HANDOVER_ACK_CHANNEL}, or `null` if it is
 * malformed or not for this window's pending handover.
 */
export function parseHandoverAck(
  raw: string,
  selfLabel: string,
  expectPaneId: string,
): AiHandoverAck | null {
  const p = safeParse(raw);
  if (!p) return null;
  if (p.v !== AI_HANDOVER_VERSION) return null;
  if (p.to !== selfLabel) return null;
  if (p.paneId !== expectPaneId) return null;
  if (typeof p.from !== 'string' || !p.from) return null;
  return {
    v: AI_HANDOVER_VERSION,
    to: p.to,
    from: p.from,
    paneId: p.paneId,
    adopted: Array.isArray(p.adopted) ? p.adopted.filter((x): x is string => typeof x === 'string') : [],
  };
}

/**
 * Channel asking the AI Chat window to start watching one terminal.
 *
 * The terminal stays where it is — only the AI's attention moves. Used by the
 * terminal tab's "Watch in the AI Chat window" shortcut; the link picker's
 * "other windows" group already did this the long way round.
 */
export const AI_WATCH_REQUEST_CHANNEL = 'hotty-ai-watch-request';

export interface AiWatchRequest {
  v: number;
  /** Window label this request is addressed to. */
  to: string;
  sessionId: string;
}

export function buildWatchRequest(to: string, sessionId: string): AiWatchRequest {
  return { v: AI_HANDOVER_VERSION, to, sessionId };
}

/** Parse a watch request, or `null` if malformed or addressed elsewhere. */
export function parseWatchRequest(raw: string, selfLabel: string): AiWatchRequest | null {
  const p = safeParse(raw);
  if (!p) return null;
  if (p.v !== AI_HANDOVER_VERSION) return null;
  if (p.to !== selfLabel) return null;
  if (typeof p.sessionId !== 'string' || !p.sessionId) return null;
  return { v: AI_HANDOVER_VERSION, to: p.to, sessionId: p.sessionId };
}

/**
 * Channel asking an ordinary window to give one of the AI's terminals a real tab.
 *
 * A dedicated AI Chat window has no tab strip, so "open as tab" — and the
 * automatic materialization a Telnet login depends on (ADR-AI-007) — have
 * nowhere to land there. The session itself never moves: only its ownership and
 * its terminal do. The scrollback is deliberately NOT in the payload; the
 * receiver reads it from the backend watch buffer, which keeps terminal output
 * off the event bus and the message small.
 */
export const AI_ADOPT_SESSION_CHANNEL = 'hotty-adopt-session';

export interface AiAdoptSessionRequest {
  v: number;
  /** Window label asked to give this session a tab. */
  to: string;
  /** The worker descriptor. Carries no secrets — the store never held any. */
  worker: AiWorkerSession;
}

export function buildAdoptRequest(to: string, worker: AiWorkerSession): AiAdoptSessionRequest {
  return { v: AI_HANDOVER_VERSION, to, worker };
}

/** Parse an adopt request, or `null` if malformed or addressed elsewhere. */
export function parseAdoptRequest(raw: string, selfLabel: string): AiAdoptSessionRequest | null {
  const p = safeParse(raw);
  if (!p) return null;
  if (p.v !== AI_HANDOVER_VERSION) return null;
  if (p.to !== selfLabel) return null;
  const w = p.worker as AiWorkerSession | undefined;
  if (!w || typeof w !== 'object') return null;
  if (typeof w.id !== 'string' || !w.id) return null;
  if (typeof w.protocol !== 'string' || !w.protocol) return null;
  if (typeof w.displayName !== 'string' || !w.displayName) return null;
  return { v: AI_HANDOVER_VERSION, to: p.to, worker: w };
}

/** Every worker session id in a payload — what the receiver must take ownership of. */
export function workerIdsOf(payload: AiHandoverPayload): string[] {
  return payload.workers.map((w) => w.id);
}

function safeParse(raw: string): Record<string, unknown> | null {
  try {
    const p: unknown = JSON.parse(raw);
    return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Coerce a JSON value back into `[key, value]` entries, dropping bad rows. */
function entriesOf<V>(value: unknown): [string, V][] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (e): e is [string, V] => Array.isArray(e) && e.length === 2 && typeof e[0] === 'string',
  );
}
