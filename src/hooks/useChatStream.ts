/**
 * Owns the AI-Chat pane's streaming state and the machinery around it, lifted out
 * of the AIChatPane god-component:
 *   - per-tab transcripts (`messagesByTab`) and per-tab in-flight partials
 *     (`streamingByTab`) / streaming flags (`streamingTabIds`),
 *   - the single `ai-chat-response` listener that routes chunk/done/error events
 *     to the owning tab purely by parsing the per-tab session id (`paneId::tabId`),
 *     so MULTIPLE tabs can stream concurrently without their events colliding,
 *   - a PER-TAB stream watchdog (each streaming tab owns its own idle + hard-cap
 *     timer pair, keyed by tab id, so one tab's timeout never disturbs another),
 *   - stream-completion detection.
 *
 * Instead of the pane diffing `streamingTabIds` itself to notice a finished
 * stream, this hook exposes an explicit `onStreamComplete(tabId, messages)`
 * callback (fired post-commit, so the final message is already in `messages`).
 * Token usage from a `done` event is surfaced via `onUsage`.
 *
 * The returned helpers keep the same names the pane used locally
 * (`setMessagesByTab`, `markStreaming`, `armStreamWatchdog`, …). `armStreamWatchdog`
 * / `clearStreamWatchdog` now take a `tabId` (the watchdog is per-tab); there is no
 * longer a single "current stream" ref — ownership is fully expressed by the per-tab
 * `streamingTabIds` set plus the session-id routing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tauriService } from '../services/tauriService';
import { logError } from '../utils/logger';
import i18n from '../i18n';
import { calcAICost } from '../constants/aiPricing';
import { aiBackendSessionId } from './useAiChat';
import { streamTimeoutMessage, STREAM_IDLE_TIMEOUT_MS, STREAM_HARD_CAP_MS } from '../components/AIChatPane/streamWatchdog';
import type { ChatImage } from '../types/appTypes';

export interface ChatMessage {
    role: 'user' | 'model';
    content: string;
    /** Image attachments on a user turn (input-only; assistant turns never have them). */
    images?: ChatImage[];
}

/** Running token/cost totals for one tab (cost is null until a priced model reports usage). */
interface TabTokens {
    input: number;
    output: number;
    cost: number | null;
}

interface UseChatStreamOptions {
    paneId: string;
    /** The tab currently shown, used to derive the active-tab views/helpers. */
    activeTabId: string | undefined;
    /** Model id used to price a `done` event's token usage. */
    selectedModelRef: React.MutableRefObject<string>;
    /** Fired (post-commit) when a tab's stream ends, with that tab's transcript. */
    onStreamComplete: (tabId: string, messages: ChatMessage[]) => void;
}

export function useChatStream({ paneId, activeTabId, selectedModelRef, onStreamComplete }: UseChatStreamOptions) {
    const { t } = useTranslation();

    // ── Per-tab state ──
    const [messagesByTab, setMessagesByTab] = useState<Map<string, ChatMessage[]>>(() => new Map());
    const [streamingByTab, setStreamingByTab] = useState<Map<string, string>>(() => new Map());
    const [streamingTabIds, setStreamingTabIds] = useState<Set<string>>(() => new Set());
    // "Latest value" mirrors so the async listener/watchdog and the post-commit
    // completion effect can read current values without closing over state (keeping
    // their subscriptions stable). Synced in an effect (below), not during render.
    const tRef = useRef(t);
    const streamingByTabRef = useRef(streamingByTab);
    const streamingTabIdsRef = useRef(streamingTabIds);
    const messagesByTabRef = useRef(messagesByTab);
    const onStreamCompleteRef = useRef(onStreamComplete);
    // One post-commit sync for every latest-value mirror. Declared before the
    // completion effect so that effect reads the freshly-synced refs.
    useEffect(() => {
        tRef.current = t;
        streamingByTabRef.current = streamingByTab;
        streamingTabIdsRef.current = streamingTabIds;
        messagesByTabRef.current = messagesByTab;
        onStreamCompleteRef.current = onStreamComplete;
    });

    // Token accounting (from `done` events), tracked PER TAB and priced against the
    // model at completion — so a tab switch shows that tab's running total and "New
    // chat" resets only the active tab's counter (not the whole pane's).
    const [tokensByTab, setTokensByTab] = useState<Map<string, TabTokens>>(() => new Map());

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
    }, []);
    const markStreaming = useCallback((tabId: string, on: boolean) => {
        setStreamingTabIds((prev) => {
            if (on) {
                if (prev.has(tabId)) return prev;
                const next = new Set(prev); next.add(tabId); return next;
            }
            if (!prev.has(tabId)) return prev;
            const next = new Set(prev); next.delete(tabId); return next;
        });
    }, []);
    const setStreamingContent = useCallback((updater: string | ((prev: string) => string)) => {
        if (!activeTabId) return;
        setStreamingForTab(activeTabId, updater);
    }, [activeTabId, setStreamingForTab]);
    const setIsStreaming = useCallback((b: boolean | ((prev: boolean) => boolean)) => {
        if (!activeTabId) return;
        const v = typeof b === 'function' ? b(streamingTabIdsRef.current.has(activeTabId)) : b;
        markStreaming(activeTabId, v);
    }, [activeTabId, markStreaming]);
    const setMessages = useCallback((updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
        if (!activeTabId) return;
        setMessagesByTab((prev) => {
            const next = new Map(prev);
            const cur = prev.get(activeTabId) ?? [];
            next.set(activeTabId, typeof updater === 'function' ? (updater as (p: ChatMessage[]) => ChatMessage[])(cur) : updater);
            return next;
        });
    }, [activeTabId]);

    // ── Watchdog (idle + hard cap), PER TAB ──
    // Each streaming tab owns its OWN idle+hard-cap timer pair (keyed by tab id), so
    // concurrent streams are watch-dogged independently — one tab timing out never
    // touches another. idle: re-armed on every chunk; fires after silence. hard cap:
    // armed once per stream, not reset by chunks, so a runaway provider is still
    // cancelled. The partial is read from a ref so this logic never depends on
    // streamingByTab state — keeping armStreamWatchdog stable (the listener
    // subscribes once).
    type StreamTimers = { idle: ReturnType<typeof setTimeout> | null; hardCap: ReturnType<typeof setTimeout> | null };
    const streamWatchdogsRef = useRef<Map<string, StreamTimers>>(new Map());
    const clearStreamWatchdog = useCallback((tabId: string) => {
        const w = streamWatchdogsRef.current.get(tabId);
        if (!w) return;
        if (w.idle) clearTimeout(w.idle);
        if (w.hardCap) clearTimeout(w.hardCap);
        streamWatchdogsRef.current.delete(tabId);
    }, []);
    const clearAllStreamWatchdogs = useCallback(() => {
        for (const w of streamWatchdogsRef.current.values()) {
            if (w.idle) clearTimeout(w.idle);
            if (w.hardCap) clearTimeout(w.hardCap);
        }
        streamWatchdogsRef.current.clear();
    }, []);
    const finalizeStuckStream = useCallback((tabId: string, ms: number, kind: 'idle' | 'hardcap') => {
        tauriService.aiChatCancel(aiBackendSessionId(paneId, tabId)).catch(() => {});
        const partial = streamingByTabRef.current.get(tabId) ?? '';
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
        markStreaming(tabId, false);
        clearStreamWatchdog(tabId);
    }, [paneId, setStreamingForTab, markStreaming, clearStreamWatchdog]);
    const armStreamWatchdog = useCallback((tabId: string) => {
        let w = streamWatchdogsRef.current.get(tabId);
        if (!w) { w = { idle: null, hardCap: null }; streamWatchdogsRef.current.set(tabId, w); }
        if (w.idle) clearTimeout(w.idle);
        w.idle = setTimeout(() => {
            const cur = streamWatchdogsRef.current.get(tabId);
            if (cur) cur.idle = null;
            finalizeStuckStream(tabId, STREAM_IDLE_TIMEOUT_MS, 'idle');
        }, STREAM_IDLE_TIMEOUT_MS);
        if (!w.hardCap) {
            w.hardCap = setTimeout(() => {
                const cur = streamWatchdogsRef.current.get(tabId);
                if (cur) cur.hardCap = null;
                finalizeStuckStream(tabId, STREAM_HARD_CAP_MS, 'hardcap');
            }, STREAM_HARD_CAP_MS);
        }
    }, [finalizeStuckStream]);

    // ── Response listener (subscribed once for the pane's lifetime) ──
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
            if (!streamingTabIdsRef.current.has(targetTabId)) return;

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
                markStreaming(targetTabId, false);
                if (data.usageMetadata) {
                    const inTokens = data.usageMetadata.promptTokenCount || 0;
                    const outTokens = data.usageMetadata.candidatesTokenCount || 0;
                    const responseCost = calcAICost(inTokens, outTokens, selectedModelRef.current);
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
                markStreaming(targetTabId, false);
            }
        }).then(fn => {
            if (cancelled) { fn(); } else { unlisten = fn; }
        }).catch(e => logError('AI', i18n.t('notifications.errors.aiResponseListener'), e));

        return () => { cancelled = true; unlisten?.(); clearAllStreamWatchdogs(); };
    }, [paneId, selectedModelRef, setStreamingForTab, markStreaming, armStreamWatchdog, clearStreamWatchdog, clearAllStreamWatchdogs]);

    // ── Stream-completion detection ──
    // Fire onStreamComplete for every tab that just left `streamingTabIds` (done,
    // error, cancel, watchdog, or a bulk clear — the callback's own last-message
    // check harmlessly ignores clears, which have no runnable message). Runs
    // post-commit, so the tab's final message is already in the transcript.
    const prevStreamingTabIdsRef = useRef(streamingTabIds);
    useEffect(() => {
        const prev = prevStreamingTabIdsRef.current;
        prevStreamingTabIdsRef.current = streamingTabIds;
        for (const tabId of prev) {
            if (!streamingTabIds.has(tabId)) {
                onStreamCompleteRef.current(tabId, messagesByTabRef.current.get(tabId) ?? []);
            }
        }
    }, [streamingTabIds]);

    // ── Bulk lifecycle ops ──
    const resetAllStreams = useCallback(() => {
        clearAllStreamWatchdogs();
        setMessagesByTab(new Map());
        setStreamingByTab(new Map());
        setStreamingTabIds(new Set());
        setTokensByTab(new Map());
    }, [clearAllStreamWatchdogs]);
    const pruneStreams = useCallback((liveIds: Set<string>) => {
        // A closed tab may still hold a live watchdog timer — clear it so it can't
        // fire into (or cancel a backend session for) a tab that no longer exists.
        for (const tabId of [...streamWatchdogsRef.current.keys()]) {
            if (!liveIds.has(tabId)) clearStreamWatchdog(tabId);
        }
        const dropClosed = <T,>(prev: Map<string, T>): Map<string, T> => {
            let changed = false;
            const next = new Map(prev);
            for (const id of [...next.keys()]) if (!liveIds.has(id)) { next.delete(id); changed = true; }
            return changed ? next : prev;
        };
        setMessagesByTab(dropClosed);
        setStreamingByTab(dropClosed);
        setTokensByTab(dropClosed);
        setStreamingTabIds((prev) => {
            let changed = false;
            const next = new Set(prev);
            for (const id of [...prev]) if (!liveIds.has(id)) { next.delete(id); changed = true; }
            return changed ? next : prev;
        });
    }, [clearStreamWatchdog]);
    const clearTabStream = useCallback((tabId: string) => {
        clearStreamWatchdog(tabId);
        setMessagesByTab(prev => { const next = new Map(prev); next.delete(tabId); return next; });
        setStreamingByTab(prev => { const next = new Map(prev); next.delete(tabId); return next; });
        // "New chat" also zeroes this tab's token/cost counter.
        setTokensByTab(prev => { if (!prev.has(tabId)) return prev; const next = new Map(prev); next.delete(tabId); return next; });
        setStreamingTabIds(prev => {
            if (!prev.has(tabId)) return prev;
            const next = new Set(prev); next.delete(tabId); return next;
        });
    }, [clearStreamWatchdog]);

    return {
        messagesByTab, setMessagesByTab,
        streamingByTab, setStreamingByTab,
        streamingTabIds, setStreamingTabIds,
        streamingByTabRef, streamingTabIdsRef,
        messagesByTabRef,
        messages, streamingContent, isStreaming,
        setStreamingForTab, markStreaming, setStreamingContent, setIsStreaming, setMessages,
        armStreamWatchdog, clearStreamWatchdog,
        totalInputTokens, totalOutputTokens, totalCost,
        resetAllStreams, pruneStreams, clearTabStream,
    };
}
