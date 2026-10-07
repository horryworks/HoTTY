/**
 * The AI-Chat pane's streaming machinery, lifted out of the AIChatPane
 * god-component:
 *   - the per-tab transcripts (`messagesByTab`), in-flight partials
 *     (`streamingByTab`), streaming flags (`streamingTabIds`) and token totals,
 *     which live in `aiTranscriptStore` keyed by pane id — NOT in this hook's
 *     state — so they survive the pane being re-created (dragged to another
 *     cell, hidden by a layout switch, …). The hook is the pane's view of and
 *     API onto that store entry.
 *   - the single `ai-chat-response` listener that routes chunk/done/error/
 *     cancelled events to the owning tab purely by parsing the per-tab session id
 *     (`paneId::tabId`), so MULTIPLE tabs can stream concurrently without their
 *     events colliding,
 *   - a PER-TAB stream watchdog (each streaming tab owns its own idle + hard-cap
 *     timer pair, keyed by pane and tab, module-level so it also outlives a
 *     pane re-creation),
 *   - stream-completion detection, with the reason the stream ended.
 *
 * Instead of the pane diffing `streamingTabIds` itself to notice a finished
 * stream, this hook exposes an explicit `onStreamComplete(tabId, messages,
 * reason)` callback (fired post-commit, so the final message is already in
 * `messages`). Only a `done` reason carries a finished answer.
 *
 * The returned helpers keep the names the pane has always used (`setMessagesByTab`,
 * `markStreaming`, `armStreamWatchdog`, …); their "latest value" reads go to the
 * store directly, which is always current — no post-commit ref lag.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { tauriService } from '../services/tauriService';
import { logError } from '../utils/logger';
import { isStaleRequest } from '../utils/aiRequestTracker';
import i18n from '../i18n';
import { calcAICost } from '../constants/aiPricing';
import { aiBackendSessionId } from './useAiChat';
import { streamTimeoutMessage, STREAM_IDLE_TIMEOUT_MS, STREAM_HARD_CAP_MS } from '../components/AIChatPane/streamWatchdog';
import {
    useAiTranscriptStore,
    paneTranscripts,
    EMPTY_PANE,
    type ChatMessage,
    type TabTokens,
    type PaneTranscripts,
} from '../stores/aiTranscriptStore';

export type { ChatMessage, TabTokens } from '../stores/aiTranscriptStore';

/**
 * How a tab's stream ended. Only `done` carries a finished model answer; the
 * pane must not treat a stopped, timed-out or failed partial as something to
 * act on (auto-execute a command from, open a terminal for).
 *   - `done`      the provider finished the answer
 *   - `cancelled` the user pressed Stop, or the backend cancelled it
 *   - `timeout`   the idle / hard-cap watchdog gave up on it
 *   - `error`     the provider reported an error
 *   - `cleared`   the tab was reset / closed / pruned while streaming
 */
export type StreamEndReason = 'done' | 'cancelled' | 'timeout' | 'error' | 'cleared';

interface UseChatStreamOptions {
    paneId: string;
    /** The tab currently shown, used to derive the active-tab views/helpers. */
    activeTabId: string | undefined;
    /** Model id used to price a `done` event's token usage. */
    selectedModelRef: React.MutableRefObject<string>;
    /** Fired (post-commit) when a tab's stream ends, with that tab's transcript and how it ended. */
    onStreamComplete: (tabId: string, messages: ChatMessage[], reason: StreamEndReason) => void;
}

type Updater<T> = T | ((prev: T) => T);
const resolve = <T,>(u: Updater<T>, prev: T): T => (typeof u === 'function' ? (u as (p: T) => T)(prev) : u);

// ── Module-level, per `paneId::tabId`: outlives a pane re-creation ──
type StreamTimers = { idle: ReturnType<typeof setTimeout> | null; hardCap: ReturnType<typeof setTimeout> | null };
const streamWatchdogs = new Map<string, StreamTimers>();
/** Why each tab's stream ended, recorded by whoever turns streaming off and
 *  consumed by the completion effect. A tab turned off with no reason (a bulk
 *  clear / prune) reports `cleared`. */
const endReasons = new Map<string, StreamEndReason>();
/** The model each in-flight stream was SENT with, so its `done` is priced
 *  against that model even if the user picked another one (or a region change
 *  reset the selection) while it streamed. */
const streamModels = new Map<string, string>();
const tabKey = (paneId: string, tabId: string) => `${paneId}::${tabId}`;

function clearWatchdogFor(key: string) {
    const w = streamWatchdogs.get(key);
    if (!w) return;
    if (w.idle) clearTimeout(w.idle);
    if (w.hardCap) clearTimeout(w.hardCap);
    streamWatchdogs.delete(key);
}

/**
 * Forget a pane entirely: its transcripts, and the timers and bookkeeping of
 * any stream it still had. For a pane that is CLOSED, or whose conversation
 * now lives in another window — never for a mere re-creation.
 */
export function disposePaneStreams(paneId: string): void {
    const prefix = `${paneId}::`;
    for (const key of [...streamWatchdogs.keys()]) if (key.startsWith(prefix)) clearWatchdogFor(key);
    for (const key of [...endReasons.keys()]) if (key.startsWith(prefix)) endReasons.delete(key);
    for (const key of [...streamModels.keys()]) if (key.startsWith(prefix)) streamModels.delete(key);
    useAiTranscriptStore.getState().removePane(paneId);
}

export function useChatStream({ paneId, activeTabId, selectedModelRef, onStreamComplete }: UseChatStreamOptions) {
    const { t } = useTranslation();

    // ── The pane's store entry (one subscription; a different pane's change keeps this reference) ──
    const pane = useAiTranscriptStore((s) => s.panes.get(paneId)) ?? EMPTY_PANE;
    const { messagesByTab, streamingByTab, streamingTabIds, tokensByTab } = pane;
    const updatePane = useAiTranscriptStore((s) => s.updatePane);

    // Latest-value mirrors for callbacks the listener / watchdog set up once.
    const tRef = useRef(t);
    const onStreamCompleteRef = useRef(onStreamComplete);
    useEffect(() => {
        tRef.current = t;
        onStreamCompleteRef.current = onStreamComplete;
    });

    // ── Setters (same shapes as the React setState calls they replace) ──
    const setMessagesByTab = useCallback((u: Updater<Map<string, ChatMessage[]>>) => {
        updatePane(paneId, (p) => ({ ...p, messagesByTab: resolve(u, p.messagesByTab as Map<string, ChatMessage[]>) }));
    }, [paneId, updatePane]);
    const setStreamingByTab = useCallback((u: Updater<Map<string, string>>) => {
        updatePane(paneId, (p) => ({ ...p, streamingByTab: resolve(u, p.streamingByTab as Map<string, string>) }));
    }, [paneId, updatePane]);
    const setStreamingTabIds = useCallback((u: Updater<Set<string>>) => {
        updatePane(paneId, (p) => ({ ...p, streamingTabIds: resolve(u, p.streamingTabIds as Set<string>) }));
    }, [paneId, updatePane]);
    const setTokensByTab = useCallback((u: Updater<Map<string, TabTokens>>) => {
        updatePane(paneId, (p) => ({ ...p, tokensByTab: resolve(u, p.tokensByTab as Map<string, TabTokens>) }));
    }, [paneId, updatePane]);

    // ── Active-tab views + helpers ──
    const activeTokens = activeTabId ? tokensByTab.get(activeTabId) : undefined;
    const totalInputTokens = activeTokens?.input ?? 0;
    const totalOutputTokens = activeTokens?.output ?? 0;
    const totalCost = activeTokens?.cost ?? null;
    const messages = useMemo<ChatMessage[]>(
        () => (activeTabId ? (messagesByTab.get(activeTabId) ?? []) : []),
        [activeTabId, messagesByTab],
    );
    const streamingContent = activeTabId ? (streamingByTab.get(activeTabId) ?? '') : '';
    const isStreaming = activeTabId ? streamingTabIds.has(activeTabId) : false;
    const setStreamingForTab = useCallback((tabId: string, value: string | ((prev: string) => string)) => {
        setStreamingByTab((prev) => {
            const next = new Map(prev);
            const cur = prev.get(tabId) ?? '';
            const v = typeof value === 'function' ? (value as (p: string) => string)(cur) : value;
            if (v === '') next.delete(tabId); else next.set(tabId, v);
            return next;
        });
    }, [setStreamingByTab]);
    const markStreaming = useCallback((tabId: string, on: boolean, reason?: StreamEndReason) => {
        const key = tabKey(paneId, tabId);
        if (on) streamModels.set(key, selectedModelRef.current);
        if (!on && reason) endReasons.set(key, reason);
        setStreamingTabIds((prev) => {
            if (on) {
                if (prev.has(tabId)) return prev;
                const next = new Set(prev); next.add(tabId); return next;
            }
            if (!prev.has(tabId)) return prev;
            const next = new Set(prev); next.delete(tabId); return next;
        });
    }, [paneId, selectedModelRef, setStreamingTabIds]);
    const setStreamingContent = useCallback((updater: string | ((prev: string) => string)) => {
        if (!activeTabId) return;
        setStreamingForTab(activeTabId, updater);
    }, [activeTabId, setStreamingForTab]);
    const setIsStreaming = useCallback((b: boolean | ((prev: boolean) => boolean), reason?: StreamEndReason) => {
        if (!activeTabId) return;
        const v = typeof b === 'function' ? b(paneTranscripts(paneId).streamingTabIds.has(activeTabId)) : b;
        markStreaming(activeTabId, v, reason);
    }, [activeTabId, paneId, markStreaming]);
    const setMessages = useCallback((updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
        if (!activeTabId) return;
        setMessagesByTab((prev) => {
            const next = new Map(prev);
            const cur = prev.get(activeTabId) ?? [];
            next.set(activeTabId, typeof updater === 'function' ? (updater as (p: ChatMessage[]) => ChatMessage[])(cur) : updater);
            return next;
        });
    }, [activeTabId, setMessagesByTab]);

    // ── Watchdog (idle + hard cap), PER TAB ──
    // Each streaming tab owns its OWN idle+hard-cap timer pair (keyed by pane and
    // tab), so concurrent streams are watch-dogged independently — one tab timing
    // out never touches another. idle: re-armed on every chunk; fires after
    // silence. hard cap: armed once per stream, not reset by chunks, so a runaway
    // provider is still cancelled. Module-level, so a pane re-creation neither
    // loses a running stream's guard nor leaves it with none.
    const clearStreamWatchdog = useCallback((tabId: string) => clearWatchdogFor(tabKey(paneId, tabId)), [paneId]);
    const finalizeStuckStream = useCallback((tabId: string, ms: number, kind: 'idle' | 'hardcap') => {
        tauriService.aiChatCancel(aiBackendSessionId(paneId, tabId)).catch(() => {});
        const partial = paneTranscripts(paneId).streamingByTab.get(tabId) ?? '';
        const reason = tRef.current(
            kind === 'idle' ? 'aiChat.pane.streamIdleTimeout' : 'aiChat.pane.streamHardcapTimeout',
            { seconds: Math.round(ms / 1000) },
        );
        const body = streamTimeoutMessage(partial, ms, kind, reason);
        setMessagesByTab(prev => {
            const next = new Map(prev);
            const cur = prev.get(tabId) ?? [];
            next.set(tabId, [...cur, { role: 'model', content: body }]);
            return next;
        });
        setStreamingForTab(tabId, '');
        markStreaming(tabId, false, 'timeout');
        clearStreamWatchdog(tabId);
    }, [paneId, setMessagesByTab, setStreamingForTab, markStreaming, clearStreamWatchdog]);
    const armStreamWatchdog = useCallback((tabId: string) => {
        const key = tabKey(paneId, tabId);
        let w = streamWatchdogs.get(key);
        if (!w) { w = { idle: null, hardCap: null }; streamWatchdogs.set(key, w); }
        if (w.idle) clearTimeout(w.idle);
        w.idle = setTimeout(() => {
            const cur = streamWatchdogs.get(key);
            if (cur) cur.idle = null;
            finalizeStuckStream(tabId, STREAM_IDLE_TIMEOUT_MS, 'idle');
        }, STREAM_IDLE_TIMEOUT_MS);
        if (!w.hardCap) {
            w.hardCap = setTimeout(() => {
                const cur = streamWatchdogs.get(key);
                if (cur) cur.hardCap = null;
                finalizeStuckStream(tabId, STREAM_HARD_CAP_MS, 'hardcap');
            }, STREAM_HARD_CAP_MS);
        }
    }, [paneId, finalizeStuckStream]);

    // ── Response listener (subscribed once per mounted pane) ──
    useEffect(() => {
        let cancelled = false;
        let unlisten: (() => void) | undefined;

        tauriService.onAiChatResponse((data) => {
            if (cancelled) return;
            // Every real send uses a per-tab session id (`paneId::tabId`); route each
            // chunk/done/error to its owning tab by parsing the tab id out of it. This
            // is what lets concurrent streams from different tabs interleave on the one
            // event channel without colliding. A bare paneId (legacy, no send path
            // emits it anymore) can't be routed to a specific tab, so it is ignored.
            if (!data.sessionId.startsWith(`${paneId}::`)) return;
            const targetTabId = data.sessionId.slice(paneId.length + 2);
            if (!targetTabId) return;
            // Drop late events for a tab that is no longer streaming.
            if (!paneTranscripts(paneId).streamingTabIds.has(targetTabId)) return;
            // …and late events of an older send for the same tab: a stopped or
            // cleared reply's `cancelled` must not close the reply that replaced it.
            if (isStaleRequest(data.sessionId, data.requestId)) return;

            if (data.responseType === 'chunk') {
                setStreamingForTab(targetTabId, prev => prev + data.content);
                armStreamWatchdog(targetTabId);
            } else if (data.responseType === 'done') {
                clearStreamWatchdog(targetTabId);
                setMessagesByTab(prev => {
                    const next = new Map(prev);
                    const cur = prev.get(targetTabId) ?? [];
                    next.set(targetTabId, [...cur, { role: 'model', content: data.content }]);
                    return next;
                });
                setStreamingForTab(targetTabId, '');
                markStreaming(targetTabId, false, 'done');
                if (data.usageMetadata) {
                    const inTokens = data.usageMetadata.promptTokenCount || 0;
                    const outTokens = data.usageMetadata.candidatesTokenCount || 0;
                    const key = tabKey(paneId, targetTabId);
                    const sentModel = streamModels.get(key) ?? selectedModelRef.current;
                    streamModels.delete(key);
                    const responseCost = calcAICost(inTokens, outTokens, sentModel);
                    setTokensByTab(prev => {
                        const next = new Map(prev);
                        const cur = prev.get(targetTabId) ?? { input: 0, output: 0, cost: null };
                        next.set(targetTabId, {
                            input: cur.input + inTokens,
                            output: cur.output + outTokens,
                            cost: responseCost !== null ? (cur.cost ?? 0) + responseCost : cur.cost,
                        });
                        return next;
                    });
                }
            } else if (data.responseType === 'error') {
                clearStreamWatchdog(targetTabId);
                setMessagesByTab(prev => {
                    const next = new Map(prev);
                    const cur = prev.get(targetTabId) ?? [];
                    next.set(targetTabId, [...cur, { role: 'model', content: tRef.current('aiChat.pane.errorMessage', { message: data.content }) }]);
                    return next;
                });
                setStreamingForTab(targetTabId, '');
                markStreaming(targetTabId, false, 'error');
            } else if (data.responseType === 'cancelled') {
                // A cancel this pane did NOT perform itself (provider / region /
                // auth change elsewhere, or a send stopped while still queued).
                // The user's own Stop already closed the tab out — that case is
                // dropped by the not-streaming guard above. Keep whatever partial
                // text arrived, marked exactly like a Stop.
                clearStreamWatchdog(targetTabId);
                if (data.content) {
                    const partial = data.content;
                    setMessagesByTab(prev => {
                        const next = new Map(prev);
                        const cur = prev.get(targetTabId) ?? [];
                        next.set(targetTabId, [...cur, { role: 'model', content: partial + tRef.current('aiChat.pane.cancelledSuffix') }]);
                        return next;
                    });
                }
                setStreamingForTab(targetTabId, '');
                markStreaming(targetTabId, false, 'cancelled');
            }
        }).then(fn => {
            if (cancelled) { fn(); } else { unlisten = fn; }
        }).catch(e => logError('AI', i18n.t('notifications.errors.aiResponseListener'), e));

        // Unsubscribing is all a re-creation needs: the watchdogs keep guarding
        // the streams still in flight, and the next instance picks them up.
        return () => { cancelled = true; unlisten?.(); };
    }, [paneId, selectedModelRef, setMessagesByTab, setTokensByTab, setStreamingForTab, markStreaming, armStreamWatchdog, clearStreamWatchdog]);

    // ── Stream-completion detection ──
    // Fire onStreamComplete for every tab that just left `streamingTabIds` (done,
    // error, cancel, watchdog, or a bulk clear — the callback's own last-message
    // check harmlessly ignores clears, which have no runnable message). Runs
    // post-commit, so the tab's final message is already in the transcript.
    // Seeded with the CURRENT set so a pane re-created mid-stream reports
    // nothing until that stream actually ends.
    const prevStreamingTabIdsRef = useRef(streamingTabIds);
    useEffect(() => {
        const prev = prevStreamingTabIdsRef.current;
        prevStreamingTabIdsRef.current = streamingTabIds;
        for (const tabId of prev) {
            if (!streamingTabIds.has(tabId)) {
                const key = tabKey(paneId, tabId);
                const reason = endReasons.get(key) ?? 'cleared';
                endReasons.delete(key);
                onStreamCompleteRef.current(tabId, paneTranscripts(paneId).messagesByTab.get(tabId) ?? [], reason);
            }
        }
    }, [paneId, streamingTabIds]);

    // ── Bulk lifecycle ops ──
    /** Provider switch / sign-out: every conversation of this pane is discarded. */
    const resetAllStreams = useCallback(() => {
        const prefix = `${paneId}::`;
        for (const key of [...streamWatchdogs.keys()]) if (key.startsWith(prefix)) clearWatchdogFor(key);
        updatePane(paneId, () => EMPTY_PANE);
    }, [paneId, updatePane]);
    const pruneStreams = useCallback((liveIds: Set<string>) => {
        // A closed tab may still hold a live watchdog timer — clear it so it can't
        // fire into (or cancel a backend session for) a tab that no longer exists.
        const prefix = `${paneId}::`;
        for (const key of [...streamWatchdogs.keys()]) {
            if (key.startsWith(prefix) && !liveIds.has(key.slice(prefix.length))) clearWatchdogFor(key);
        }
        const dropClosed = <T,>(prev: ReadonlyMap<string, T>): ReadonlyMap<string, T> => {
            let changed = false;
            const next = new Map(prev);
            for (const id of [...next.keys()]) if (!liveIds.has(id)) { next.delete(id); changed = true; }
            return changed ? next : prev;
        };
        updatePane(paneId, (p): PaneTranscripts => {
            const messagesByTab = dropClosed(p.messagesByTab);
            const streamingByTab = dropClosed(p.streamingByTab);
            const tokensByTab = dropClosed(p.tokensByTab);
            let streamingTabIds = p.streamingTabIds;
            for (const id of p.streamingTabIds) {
                if (!liveIds.has(id)) {
                    const next = new Set(streamingTabIds);
                    next.delete(id);
                    streamingTabIds = next;
                }
            }
            if (messagesByTab === p.messagesByTab && streamingByTab === p.streamingByTab
                && tokensByTab === p.tokensByTab && streamingTabIds === p.streamingTabIds) return p;
            return { ...p, messagesByTab, streamingByTab, tokensByTab, streamingTabIds };
        });
    }, [paneId, updatePane]);
    const clearTabStream = useCallback((tabId: string) => {
        clearStreamWatchdog(tabId);
        updatePane(paneId, (p): PaneTranscripts => {
            const messagesByTab = new Map(p.messagesByTab); messagesByTab.delete(tabId);
            const streamingByTab = new Map(p.streamingByTab); streamingByTab.delete(tabId);
            // "New chat" also zeroes this tab's token/cost counter.
            const tokensByTab = new Map(p.tokensByTab); tokensByTab.delete(tabId);
            const streamingTabIds = new Set(p.streamingTabIds); streamingTabIds.delete(tabId);
            return { ...p, messagesByTab, streamingByTab, tokensByTab, streamingTabIds };
        });
    }, [paneId, updatePane, clearStreamWatchdog]);

    return {
        messagesByTab, setMessagesByTab,
        streamingByTab, setStreamingByTab,
        streamingTabIds, setStreamingTabIds,
        messages, streamingContent, isStreaming,
        setStreamingForTab, markStreaming, setStreamingContent, setIsStreaming, setMessages,
        armStreamWatchdog, clearStreamWatchdog,
        totalInputTokens, totalOutputTokens, totalCost,
        resetAllStreams, pruneStreams, clearTabStream,
    };
}
