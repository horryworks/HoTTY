/**
 * Owns the AI-Chat pane's streaming state and the machinery around it, lifted out
 * of the AIChatPane god-component:
 *   - per-tab transcripts (`messagesByTab`) and per-tab in-flight partials
 *     (`streamingByTab`) / streaming flags (`streamingTabIds`),
 *   - the single `ai-chat-response` listener that routes chunk/done/error events
 *     to the owning tab,
 *   - the two-timer stream watchdog (idle + hard cap),
 *   - stream-completion detection.
 *
 * Instead of the pane diffing `streamingTabIds` itself to notice a finished
 * stream, this hook exposes an explicit `onStreamComplete(tabId, messages)`
 * callback (fired post-commit, so the final message is already in `messages`).
 * Token usage from a `done` event is surfaced via `onUsage`.
 *
 * The returned helpers deliberately keep the same names/shapes the pane used
 * locally (`setMessagesByTab`, `markStreaming`, `armStreamWatchdog`,
 * `streamingForTabIdRef`, …) so the pane's many mutation sites (send loop, new
 * chat, cancel, provider switch, logout, prune) need no changes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tauriService } from '../services/tauriService';
import { logError } from '../utils/logger';
import { calcAICost } from '../constants/aiPricing';
import { aiBackendSessionId } from './useAiChat';
import { streamTimeoutMessage, STREAM_IDLE_TIMEOUT_MS, STREAM_HARD_CAP_MS } from '../components/AIChatPane/streamWatchdog';

export interface ChatMessage {
    role: 'user' | 'model';
    content: string;
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
    // Which tab owns the in-flight stream (chunks route here across tab switches).
    const streamingForTabIdRef = useRef<string | null>(null);
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

    // Token accounting (from `done` events); priced against the model at completion.
    const [totalInputTokens, setTotalInputTokens] = useState(0);
    const [totalOutputTokens, setTotalOutputTokens] = useState(0);
    const [totalCost, setTotalCost] = useState<number | null>(null);
    const resetTokens = useCallback(() => {
        setTotalInputTokens(0);
        setTotalOutputTokens(0);
        setTotalCost(null);
    }, []);

    // ── Active-tab views + helpers ──
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

    // ── Watchdog (idle + hard cap) ──
    // idle: re-armed on every chunk; fires after silence. hard cap: armed once per
    // stream, not reset by chunks, so a runaway provider is still cancelled. Both
    // read the partial from a ref so this logic never depends on streamingByTab
    // state — keeping armStreamWatchdog stable (the listener subscribes once).
    const streamIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const streamHardCapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const clearStreamWatchdog = useCallback(() => {
        if (streamIdleTimerRef.current) { clearTimeout(streamIdleTimerRef.current); streamIdleTimerRef.current = null; }
        if (streamHardCapTimerRef.current) { clearTimeout(streamHardCapTimerRef.current); streamHardCapTimerRef.current = null; }
    }, []);
    const finalizeStuckStream = useCallback((ms: number, kind: 'idle' | 'hardcap') => {
        const targetTabId = streamingForTabIdRef.current;
        if (!targetTabId) return;
        tauriService.aiChatCancel(aiBackendSessionId(paneId, targetTabId)).catch(() => {});
        const partial = streamingByTabRef.current.get(targetTabId) ?? '';
        const reason = tRef.current(
            kind === 'idle' ? 'aiChat.pane.streamIdleTimeout' : 'aiChat.pane.streamHardcapTimeout',
            { seconds: Math.round(ms / 1000) },
        );
        const body = streamTimeoutMessage(partial, ms, kind, reason);
        setMessagesByTab(prev => {
            const next = new Map(prev);
            const cur = prev.get(targetTabId) ?? [];
            next.set(targetTabId, [...cur, { role: 'model', content: body }]);
            return next;
        });
        setStreamingForTab(targetTabId, '');
        markStreaming(targetTabId, false);
        streamingForTabIdRef.current = null;
        clearStreamWatchdog();
    }, [paneId, setStreamingForTab, markStreaming, clearStreamWatchdog]);
    const armStreamWatchdog = useCallback(() => {
        if (streamIdleTimerRef.current) clearTimeout(streamIdleTimerRef.current);
        streamIdleTimerRef.current = setTimeout(() => {
            streamIdleTimerRef.current = null;
            finalizeStuckStream(STREAM_IDLE_TIMEOUT_MS, 'idle');
        }, STREAM_IDLE_TIMEOUT_MS);
        if (!streamHardCapTimerRef.current) {
            streamHardCapTimerRef.current = setTimeout(() => {
                streamHardCapTimerRef.current = null;
                finalizeStuckStream(STREAM_HARD_CAP_MS, 'hardcap');
            }, STREAM_HARD_CAP_MS);
        }
    }, [finalizeStuckStream]);

    // ── Response listener (subscribed once for the pane's lifetime) ──
    useEffect(() => {
        let cancelled = false;
        let unlisten: (() => void) | undefined;

        tauriService.onAiChatResponse((data) => {
            if (cancelled) return;
            // Session ids are per-tab (`paneId::tabId`); accept any belonging to this
            // pane. The bare paneId is still accepted for back-compat.
            if (data.sessionId !== paneId && !data.sessionId.startsWith(`${paneId}::`)) return;
            const targetTabId = data.sessionId.startsWith(`${paneId}::`)
                ? data.sessionId.slice(paneId.length + 2)
                : streamingForTabIdRef.current;
            if (!targetTabId) return;
            // Drop late events for a tab that is no longer streaming.
            if (!streamingTabIdsRef.current.has(targetTabId)) return;

            if (data.responseType === 'chunk') {
                setStreamingForTab(targetTabId, prev => prev + data.content);
                armStreamWatchdog();
            } else if (data.responseType === 'done') {
                clearStreamWatchdog();
                setMessagesByTab(prev => {
                    const next = new Map(prev);
                    const cur = prev.get(targetTabId) ?? [];
                    next.set(targetTabId, [...cur, { role: 'model', content: data.content }]);
                    return next;
                });
                setStreamingForTab(targetTabId, '');
                markStreaming(targetTabId, false);
                if (streamingForTabIdRef.current === targetTabId) streamingForTabIdRef.current = null;
                if (data.usageMetadata) {
                    const inTokens = data.usageMetadata.promptTokenCount || 0;
                    const outTokens = data.usageMetadata.candidatesTokenCount || 0;
                    setTotalInputTokens(prev => prev + inTokens);
                    setTotalOutputTokens(prev => prev + outTokens);
                    const responseCost = calcAICost(inTokens, outTokens, selectedModelRef.current);
                    if (responseCost !== null) setTotalCost(prev => (prev ?? 0) + responseCost);
                }
            } else if (data.responseType === 'error') {
                clearStreamWatchdog();
                setMessagesByTab(prev => {
                    const next = new Map(prev);
                    const cur = prev.get(targetTabId) ?? [];
                    next.set(targetTabId, [...cur, { role: 'model', content: tRef.current('aiChat.pane.errorMessage', { message: data.content }) }]);
                    return next;
                });
                setStreamingForTab(targetTabId, '');
                markStreaming(targetTabId, false);
                if (streamingForTabIdRef.current === targetTabId) streamingForTabIdRef.current = null;
            }
        }).then(fn => {
            if (cancelled) { fn(); } else { unlisten = fn; }
        }).catch(e => logError('AI', 'Response listener setup failed', e));

        return () => { cancelled = true; unlisten?.(); clearStreamWatchdog(); };
    }, [paneId, selectedModelRef, setStreamingForTab, markStreaming, armStreamWatchdog, clearStreamWatchdog]);

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
        clearStreamWatchdog();
        setMessagesByTab(new Map());
        setStreamingByTab(new Map());
        setStreamingTabIds(new Set());
        streamingForTabIdRef.current = null;
        resetTokens();
    }, [clearStreamWatchdog, resetTokens]);
    const pruneStreams = useCallback((liveIds: Set<string>) => {
        const dropClosed = <T,>(prev: Map<string, T>): Map<string, T> => {
            let changed = false;
            const next = new Map(prev);
            for (const id of [...next.keys()]) if (!liveIds.has(id)) { next.delete(id); changed = true; }
            return changed ? next : prev;
        };
        setMessagesByTab(dropClosed);
        setStreamingByTab(dropClosed);
        setStreamingTabIds((prev) => {
            let changed = false;
            const next = new Set(prev);
            for (const id of [...prev]) if (!liveIds.has(id)) { next.delete(id); changed = true; }
            return changed ? next : prev;
        });
    }, []);
    const clearTabStream = useCallback((tabId: string) => {
        if (streamingForTabIdRef.current === tabId) clearStreamWatchdog();
        setMessagesByTab(prev => { const next = new Map(prev); next.delete(tabId); return next; });
        setStreamingByTab(prev => { const next = new Map(prev); next.delete(tabId); return next; });
        setStreamingTabIds(prev => {
            if (!prev.has(tabId)) return prev;
            const next = new Set(prev); next.delete(tabId); return next;
        });
        if (streamingForTabIdRef.current === tabId) streamingForTabIdRef.current = null;
    }, [clearStreamWatchdog]);

    return {
        messagesByTab, setMessagesByTab,
        streamingByTab, setStreamingByTab,
        streamingTabIds, setStreamingTabIds,
        streamingByTabRef, streamingTabIdsRef, streamingForTabIdRef,
        messagesByTabRef,
        messages, streamingContent, isStreaming,
        setStreamingForTab, markStreaming, setStreamingContent, setIsStreaming, setMessages,
        armStreamWatchdog, clearStreamWatchdog,
        totalInputTokens, totalOutputTokens, totalCost, resetTokens,
        resetAllStreams, pruneStreams, clearTabStream,
    };
}
