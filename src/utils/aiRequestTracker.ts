/**
 * The latest chat send per backend conversation id (`paneId::tabId`).
 *
 * Every send gets a fresh id that the backend echoes on each `ai-chat-response`
 * event it emits for that send. Events only name the conversation, and one
 * conversation can have a stopped or cleared send still unwinding while its
 * replacement streams: the old send's late `cancelled` used to close out the new
 * reply (a cleared chat then lost its device identification). Comparing ids
 * tells the two apart.
 *
 * A conversation with no record here (the send was started in another window,
 * before an AI Chat handover) is never treated as stale.
 */
const latestBySession = new Map<string, string>();

export function newRequestId(): string {
    return crypto.randomUUID();
}

export function noteRequest(sessionId: string, requestId: string): void {
    latestBySession.set(sessionId, requestId);
}

/** True when `requestId` belongs to a send this window has since replaced. */
export function isStaleRequest(sessionId: string, requestId: string | undefined): boolean {
    if (!requestId) return false;
    const latest = latestBySession.get(sessionId);
    return latest !== undefined && latest !== requestId;
}

/** Test-only: forget every recorded send. */
export function resetRequestTracker(): void {
    latestBySession.clear();
}
