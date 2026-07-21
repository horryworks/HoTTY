import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { tauriService } from '../services/tauriService';
import { usePaneStore } from '../stores/paneStore';
import { useSettingsStore } from '../stores/settingsStore';
import type { SessionRecord } from './useSessionManager';
import {
  getActiveTab,
  createDefaultAiChatState,
  tabHasSession,
  firstLinkedSessionId,
  type AiChatState,
  type ChatTab,
} from './useAiChat';
import type { SessionInfo } from '../types/appTypes';
import type { FeaturePaneInfo } from '../utils/paneTypes';
import { evaluateWatchPoll } from '../utils/aiCommandWatch';
import { parseLeadingSleep, clampDelay, syntheticDelayMessage, type SleepDelayParse } from '../utils/aiCommandDelay';
import { sessionBindingKey } from '../utils/sessionBindingKey';
import { redactSecrets } from '../utils/redaction';
import { selectAutoRebinds, type RebindSession, type RebindOrphanTab } from '../utils/autoRebind';
import { decideWatchToggle } from '../utils/watchRouting';
import { notConnectedNote } from '../components/AIChatPane/terminalOutputUtils';
import { IS_TAURI } from '../utils/windowLabel';

// Diagnostic logger for the AI command-execution pipeline.
// Mirrors to console.debug for live inspection in DevTools and to the Rust log
// file via tauriService.logDebug for post-mortem review of "result was cut off"
// reproductions. Failures from logDebug must never break the calling flow.
function aiExecLog(level: 'info' | 'warn', event: string, data: Record<string, unknown>): void {
  try {
    const message = `${event} ${JSON.stringify(data)}`;
    (level === 'warn' ? console.warn : console.debug)(`[AIExec/${level}] ${message}`);
    tauriService.logDebug(level, 'AIExec', message)?.catch(() => {});
  } catch {
    /* logging must never throw into caller */
  }
}

function trimCmdForLog(cmd: string): string {
  return cmd.length > 120 ? `${cmd.slice(0, 120)}...` : cmd;
}

/**
 * The subset of the useAiChat API that the orchestrator drives. Kept as a
 * narrow contract so App wires exactly what the watch/command lifecycle needs
 * (message queueing, tab links, tab lifecycle) and nothing more.
 */
export interface OrchestratorAiChatApi {
  aiChatStates: Map<string, AiChatState>;
  updateAiChatState: (aiSessionId: string, partial: Partial<AiChatState>) => void;
  updateTabById: (aiSessionId: string, tabId: string, partial: Partial<ChatTab>) => void;
  enqueuePendingMessage: (aiSessionId: string, tabId: string, message: string) => void;
  addTab: (aiSessionId: string, initialLinkSessionId?: string) => string;
  closeTab: (aiSessionId: string, tabId: string) => void;
  setActiveTab: (aiSessionId: string, tabId: string) => void;
  addTabLink: (aiSessionId: string, tabId: string, sessionId: string) => void;
  removeTabLink: (aiSessionId: string, tabId: string, sessionId: string) => void;
  rebindTabLink: (aiSessionId: string, tabId: string, bindingKey: string, newSessionId: string) => void;
}

export interface UseAiOrchestratorOptions {
  /** Live session map for this window (drives run/link liveness guards). */
  sessions: Map<string, SessionRecord>;
  /** Feature panes map (used to detect whether an AI Chat pane is open). */
  featurePanes: Map<string, FeaturePaneInfo>;
  /** The terminal the user last focused (mirrors selection into AI Chat tabs). */
  lastTerminalSessionId: string | null;
  setActivePaneId: (id: string) => void;
  /** Create-or-focus the singleton AI Chat pane; returns its pane id. */
  createAiChatPane: () => string | undefined;
  /** One-time AI data-sharing consent gate (from useAiConsent). */
  ensureConsent: () => Promise<boolean>;
  aiChat: OrchestratorAiChatApi;
}

export interface UseAiOrchestratorReturn {
  /** Active tab's linked session — drives the upper TabBar "watching" indicator. */
  watchingSessionId: string | null;
  setWatchingSessionId: Dispatch<SetStateAction<string | null>>;
  /** Union of every tab's link across all panes (what capture is keyed on). */
  watchingSessionIdsRef: RefObject<Set<string>>;
  /** This window's own + other windows' live sessions, for the link picker. */
  crossWindowSessions: SessionInfo[];
  refreshCrossWindowSessions: () => void;
  /** Session-removal cleanup — wire into useSessionManager's onSessionRemoved. */
  handleSessionRemoved: (id: string) => void;
  /** Close/unlink every AI tab linked to a session (manual terminal close path). */
  removeAiChatTabsForSession: (id: string) => void;
  /** "AI Monitor" TabBar toggle (consent-gated). */
  toggleWatch: (sessionId?: string) => void;
  /** Open (or focus) the singleton AI Chat pane. */
  openAiChatPane: () => void;
  /** Run an AI-issued command against a target session (funnels sleep + watch). */
  onRunCommand: (targetId: string, cmd: string, originatingTabId: string, paneId: string) => void;
  /** Clear a pane's active poll intervals + pending sleep-delay timers. */
  clearRunCommandIntervals: (paneId: string) => void;
}

/**
 * Owns the AI Chat watch/command-execution lifecycle: which terminals are being
 * captured, cross-window session discovery, the "AI Monitor" tab routing, and
 * the command runner (send + poll the watch buffer for completion, client-side
 * `sleep` delays). Extracted from App so this race-prone machinery is isolated
 * and unit-testable.
 */
export function useAiOrchestrator(options: UseAiOrchestratorOptions): UseAiOrchestratorReturn {
  const {
    sessions,
    featurePanes,
    lastTerminalSessionId,
    setActivePaneId,
    createAiChatPane,
    ensureConsent,
    aiChat,
  } = options;
  const { aiChatStates, enqueuePendingMessage, updateTabById } = aiChat;

  // Fresh mirror of `sessions` for callbacks that fire after a delay (the render-
  // closed `sessions` map is stale by the time a sleep-delay timer fires).
  const sessionsRef = useRef(sessions);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

  // AI Watch mode. The watch buffer itself lives in the backend
  // (WatchBufferState), keyed by global session id, so any window's AI Chat can
  // read any window's session output (cross-window watch). The frontend only
  // tracks which sessions are linked and toggles capture via setWatching.
  const [watchingSessionId, setWatchingSessionId] = useState<string | null>(null);
  const watchingSessionIdRef = useRef(watchingSessionId);
  useEffect(() => { watchingSessionIdRef.current = watchingSessionId; }, [watchingSessionId]);

  // Set of every session linked from any tab in any AI Chat pane. Diffed in the
  // derived-links effect to enable/disable backend capture (setWatching), and
  // checked before polling so in-flight commands keep capturing across tab
  // switches.
  const watchingSessionIdsRef = useRef<Set<string>>(new Set());

  // Sessions across ALL windows (cross-window AI linking). `list_all_sessions`
  // is authoritative for existence + liveness (it only returns connected
  // sessions). Refreshed on a slow interval while an AI Chat pane is open, and
  // on demand when the link picker opens.
  const [crossWindowSessions, setCrossWindowSessions] = useState<SessionInfo[]>([]);
  // Mirror in a ref so the AI run/sleep guards can consult backend-truth session
  // liveness at fire time (after an await), not just at render time.
  const crossWindowSessionsRef = useRef(crossWindowSessions);
  useEffect(() => { crossWindowSessionsRef.current = crossWindowSessions; }, [crossWindowSessions]);
  const refreshCrossWindowSessions = useCallback(() => {
    if (!IS_TAURI) return;
    tauriService.listAllSessions().then(setCrossWindowSessions).catch(() => {});
  }, []);

  // Track active poll intervals from onRunCommand so they can be cleared when
  // the AI chat pane closes or the watched session disconnects.
  const runCommandIntervalsRef = useRef<Map<string, Set<ReturnType<typeof setInterval>>>>(new Map());
  // Track pending client-side sleep-delay timers (see scheduleSleepDelay), cleared
  // alongside the poll intervals when the pane closes or the app unmounts.
  const runCommandDelaysRef = useRef<Map<string, Set<ReturnType<typeof setTimeout>>>>(new Map());
  const clearRunCommandIntervals = useCallback((paneId: string) => {
    const set = runCommandIntervalsRef.current.get(paneId);
    if (set) {
      set.forEach((id) => clearInterval(id));
      runCommandIntervalsRef.current.delete(paneId);
    }
    const delays = runCommandDelaysRef.current.get(paneId);
    if (delays) {
      delays.forEach((id) => clearTimeout(id));
      runCommandDelaysRef.current.delete(paneId);
    }
  }, []);
  useEffect(() => {
    const intervals = runCommandIntervalsRef;
    const delays = runCommandDelaysRef;
    return () => {
      intervals.current.forEach((set) => set.forEach((id) => clearInterval(id)));
      intervals.current.clear();
      delays.current.forEach((set) => set.forEach((id) => clearTimeout(id)));
      delays.current.clear();
    };
  }, []);
  // Monotonic token to abort a stale sleep delay (New chat / newer command).
  const delayTokenRef = useRef(0);

  // Forward-refs into the useAiChat API. Accessed via refs so the callbacks
  // below stay stable and can run from event handlers / async timers that were
  // scheduled by an earlier render.
  const createAiChatPaneRef = useRef(createAiChatPane);
  const aiChatStatesRef = useRef(aiChatStates);
  const addTabLinkRef = useRef(aiChat.addTabLink);
  const removeTabLinkRef = useRef(aiChat.removeTabLink);
  const rebindTabLinkRef = useRef(aiChat.rebindTabLink);
  const updateAiChatStateRef = useRef(aiChat.updateAiChatState);
  const updateTabByIdRef = useRef(aiChat.updateTabById);
  const addTabRef = useRef(aiChat.addTab);
  const setActiveTabRef = useRef(aiChat.setActiveTab);
  const closeTabRef = useRef(aiChat.closeTab);
  // Mirror latest values every render (must precede the effects below that read
  // these refs, so a same-commit read sees the fresh values — matches the order
  // App relied on before extraction).
  useEffect(() => {
    createAiChatPaneRef.current = createAiChatPane;
    aiChatStatesRef.current = aiChatStates;
    addTabLinkRef.current = aiChat.addTabLink;
    removeTabLinkRef.current = aiChat.removeTabLink;
    rebindTabLinkRef.current = aiChat.rebindTabLink;
    updateAiChatStateRef.current = aiChat.updateAiChatState;
    updateTabByIdRef.current = aiChat.updateTabById;
    addTabRef.current = aiChat.addTab;
    setActiveTabRef.current = aiChat.setActiveTab;
    closeTabRef.current = aiChat.closeTab;
  });

  // Keep-stale on session removal (Phase 2): a watched terminal that goes away is
  // NOT dropped from any tab's watched set. Its entry is retained (greyed in the
  // UI, excluded from new drains/executes) so the per-entry binding key can
  // auto-rebind when a session to the same target reconnects, and the tab's
  // conversation is preserved. Explicit removal (chip ×, Watch toggle-off) is the
  // only path that drops an entry. Kept as a named no-op so App's manual-close
  // wiring and handleSessionRemoved stay stable.
  const removeAiChatTabsForSession = useCallback((sessionId: string) => {
    // Keep-stale: intentionally does not mutate tab state (see rationale above).
    void sessionId;
  }, []);

  const handleSessionRemoved = useCallback((id: string) => {
    usePaneStore.getState().removeSession(id);
    // Always evict this session's backend watch buffer — it can persist past
    // the currently-watched session if an AI pane was closed before the linked
    // terminal session was removed (the pane's close path only knew about
    // the live `watchingSessionId`, not stale entries from prior watches).
    void tauriService.setWatching(id, false, 0);
    if (watchingSessionIdRef.current === id) {
      setWatchingSessionId(null);
    }
    removeAiChatTabsForSession(id);
  }, [removeAiChatTabsForSession]);

  // When the user selects a terminal tab/pane, mirror the selection in AI Chat
  // by activating any tab that is linked to that terminal. If no tab is linked,
  // do nothing (don't auto-create — that would be too aggressive).
  // Reads aiChatStates via ref so this only fires on terminal selection change,
  // not on every chat-state mutation.
  useEffect(() => {
    const sid = lastTerminalSessionId;
    if (!sid) return;
    const states = aiChatStatesRef.current;
    if (!states) return;
    for (const [aiPaneId, state] of states.entries()) {
      const matchingTab: ChatTab | undefined = state.tabs.find((t: ChatTab) => tabHasSession(t, sid));
      if (!matchingTab) continue;
      // Focusing a watched terminal makes it that tab's default execute target
      // (used when the AI omits target= and several terminals are watched).
      if (matchingTab.lastFocusedWatchId !== sid) {
        updateTabByIdRef.current?.(aiPaneId, matchingTab.id, { lastFocusedWatchId: sid });
      }
      if (matchingTab.id !== state.activeTabId) {
        setActiveTabRef.current?.(aiPaneId, matchingTab.id);
      }
    }
  }, [lastTerminalSessionId]);

  // Re-derive on every aiChatStates change:
  //   - watchingSessionId: the active tab's link (drives the visual "watching"
  //     indicator on the upper TabBar).
  //   - watchingSessionIdsRef: the union of every tab's link across all panes,
  //     which is what onSessionData actually checks. This is a strict superset
  //     so that switching tabs does NOT stop capturing for the previously
  //     active terminal — important for in-flight `execute` commands to
  //     receive their output even after a tab switch.
  useEffect(() => {
    let activeDerived: string | null = null;
    const allLinked = new Set<string>();
    for (const state of aiChatStates.values()) {
      for (const tab of state.tabs) {
        for (const w of tab.linkedSessions) allLinked.add(w.sessionId);
      }
      const activePrimary = firstLinkedSessionId(getActiveTab(state));
      if (activePrimary && activeDerived === null) {
        activeDerived = activePrimary;
      }
    }
    // Toggle backend capture for sessions that became (un)linked. Only the diff
    // is acted on so an already-watched session's buffer is never reset by an
    // unrelated chat-state change (setWatching(true) starts a fresh buffer).
    const prev = watchingSessionIdsRef.current;
    const limit = useSettingsStore.getState().watchBufferLimit;
    for (const id of allLinked) {
      if (!prev.has(id)) void tauriService.setWatching(id, true, limit);
    }
    for (const id of prev) {
      if (!allLinked.has(id)) void tauriService.setWatching(id, false, 0);
    }
    watchingSessionIdsRef.current = allLinked;
    setWatchingSessionId((prevId) => (prevId === activeDerived ? prevId : activeDerived));
  }, [aiChatStates]);

  // Re-issue the buffer cap to already-watched sessions when the setting changes
  // (setWatching updates entry.limit on re-call). Without this, the new limit only
  // reached sessions linked AFTER the change.
  const watchBufferLimit = useSettingsStore((s) => s.watchBufferLimit);
  useEffect(() => {
    for (const id of watchingSessionIdsRef.current) {
      void tauriService.setWatching(id, true, watchBufferLimit);
    }
  }, [watchBufferLimit]);

  // Auto-rebind orphaned AI Chat tabs to a reconnected terminal. When a watched
  // session drops, its tab is unlinked but RETAINS its config-derived binding key
  // (linkBindingKey). When a session with that same key becomes connected again
  // (a reconnect mints a new session id), re-link the tab so the chat keeps
  // working without the user having to press Watch again. Keyed on `sessions`
  // because the connect transition is a sessions-map change. Unique-match gated
  // (see selectAutoRebinds) so ambiguous same-target cases fall back to manual.
  useEffect(() => {
    const connected: RebindSession[] = [];
    for (const rec of sessions.values()) {
      if (rec.status === 'connected') connected.push({ id: rec.id, key: sessionBindingKey(rec) });
    }
    if (connected.length === 0) return;

    const connectedIds = new Set(connected.map((s) => s.id));
    const states = aiChatStatesRef.current;
    const linkedIds = new Set<string>();
    // A tab may hold several watched terminals; each DEAD entry (its session id is
    // no longer connected) that still carries a binding key is an orphan awaiting
    // reconnect. Live entries are excluded as rebind targets to avoid double-links.
    const orphanTabs: RebindOrphanTab[] = [];
    for (const [paneId, st] of states.entries()) {
      for (const tab of st.tabs) {
        for (const w of tab.linkedSessions) {
          linkedIds.add(w.sessionId);
          if (!connectedIds.has(w.sessionId) && w.bindingKey) {
            orphanTabs.push({ paneId, tabId: tab.id, key: w.bindingKey });
          }
        }
      }
    }
    if (orphanTabs.length === 0) return;

    // Only rebind TO sessions nothing is already watching (avoid double-linking).
    const candidates = connected.filter((s) => !linkedIds.has(s.id));
    const rebinds = selectAutoRebinds(candidates, connected, orphanTabs);
    for (const r of rebinds) {
      // setWatching(true) in the derived-links effect gives the rebound session a
      // fresh buffer; don't clear here (would race an in-flight command's output).
      const key = connected.find((s) => s.id === r.sessionId)?.key;
      if (!key) continue;
      rebindTabLinkRef.current?.(r.paneId, r.tabId, key, r.sessionId);
      aiExecLog('info', 'auto-rebind', { paneId: r.paneId, tabId: r.tabId, sessionId: r.sessionId });
    }
  }, [sessions]);

  // Keep the cross-window session list fresh while an AI Chat pane is open, so
  // the link picker and remote-link liveness track other windows' connects.
  useEffect(() => {
    if (!IS_TAURI) return;
    const hasAiPane = Array.from(featurePanes.values()).some((p) => p.type === 'ai-chat');
    if (!hasAiPane) return;
    refreshCrossWindowSessions();
    const iv = setInterval(refreshCrossWindowSessions, 4000);
    return () => clearInterval(iv);
  }, [featurePanes, refreshCrossWindowSessions]);

  // Reset watch state when the watched session is disconnected (locally or
  // remotely) so the watch buffer doesn't accumulate for a dead session.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    tauriService
      .onSessionStatus(({ sessionId, status }) => {
        if (status === 'disconnected' && watchingSessionIdRef.current === sessionId) {
          void tauriService.setWatching(sessionId, false, 0);
          setWatchingSessionId(null);
        }
      })
      .then((fn) => { unlisten = fn; })
      .catch(() => {});
    return () => { unlisten?.(); };
  }, []);

  // "AI Watch" toggle for the singleton AI Chat pane (Phase 2). Adds the terminal
  // to the ACTIVE tab's watched set, or removes it if already watched — so a chat
  // can watch several terminals at once. A separate conversation is still a
  // separate TAB (tab-strip "+"); this toggle never spawns one.
  const runToggleWatch = useCallback((sessionId: string) => {
    const aiPaneId = createAiChatPaneRef.current?.();
    if (!aiPaneId) return;

    // Always focus the AI Chat pane.
    const focusPane = () => {
      const alloc = usePaneStore.getState().paneAllocations;
      const paneEntry = Object.entries(alloc).find(([, sid]) => sid === aiPaneId);
      if (paneEntry) setActivePaneId(paneEntry[0]);
    };

    const state = aiChatStatesRef.current.get(aiPaneId);
    const toggle = decideWatchToggle(sessionId, getActiveTab(state));
    switch (toggle.action) {
      case 'create': {
        // Cold start: no state yet → seed a default tab watching this session.
        const session = sessions.get(sessionId);
        const seed = createDefaultAiChatState(sessionId, session?.displayName);
        updateAiChatStateRef.current?.(aiPaneId, seed);
        break;
      }
      case 'add':
        addTabLinkRef.current?.(aiPaneId, toggle.tabId, sessionId);
        break;
      case 'remove':
        removeTabLinkRef.current?.(aiPaneId, toggle.tabId, sessionId);
        break;
    }
    // NOTE: don't clear the backend buffer here — a fresh buffer for a newly
    // watched session is already provided by setWatching(true) in the
    // derived-links effect above, and clearing on every (re)link would wipe the
    // output of an in-flight auto-exec command on an already-watched session.
    focusPane();
  }, [sessions, setActivePaneId]);

  // Enabling Watch streams a terminal's output to the AI provider, so gate the
  // first activation on the same data-sharing consent as chat sends.
  const toggleWatch = useCallback((sessionId?: string) => {
    if (!sessionId) return;
    void ensureConsent().then((ok) => { if (ok) runToggleWatch(sessionId); });
  }, [ensureConsent, runToggleWatch]);

  // Open (or focus) the singleton AI Chat pane. Routes through createAiChatPane so
  // the Features menu can't spawn a SECOND AI pane — a duplicate would fight over
  // watch capture and get torn down when either one closes.
  const openAiChatPane = useCallback(() => {
    const id = createAiChatPaneRef.current?.();
    if (!id) return;
    const alloc = usePaneStore.getState().paneAllocations;
    const paneEntry = Object.entries(alloc).find(([, sid]) => sid === id);
    if (paneEntry) setActivePaneId(paneEntry[0]);
  }, [setActivePaneId]);

  // Send an AI-issued command to the device and poll its captured output for
  // completion (shell-prompt detection / idle / safety cap).
  const sendAndWatch = async (
    targetId: string,
    cmd: string,
    originatingTabId: string,
    paneId: string,
  ) => {
    // Start from a clean buffer so the poll captures ONLY this command's output.
    // The backend front-trims the buffer by bytes once it exceeds the limit, so
    // an absolute `startLen` index into a growing/trimmed buffer would mis-slice
    // (dropping or garbling the result); clearing makes `newContent` just the
    // whole buffer and removes all index math.
    await tauriService.clearWatchBuffer(targetId);
    const startLen = 0;

    // Send command lines to terminal. Split on CR as well as LF so the units
    // dispatched here match exactly the units the safety classifier scored — a
    // bare CR is Enter to the PTY, so it is a command boundary too.
    const lines = cmd.split(/\r\n|\r|\n/).map(l => l.trim()).filter(l => l.length > 0);
    aiExecLog('info', 'command-start', {
      cmd: trimCmdForLog(cmd),
      startLen,
      lines: lines.length,
      originatingTabId,
      watching: watchingSessionIdsRef.current.has(targetId),
    });
    let sendFailed = false;
    lines.forEach((line, index) => {
      setTimeout(() => {
        tauriService.sendInput(targetId, line + '\r').catch((err) => {
          // A reject here means the backend session is gone (e.g. it
          // died after our status check) — surface it instead of
          // letting the command vanish silently.
          if (sendFailed) return;
          sendFailed = true;
          aiExecLog('warn', 'send-input-failed', {
            cmd: trimCmdForLog(cmd),
            targetId,
            error: String(err),
            originatingTabId,
          });
          enqueuePendingMessage(paneId, originatingTabId,
            notConnectedNote(cmd, sessionsRef.current.get(targetId)?.status));
        });
      }, index * 150);
    });

    // Poll watch buffer for command completion (shell prompt detection).
    // Only polls if some tab is linked to this session, ie. its output
    // is being captured. Tab switches are fine — the originating tab id
    // is captured here so the result is delivered back to the right tab.
    if (watchingSessionIdsRef.current.has(targetId)) {
      const sendDuration = lines.length * 150;
      const idleSecs = useSettingsStore.getState().aiCommandIdleTimeoutSecs;
      const idleMs = idleSecs > 0 ? idleSecs * 1000 : 0;
      const SAFETY_CAP_MS = 30 * 60 * 1000; // 30 min hard ceiling
      let attempts = 0;
      let lastBufLen = startLen;
      let lastChangeAt = Date.now();
      const startedAt = Date.now();
      let set = runCommandIntervalsRef.current.get(paneId);
      if (!set) {
        set = new Set();
        runCommandIntervalsRef.current.set(paneId, set);
      }
      const intervalSet = set;
      let startLenWarned = false;
      aiExecLog('info', 'poll-begin', {
        cmd: trimCmdForLog(cmd),
        startLen,
        idleSecs,
        sendDuration,
        originatingTabId,
      });
      // The watch buffer lives in the backend now, so each poll reads it via an
      // async peek. `polling` guards against overlapping ticks if a read is
      // slow (the invoke round-trip should be well under the 200ms interval).
      let polling = false;
      const pollInterval = setInterval(() => {
        if (polling) return;
        polling = true;
        void (async () => {
          try {
            attempts++;
            // Bail out if the originating tab no longer exists (user closed it).
            const paneState = aiChatStatesRef.current.get(paneId);
            const originatingTab = paneState?.tabs.find(t => t.id === originatingTabId);
            if (!originatingTab) {
              aiExecLog('warn', 'originating-tab-gone', {
                cmd: trimCmdForLog(cmd),
                attempts,
                originatingTabId,
              });
              clearInterval(pollInterval);
              intervalSet.delete(pollInterval);
              return;
            }
            const buf = await tauriService.getWatchBuffer(targetId);
            if (!startLenWarned && startLen > buf.length) {
              startLenWarned = true;
              aiExecLog('warn', 'startlen-out-of-range', {
                cmd: trimCmdForLog(cmd),
                startLen,
                bufLen: buf.length,
              });
            }
            if (buf.length > lastBufLen) {
              lastBufLen = buf.length;
              lastChangeAt = Date.now();
            }
            const newContent = buf.substring(startLen);
            const now = Date.now();
            // Decide what to do this poll (prompt detection + timeout semantics
            // live in the pure, unit-tested helper). Note: the idle timeout
            // fires after idleMs of no new data even when newContent is empty —
            // a silent/hung device is the "no response" case it exists for.
            const result = evaluateWatchPoll({
              newContent,
              // Use wall-clock elapsed, not tick count: the reentrancy guard can
              // skip ticks (so attempts undercounts time), and the idle/safety
              // checks below already use wall-clock — keep them on one clock.
              attemptsMs: now - startedAt,
              sendWindowMs: sendDuration + 300,
              idleMs,
              msSinceLastChange: now - lastChangeAt,
              msSinceStart: now - startedAt,
              safetyCapMs: SAFETY_CAP_MS,
            });
            if (result.action === 'wait') return;
            if (result.action === 'prompt') {
              aiExecLog('info', 'prompt-match', {
                cmd: trimCmdForLog(cmd),
                attempts,
                bufLen: buf.length,
                newLen: newContent.length,
                matchedAtEnd: result.matchedAtEnd,
              });
              clearInterval(pollInterval);
              intervalSet.delete(pollInterval);
              void tauriService.clearWatchBuffer(targetId);
              // Redact secrets from the captured output before it egresses to the AI.
              const outputText = `Terminal Output (Command: ${cmd}):\n${redactSecrets(newContent.trim())}`;
              enqueuePendingMessage(paneId, originatingTabId, outputText);
            } else {
              // 'idle' or 'safety'
              const isIdle = result.action === 'idle';
              aiExecLog('warn', isIdle ? 'idle-timeout' : 'safety-cap', {
                cmd: trimCmdForLog(cmd),
                attempts,
                bufLen: buf.length,
                newLen: newContent.length,
                idleSecs,
              });
              clearInterval(pollInterval);
              intervalSet.delete(pollInterval);
              void tauriService.clearWatchBuffer(targetId);
              const reason = isIdle
                ? `[no response from device for ${idleSecs} seconds]`
                : `[command exceeded safety cap of 30 minutes]`;
              const captured = redactSecrets(newContent.trim());
              const outputText = `Terminal Output (Command: ${cmd}):\n${captured}\n${reason}`;
              enqueuePendingMessage(paneId, originatingTabId, outputText);
            }
          } finally {
            polling = false;
          }
        })();
      }, 200);
      intervalSet.add(pollInterval);
    }
  };

  // Run a leading `sleep N` as a CLIENT-SIDE delay instead of sending it to the
  // device. Avoids the watch idle-timeout mis-firing during a sleep. After the
  // wait: run any chained remainder via onRunCommandImpl (re-entry handles a
  // chained leading sleep too), or post a synthetic result so the AI continues.
  const scheduleSleepDelay = (
    targetId: string,
    cmd: string,
    parsed: SleepDelayParse,
    originatingTabId: string,
    paneId: string,
  ) => {
    const maxSecs = useSettingsStore.getState().aiSleepMaxDelaySecs;
    const { delayMs: clamped, wasClamped } = clampDelay(parsed.delayMs, maxSecs);
    const token = ++delayTokenRef.current;

    aiExecLog('info', 'sleep-delay-begin', {
      cmd: trimCmdForLog(cmd),
      delayMs: clamped,
      requestedMs: parsed.delayMs,
      wasClamped,
      hasRest: parsed.rest.length > 0,
      originatingTabId,
    });

    updateTabById(paneId, originatingTabId, {
      sleepDelay: { command: cmd, untilTs: Date.now() + clamped, wasClamped, token },
    });

    let delaySet = runCommandDelaysRef.current.get(paneId);
    if (!delaySet) {
      delaySet = new Set();
      runCommandDelaysRef.current.set(paneId, delaySet);
    }
    const set = delaySet;

    const timer = setTimeout(() => {
      set.delete(timer);
      // Abort if this delay was superseded (New chat / a newer command on the
      // same tab bumped the token) or the originating tab is gone.
      const paneState = aiChatStatesRef.current.get(paneId);
      const tab = paneState?.tabs.find(t => t.id === originatingTabId);
      if (!tab || tab.sleepDelay?.token !== token) {
        aiExecLog('warn', 'sleep-delay-aborted', {
          cmd: trimCmdForLog(cmd),
          originatingTabId,
          reason: !tab ? 'tab-gone' : 'superseded',
        });
        return;
      }
      // We own this fire — clear the waiting indicator.
      updateTabById(paneId, originatingTabId, { sleepDelay: null });

      // Re-validate the link/connection after the wait (state may have changed).
      // Accept a live remote session (owned by another window) too — see
      // onRunCommandImpl for why the local map alone is insufficient cross-window.
      const rec = sessionsRef.current.get(targetId);
      const isRemoteLive =
        !rec && crossWindowSessionsRef.current.some((cs) => cs.sessionId === targetId);
      const isLive = (!!rec && rec.status === 'connected') || isRemoteLive;
      const stillLinked = watchingSessionIdsRef.current.has(targetId);
      if (!isLive || !stillLinked) {
        aiExecLog('warn', 'sleep-delay-target-not-live', {
          cmd: trimCmdForLog(cmd),
          targetId,
          status: rec?.status ?? (isRemoteLive ? 'remote' : 'missing'),
          stillLinked,
          originatingTabId,
        });
        enqueuePendingMessage(paneId, originatingTabId,
          notConnectedNote(parsed.rest || cmd, rec?.status));
        return;
      }

      if (parsed.rest.length > 0) {
        aiExecLog('info', 'sleep-delay-fire-rest', {
          rest: trimCmdForLog(parsed.rest),
          clampedMs: clamped,
          wasClamped,
        });
        // Re-enter the decision so a chained leading sleep in `rest` is delayed too.
        onRunCommandImpl(targetId, parsed.rest, originatingTabId, paneId);
      } else {
        enqueuePendingMessage(paneId, originatingTabId,
          syntheticDelayMessage(cmd, clamped, parsed.delayMs, wasClamped));
      }
    }, clamped);
    set.add(timer);
  };

  // Single funnel for running an AI-issued command. Guards on a live session,
  // then either delays a leading `sleep` client-side or sends + watches.
  const onRunCommandImpl = (
    targetId: string,
    cmd: string,
    originatingTabId: string,
    paneId: string,
  ) => {
    // Backend-truth guard: never send to a target that isn't a live session.
    // A LOCAL session must be 'connected'. A REMOTE session (owned by another
    // window, linked via the cross-window picker) is not in this window's
    // `sessions` map, but `send_input`/the watch buffer are backend-global and
    // keyed by session id — so allow it when the backend reports it live in
    // `crossWindowSessions`. Without this, every cross-window AI command was
    // wrongly refused as "not connected".
    const targetRec = sessions.get(targetId);
    const isLocalConnected = !!targetRec && targetRec.status === 'connected';
    const isRemoteLive =
      !targetRec && crossWindowSessionsRef.current.some((cs) => cs.sessionId === targetId);
    if (!isLocalConnected && !isRemoteLive) {
      aiExecLog('warn', 'run-target-not-live', {
        cmd: trimCmdForLog(cmd),
        targetId,
        status: targetRec?.status ?? 'missing',
        originatingTabId,
      });
      enqueuePendingMessage(paneId, originatingTabId, notConnectedNote(cmd, targetRec?.status));
      return;
    }

    // Convert a leading `sleep N` into a client-side delay (when enabled).
    const asDelay = useSettingsStore.getState().aiSleepAsClientDelay;
    const parsed = asDelay ? parseLeadingSleep(cmd) : null;
    if (!parsed) {
      void sendAndWatch(targetId, cmd, originatingTabId, paneId);
      return;
    }
    scheduleSleepDelay(targetId, cmd, parsed, originatingTabId, paneId);
  };

  return {
    watchingSessionId,
    setWatchingSessionId,
    watchingSessionIdsRef,
    crossWindowSessions,
    refreshCrossWindowSessions,
    handleSessionRemoved,
    removeAiChatTabsForSession,
    toggleWatch,
    openAiChatPane,
    onRunCommand: onRunCommandImpl,
    clearRunCommandIntervals,
  };
}
