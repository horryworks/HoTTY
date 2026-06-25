import { useCallback, useEffect, useRef, useState } from 'react';
import { GridLayout } from './components/GridLayout/GridLayout';
import { Sidebar } from './components/Sidebar/Sidebar';
import { sidebarPaneId } from './components/Sidebar/sidebarHelpers';
import { AppSidebar } from './components/AppSidebar/AppSidebar';
import { TabBar } from './components/TabBar/TabBar';
import { buildTabItems } from './components/TabBar/tabBarHelpers';
import { TerminalView } from './components/Terminal/Terminal';
import { ConnectingOverlay } from './components/ConnectingOverlay/ConnectingOverlay';
import { LogViewerPane } from './components/LogViewerPane/LogViewerPane';
import { TextEditorPane } from './components/TextEditorPane/TextEditorPane';
import { FileExplorerPane } from './components/FileExplorerPane/FileExplorerPane';
import { PingMonitorPane } from './components/PingMonitorPane/PingMonitorPane';
import { FileServerPane } from './components/FileServerPane/FileServerPane';
import { AIChatPane } from './components/AIChatPane/AIChatPane';
import { AskAiModal } from './components/AskAiModal/AskAiModal';
import { SessionDialog, type ConnectSubmitPayload } from './components/SessionDialog/SessionDialog';
import { SaveToHostTreeDialog } from './components/SaveToHostTreeDialog/SaveToHostTreeDialog';
import { SettingsModal } from './components/SettingsModal/SettingsModal';
import { CustomThemeCreator } from './components/CustomThemeCreator/CustomThemeCreator';
import { HelpModal } from './components/HelpModal/HelpModal';
import { SshHostKeyModal } from './components/SshHostKeyModal/SshHostKeyModal';
import { IapVmStartModal } from './components/IapVmStartModal/IapVmStartModal';
import { PasteConfirmationModal } from './components/PasteConfirmationModal/PasteConfirmationModal';
import { UpdateNotification } from './components/UpdateNotification/UpdateNotification';
import { ErrorNotification } from './components/ErrorNotification/ErrorNotification';
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary';
import { tauriService } from './services/tauriService';
import { useSessionManager, type SessionRecord } from './hooks/useSessionManager';
import { useAiChat, getActiveTab, createDefaultAiChatState, type AiChatState } from './hooks/useAiChat';
import { usePaneStore, gridPaneIds, SIDEBAR_PANE_IDS } from './stores/paneStore';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from './stores/settingsStore';
import i18n from './i18n';
import { applyTheme } from './utils/applyTheme';
import { DEFAULT_THEMES, isBuiltInThemeId } from './themes/defaults';
import { useThemes } from './hooks/useThemes';
import { usePaneKeyboardNav } from './hooks/usePaneKeyboardNav';
import {
  makeFeaturePaneId,
  getPaneContentType,
  isFeaturePane,
  getFeatureDisplayName,
  type FeaturePaneInfo,
  type FeaturePaneType,
} from './utils/paneTypes';
import { stripAnsiCodes } from './utils/ansiUtils';
import { totalDirtyEditors } from './utils/dirtyEditors';
import { evaluateWatchPoll } from './utils/aiCommandWatch';
import { parseLeadingSleep, clampDelay, syntheticDelayMessage, type SleepDelayParse } from './utils/aiCommandDelay';
import { sessionBindingKey } from './utils/sessionBindingKey';
import { selectAutoRebinds, type RebindSession, type RebindOrphanTab } from './utils/autoRebind';
import { decideWatchRouting } from './utils/watchRouting';
import { notConnectedNote } from './components/AIChatPane/terminalOutputUtils';
import './App.css';

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

function App() {
  const [pasteReq, setPasteReq] = useState<{ sessionId: string; content: string } | null>(null);
  const [featurePanes, setFeaturePanes] = useState<Map<string, FeaturePaneInfo>>(new Map());

  const handlePasteRequest = useCallback(async (sessionId: string) => {
    try {
      const content = await tauriService.readClipboard();
      if (!content) return;
      setPasteReq({ sessionId, content });
    } catch {
      /* ignore — clipboard read can fail on empty/unsupported content */
    }
  }, []);

  // Close (or unlink, if last) any AI Chat tabs linked to this session across
  // all AI panes. Used by both the auto-close (handleSessionRemoved) and the
  // manual-close (handleCloseTab) paths so the two stay in sync.
  const removeAiChatTabsForSession = useCallback((sessionId: string) => {
    const states = aiChatStatesRef.current;
    if (!states) return;
    for (const [aiPaneId, st] of states.entries()) {
      for (const tab of st.tabs) {
        if (tab.linkedSessionId !== sessionId) continue;
        if (st.tabs.length <= 1) {
          // Last tab in the pane — unlink only so the pane keeps a usable tab.
          // Retain the binding key so a reconnect to the same target can
          // auto-rebind this tab (see the reconnect effect below).
          setTabLinkRef.current?.(aiPaneId, tab.id, undefined, { retainBindingKey: true });
        } else {
          closeTabRef.current?.(aiPaneId, tab.id);
        }
      }
    }
  }, []);

  const handleSessionRemoved = useCallback((id: string) => {
    usePaneStore.getState().removeSession(id);
    // Always evict this session's watch buffer — it can persist past the
    // currently-watched session if an AI pane was closed before the linked
    // terminal session was removed (the pane's close path only knew about
    // the live `watchingSessionId`, not stale entries from prior watches).
    watchBuffers.current.delete(id);
    if (watchingSessionIdRef.current === id) {
      setWatchingSessionId(null);
    }
    removeAiChatTabsForSession(id);
  }, [removeAiChatTabsForSession]);
  const { sessions, openSession, closeSession } = useSessionManager({
    onPasteRequest: handlePasteRequest,
    onSessionRemoved: handleSessionRemoved,
  });
  // Fresh mirror of `sessions` for callbacks that fire after a delay (the render-
  // closed `sessions` Map is stale by the time a sleep-delay timer fires).
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  const layoutMode = usePaneStore((s) => s.layoutMode);
  const activePaneId = usePaneStore((s) => s.activePaneId);
  const setActivePaneId = usePaneStore((s) => s.setActivePaneId);
  const paneAllocations = usePaneStore((s) => s.paneAllocations);
  const sessionOrder = usePaneStore((s) => s.sessionOrder);
  const addSessionToStore = usePaneStore((s) => s.addSession);
  const removeSessionFromStore = usePaneStore((s) => s.removeSession);
  const reorderSessionInStore = usePaneStore((s) => s.reorderSession);
  const moveSessionToPane = usePaneStore((s) => s.moveSessionToPane);

  // Ctrl+Tab / Ctrl+Shift+Tab cycle keyboard focus between visible panes.
  usePaneKeyboardNav();

  const { t } = useTranslation();
  const language = useSettingsStore((s) => s.language);
  const themeId = useSettingsStore((s) => s.theme);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const fontFamily = useSettingsStore((s) => s.fontFamily);
  const sidebarPosition = useSettingsStore((s) => s.sidebarPosition);
  const enabledFeatures = useSettingsStore((s) => s.enabledFeatures);
  const updateSetting = useSettingsStore((s) => s.update);

  const aiPersonas = useSettingsStore((s) => s.aiPersonas);

  // Track last known terminal session for AI targeting
  const [lastTerminalSessionId, setLastTerminalSessionId] = useState<string | null>(null);

  // Briefly flash the pane bound to a session, used when the user clicks an AI
  // Chat tab so the linked terminal pane is visually identified.
  const [flashedSessionId, setFlashedSessionId] = useState<string | null>(null);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashSessionPane = useCallback((sessionId: string) => {
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    // Toggle off first so a re-click on the same tab restarts the animation.
    setFlashedSessionId(null);
    requestAnimationFrame(() => {
      setFlashedSessionId(sessionId);
      flashTimeoutRef.current = setTimeout(() => {
        setFlashedSessionId(null);
        flashTimeoutRef.current = null;
      }, 600);
    });
  }, []);
  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    };
  }, []);

  const activePaneAllocation = paneAllocations[activePaneId];
  useEffect(() => {
    if (activePaneAllocation && !isFeaturePane(activePaneAllocation)) {
      setLastTerminalSessionId(activePaneAllocation);
    }
  }, [activePaneAllocation]);

  // When the user selects a terminal tab/pane, mirror the selection in AI Chat
  // by activating any tab that is linked to that terminal. If no tab is linked,
  // do nothing (don't auto-create — that would be too aggressive).
  // Reads aiChatStates via ref so this only fires on terminal selection change,
  // not on every chat-state mutation.
  useEffect(() => {
    if (!lastTerminalSessionId) return;
    const states = aiChatStatesRef.current;
    if (!states) return;
    for (const [aiPaneId, state] of states.entries()) {
      const matchingTab = state.tabs.find(t => t.linkedSessionId === lastTerminalSessionId);
      if (matchingTab && matchingTab.id !== state.activeTabId) {
        setActiveTabRef.current?.(aiPaneId, matchingTab.id);
      }
    }
  }, [lastTerminalSessionId]);

  // AI Watch mode
  const [watchingSessionId, setWatchingSessionId] = useState<string | null>(null);
  const watchBuffers = useRef(new Map<string, string>());
  const getWatchBuffer = useCallback((sid: string) => watchBuffers.current.get(sid) || '', []);
  const clearWatchBuffer = useCallback((sid: string) => { watchBuffers.current.delete(sid); }, []);

  const watchingSessionIdRef = useRef(watchingSessionId);
  useEffect(() => { watchingSessionIdRef.current = watchingSessionId; }, [watchingSessionId]);

  // Set of every session linked from any tab in any AI Chat pane.
  // Used by onSessionData to keep capturing into watchBuffers regardless of
  // which tab is currently active — this prevents in-flight commands from
  // losing their output when the user switches tabs mid-execution.
  const watchingSessionIdsRef = useRef<Set<string>>(new Set());

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

  const createAiChatPaneRef = useRef<() => string | undefined>(undefined);
  const aiChatStatesRef = useRef<Map<string, AiChatState>>(new Map());
  const setTabLinkRef = useRef<(aiSessionId: string, tabId: string, linkedSessionId: string | undefined, opts?: { retainBindingKey?: boolean }) => void>(undefined);
  const updateAiChatStateRef = useRef<(aiSessionId: string, partial: Partial<AiChatState>) => void>(undefined);
  const addTabRef = useRef<(aiSessionId: string, initialLinkSessionId?: string) => string>(undefined);
  const setActiveTabRef = useRef<(aiSessionId: string, tabId: string) => void>(undefined);
  const closeTabRef = useRef<(aiSessionId: string, tabId: string) => void>(undefined);

  // "AI Monitor" toggle for the singleton AI Chat pane. Smart tab routing:
  //   1. Some tab is already linked to this session
  //        - that tab is active        → unlink it (toggle off)
  //        - that tab is not active    → switch to it
  //   2. Active tab has no link        → link it to this session (in-place)
  //   3. Active tab has a different link → create a new tab linked to this session
  // This way, AI Monitor on multiple terminals naturally produces one tab per
  // terminal without overwriting existing links.
  const toggleWatch = useCallback((sessionId?: string) => {
    if (!sessionId) return;
    const aiPaneId = createAiChatPaneRef.current?.();
    if (!aiPaneId) return;

    // Always focus the AI Chat pane.
    const focusPane = () => {
      const alloc = usePaneStore.getState().paneAllocations;
      const paneEntry = Object.entries(alloc).find(([, sid]) => sid === aiPaneId);
      if (paneEntry) setActivePaneId(paneEntry[0]);
    };

    const state = aiChatStatesRef.current.get(aiPaneId);
    const session = sessions.get(sessionId);

    // Cold start: no state yet → seed with default tab linked to this session.
    if (!state) {
      const seed = createDefaultAiChatState(sessionId, session?.displayName);
      updateAiChatStateRef.current?.(aiPaneId, seed);
      watchBuffers.current.set(sessionId, '');
      focusPane();
      return;
    }

    // Route the watched session onto a tab. A link to a session that is gone or
    // not connected (e.g. the watched SSH dropped) is treated like "no link", so
    // the active tab relinks in place instead of spawning a confusing second tab
    // still pointed at the dead session (see decideWatchRouting).
    const isLive = (id: string) => sessions.get(id)?.status === 'connected';
    const routing = decideWatchRouting(sessionId, state.tabs, state.activeTabId, isLive);
    switch (routing.action) {
      case 'unlink':
        setTabLinkRef.current?.(aiPaneId, routing.tabId, undefined);
        watchBuffers.current.delete(sessionId);
        focusPane();
        return;
      case 'switch':
        setActiveTabRef.current?.(aiPaneId, routing.tabId);
        focusPane();
        return;
      case 'relink':
        if (routing.evictSessionId) watchBuffers.current.delete(routing.evictSessionId);
        setTabLinkRef.current?.(aiPaneId, routing.tabId, sessionId);
        break;
      case 'new-tab':
        addTabRef.current?.(aiPaneId, sessionId);
        break;
    }
    watchBuffers.current.set(sessionId, '');
    focusPane();
  }, [sessions, setActivePaneId]);

  // Capture terminal data into watch buffers for every session that any tab
  // is linked to (so a tab switch does not drop data for in-flight commands).
  useEffect(() => {
    let cancelled = false;
    const unlistenPromise = tauriService.onSessionData(({ sessionId, data }) => {
      if (cancelled) return;
      if (!watchingSessionIdsRef.current.has(sessionId)) return;
      const stripped = stripAnsiCodes(data);
      const current = watchBuffers.current.get(sessionId) || '';
      let newBuffer = current + stripped;
      const limit = useSettingsStore.getState().watchBufferLimit;
      if (newBuffer.length > limit) {
        const oldLen = newBuffer.length;
        newBuffer = newBuffer.substring(newBuffer.length - limit);
        aiExecLog('warn', 'buffer-trimmed', {
          sessionId,
          oldLen,
          limit,
          droppedBytes: oldLen - limit,
        });
      }
      watchBuffers.current.set(sessionId, newBuffer);
    });
    return () => {
      cancelled = true;
      unlistenPromise.then(fn => fn());
    };
  }, []);

  const createAiChatPane = useCallback((): string | undefined => {
    if (!useSettingsStore.getState().enabledFeatures['ai-chat']) return undefined;
    // Only allow one AI chat pane at a time
    const existing = Array.from(featurePanes.values()).find(p => p.type === 'ai-chat');
    if (existing) return existing.id;
    const id = makeFeaturePaneId('ai-chat');
    setFeaturePanes((prev) => {
      const next = new Map(prev);
      next.set(id, { id, type: 'ai-chat', displayName: 'AI Chat' });
      return next;
    });
    addSessionToStore(id);
    return id;
  }, [featurePanes, addSessionToStore]);

  const {
    aiChatStates,
    updateAiChatState,
    updateTabById,
    addTab,
    closeTab,
    setActiveTab,
    setTabLink,
    sendMessage: aiSendMessage,
    askAiFreeFormatData,
    setAskAiFreeFormatData,
    handleFreeFormatSubmit,
  } = useAiChat({
    sessions,
    featurePanes,
    aiPersonas,
    getWatchBuffer,
    clearWatchBuffer,
    createAiChatPane,
    lastTerminalSessionId,
    paneAllocations,
    activePaneId,
    setActivePaneId,
  });

  // Wire up refs (avoids circular dependency in toggleWatch / handleSessionRemoved)
  useEffect(() => {
    createAiChatPaneRef.current = createAiChatPane;
    updateAiChatStateRef.current = updateAiChatState;
    setTabLinkRef.current = setTabLink;
    addTabRef.current = addTab;
    setActiveTabRef.current = setActiveTab;
    closeTabRef.current = closeTab;
    aiChatStatesRef.current = aiChatStates;
  });

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
        if (tab.linkedSessionId) allLinked.add(tab.linkedSessionId);
      }
      const activeTab = getActiveTab(state);
      if (activeTab?.linkedSessionId && activeDerived === null) {
        activeDerived = activeTab.linkedSessionId;
      }
    }
    watchingSessionIdsRef.current = allLinked;
    setWatchingSessionId((prev) => (prev === activeDerived ? prev : activeDerived));
  }, [aiChatStates]);

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

    const states = aiChatStatesRef.current;
    const linkedIds = new Set<string>();
    const orphanTabs: RebindOrphanTab[] = [];
    for (const [paneId, st] of states.entries()) {
      for (const tab of st.tabs) {
        if (tab.linkedSessionId) linkedIds.add(tab.linkedSessionId);
        else if (tab.linkBindingKey) orphanTabs.push({ paneId, tabId: tab.id, key: tab.linkBindingKey });
      }
    }
    if (orphanTabs.length === 0) return;

    // Only rebind TO sessions nothing is already watching (avoid double-linking).
    const candidates = connected.filter((s) => !linkedIds.has(s.id));
    const rebinds = selectAutoRebinds(candidates, connected, orphanTabs);
    for (const r of rebinds) {
      watchBuffers.current.set(r.sessionId, '');
      setTabLinkRef.current?.(r.paneId, r.tabId, r.sessionId);
      aiExecLog('info', 'auto-rebind', { paneId: r.paneId, tabId: r.tabId, sessionId: r.sessionId });
    }
  }, [sessions]);

  const [connectOpen, setConnectOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [customThemeOpen, setCustomThemeOpen] = useState(false);
  const [saveToTreeSessionId, setSaveToTreeSessionId] = useState<string | null>(null);

  const saveToTreeSession = saveToTreeSessionId ? sessions.get(saveToTreeSessionId) : undefined;

  const { themesData, deleteTheme } = useThemes();

  // If the currently selected theme was deleted/missing, fall back to 'dark'.
  useEffect(() => {
    if (!(themeId in themesData) && !isBuiltInThemeId(themeId)) {
      updateSetting('theme', 'dark');
    }
  }, [themeId, themesData, updateSetting]);

  const handleDeleteTheme = useCallback(async (key: string) => {
    const result = await deleteTheme(key);
    if (result.success && themeId === key) {
      updateSetting('theme', 'dark');
    }
  }, [deleteTheme, themeId, updateSetting]);

  const handleCustomThemeSaved = useCallback((key: string) => {
    setCustomThemeOpen(false);
    updateSetting('theme', key);
  }, [updateSetting]);

  useEffect(() => {
    tauriService.getAppVersion().then((v) => {
      tauriService.setWindowTitle(`HoTTY v${v}`);
    }).catch(() => {});
  }, []);

  // Intercept window close when text editors have unsaved changes so the user
  // can confirm before losing work. The native ask dialog is used because the
  // in-app SaveConfirmModal is keyed per-pane/tab and doesn't cover global quit.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let closing = false;
    tauriService.onWindowCloseRequested(async (preventDefault) => {
      if (closing) return;
      const count = totalDirtyEditors();
      if (count === 0) return;
      preventDefault();
      const proceed = await tauriService.confirmDialog(
        count === 1
          ? 'You have 1 unsaved text editor tab. Close anyway and discard changes?'
          : `You have ${count} unsaved text editor tabs. Close anyway and discard changes?`,
        { title: 'Unsaved changes', okLabel: 'Discard & Quit', cancelLabel: 'Cancel' },
      );
      if (proceed) {
        closing = true;
        await tauriService.destroyWindow();
      }
    }).then((fn) => { unlisten = fn; }).catch(() => {});
    return () => { unlisten?.(); };
  }, []);

  // Reset watch state when the watched session is disconnected (locally or
  // remotely) so the watch buffer doesn't accumulate for a dead session.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    tauriService
      .onSessionStatus(({ sessionId, status }) => {
        if (status === 'disconnected' && watchingSessionIdRef.current === sessionId) {
          watchBuffers.current.delete(sessionId);
          setWatchingSessionId(null);
        }
      })
      .then((fn) => { unlisten = fn; })
      .catch(() => {});
    return () => { unlisten?.(); };
  }, []);

  // Apply the selected UI language app-wide. react-i18next re-renders every
  // useTranslation()/<Trans> consumer on changeLanguage — live, no reload.
  useEffect(() => {
    i18n.changeLanguage(language);
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    const theme = themesData[themeId] ?? DEFAULT_THEMES.dark;
    applyTheme(theme, fontSize, fontFamily);
    const store = useSettingsStore.getState();
    if (store.terminalForeground !== theme.terminal.foreground) {
      updateSetting('terminalForeground', theme.terminal.foreground);
    }
    if (store.terminalBackground !== theme.terminal.background) {
      updateSetting('terminalBackground', theme.terminal.background);
    }
    if (store.terminalBackgroundInactive !== theme.terminal.backgroundInactive) {
      updateSetting('terminalBackgroundInactive', theme.terminal.backgroundInactive);
    }
    if (store.paneBackground !== theme.terminal.paneBackground) {
      updateSetting('paneBackground', theme.terminal.paneBackground);
    }
  }, [themeId, fontSize, fontFamily, themesData, updateSetting]);

  const orderedSessions: SessionRecord[] = sessionOrder
    .map((id) => sessions.get(id))
    .filter((s): s is SessionRecord => !!s);

  const featurePanesList: FeaturePaneInfo[] = Array.from(featurePanes.values());

  const tabItems = buildTabItems(orderedSessions, featurePanesList, sessionOrder, watchingSessionId);

  const visibleTabIds: string[] = [
    ...gridPaneIds(layoutMode),
    ...SIDEBAR_PANE_IDS,
  ]
    .map((pid) => paneAllocations[pid])
    .filter((sid): sid is string => !!sid);

  const activeTabId: string | null = paneAllocations[activePaneId] ?? null;

  const handleNewConnectionClick = () => setConnectOpen(true);

  const handleConnectSubmit = (payload: ConnectSubmitPayload): string => {
    setConnectOpen(false);
    // openSession returns the id synchronously; the connect attempt runs in the
    // background. Adding the tab to the pane store now makes the connecting
    // state visible immediately, so the user gets feedback while the backend
    // negotiates the connection. The id is returned so SessionDialog can
    // watch the resulting session and clear the New Connection draft only on
    // a verified 'connected' status (auth failures preserve the form).
    const id = openSession(payload);
    addSessionToStore(id);
    return id;
  };

  const handleSelectTab = (id: string) => {
    const pid = Object.entries(paneAllocations).find(
      ([, sid]) => sid === id
    )?.[0];
    if (pid) setActivePaneId(pid);
  };

  const handleCloseTab = async (id: string) => {
    if (isFeaturePane(id)) {
      const type = getPaneContentType(id);
      if (type === 'ping-monitor') {
        tauriService.pingMonitorStop(id).catch(() => {});
      }
      if (type === 'ai-chat') {
        clearRunCommandIntervals(id);
        if (watchingSessionId) {
          watchBuffers.current.delete(watchingSessionId);
          setWatchingSessionId(null);
        }
      }
      setFeaturePanes((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      removeSessionFromStore(id);
    } else {
      if (watchingSessionId === id) {
        watchBuffers.current.delete(id);
        setWatchingSessionId(null);
      }
      await closeSession(id);
      removeAiChatTabsForSession(id);
      removeSessionFromStore(id);
    }
  };

  const handleNewFeaturePane = useCallback((type: FeaturePaneType) => {
    if (!useSettingsStore.getState().enabledFeatures[type]) return;
    const id = makeFeaturePaneId(type);
    const displayName = getFeatureDisplayName(type);
    setFeaturePanes((prev) => {
      const next = new Map(prev);
      next.set(id, { id, type, displayName });
      return next;
    });
    addSessionToStore(id, type === 'file-explorer' ? { preferSidebar: true } : undefined);
  }, [addSessionToStore]);

  const handleUpdateFeatureDisplayName = useCallback((id: string, displayName: string) => {
    setFeaturePanes((prev) => {
      const entry = prev.get(id);
      if (!entry) return prev;
      const next = new Map(prev);
      next.set(id, { ...entry, displayName });
      return next;
    });
  }, []);

  // Track initial file paths for text editors opened from file explorer
  const [editorInitialFiles, setEditorInitialFiles] = useState<Map<string, string>>(new Map());

  const handleOpenFileInEditor = useCallback(async (filePath: string) => {
    if (!useSettingsStore.getState().enabledFeatures['text-editor']) return;
    try {
      await tauriService.textEditorApproveDroppedFile(filePath);
    } catch { /* proceed — file may already be approved */ }

    // Try to find an existing text editor pane and open the file there
    const existingEditorId = Array.from(featurePanes.values()).find(
      (fp) => fp.type === 'text-editor',
    )?.id;

    if (existingEditorId) {
      // Route the file to the existing text editor's internal sub-tab
      const el = document.querySelector(`[data-pane-id="${existingEditorId}"]`) as
        | (HTMLElement & { __editorHandle?: { openFile: (path: string) => void } })
        | null;
      if (el?.__editorHandle) {
        el.__editorHandle.openFile(filePath);
        // Activate the editor pane
        const paneEntry = Object.entries(paneAllocations).find(
          ([, sid]) => sid === existingEditorId,
        );
        if (paneEntry) setActivePaneId(paneEntry[0]);
        return;
      }
    }

    // No existing editor — create a new one
    const id = makeFeaturePaneId('text-editor');
    const filename = filePath.split(/[\\/]/).pop() || 'Untitled';
    setFeaturePanes((prev) => {
      const next = new Map(prev);
      next.set(id, { id, type: 'text-editor', displayName: filename });
      return next;
    });
    setEditorInitialFiles((prev) => {
      const next = new Map(prev);
      next.set(id, filePath);
      return next;
    });
    addSessionToStore(id);
  }, [addSessionToStore, featurePanes, paneAllocations, setActivePaneId]);

  const handleDropSession = (sessionId: string, targetPaneId: string) => {
    moveSessionToPane(sessionId, targetPaneId);
  };

  // Send an AI-issued command to the device and poll its captured output for
  // completion (shell-prompt detection / idle / safety cap). Extracted from the
  // onRunCommand prop verbatim so a client-side sleep delay can invoke it either
  // immediately or after the wait. `paneId` was previously `featureInfo.id`.
  const sendAndWatch = (
    targetId: string,
    cmd: string,
    originatingTabId: string,
    paneId: string,
  ) => {
    // Record buffer position before sending command
    const startLen = (watchBuffers.current.get(targetId) || '').length;

    // Send command lines to terminal
    const lines = cmd.split('\n').map(l => l.trim()).filter(l => l.length > 0);
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
          updateTabById(paneId, originatingTabId, {
            pendingMessage: notConnectedNote(cmd, sessionsRef.current.get(targetId)?.status),
          });
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
      const pollInterval = setInterval(() => {
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
        const buf = watchBuffers.current.get(targetId) || '';
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
          attemptsMs: attempts * 200,
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
          clearWatchBuffer(targetId);
          const outputText = `Terminal Output (Command: ${cmd}):\n${newContent.trim()}`;
          updateTabById(paneId, originatingTabId, { pendingMessage: outputText });
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
          clearWatchBuffer(targetId);
          const reason = isIdle
            ? `[no response from device for ${idleSecs} seconds]`
            : `[command exceeded safety cap of 30 minutes]`;
          const captured = newContent.trim();
          const outputText = `Terminal Output (Command: ${cmd}):\n${captured}\n${reason}`;
          updateTabById(paneId, originatingTabId, { pendingMessage: outputText });
        }
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
      const rec = sessionsRef.current.get(targetId);
      const stillLinked = watchingSessionIdsRef.current.has(targetId);
      if (!rec || rec.status !== 'connected' || !stillLinked) {
        aiExecLog('warn', 'sleep-delay-target-not-live', {
          cmd: trimCmdForLog(cmd),
          targetId,
          status: rec?.status ?? 'missing',
          stillLinked,
          originatingTabId,
        });
        updateTabById(paneId, originatingTabId, {
          pendingMessage: notConnectedNote(parsed.rest || cmd, rec?.status),
        });
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
        updateTabById(paneId, originatingTabId, {
          pendingMessage: syntheticDelayMessage(cmd, clamped, parsed.delayMs, wasClamped),
        });
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
    // Backend-truth guard: never send to a target that isn't a live,
    // connected session. The AIChatPane caller already guards on status,
    // but this defends any other caller and keeps the failure loud
    // instead of a swallowed no-op.
    const targetRec = sessions.get(targetId);
    if (!targetRec || targetRec.status !== 'connected') {
      aiExecLog('warn', 'run-target-not-live', {
        cmd: trimCmdForLog(cmd),
        targetId,
        status: targetRec?.status ?? 'missing',
        originatingTabId,
      });
      updateTabById(paneId, originatingTabId, {
        pendingMessage: notConnectedNote(cmd, targetRec?.status),
      });
      return;
    }

    // Convert a leading `sleep N` into a client-side delay (when enabled).
    const asDelay = useSettingsStore.getState().aiSleepAsClientDelay;
    const parsed = asDelay ? parseLeadingSleep(cmd) : null;
    if (!parsed) {
      sendAndWatch(targetId, cmd, originatingTabId, paneId);
      return;
    }
    scheduleSleepDelay(targetId, cmd, parsed, originatingTabId, paneId);
  };

  const renderPane = (paneId: string) => {
    const sid = paneAllocations[paneId] ?? null;
    const contentType = sid ? getPaneContentType(sid) : null;
    const session = sid && contentType === 'session' ? sessions.get(sid) : undefined;
    const featureInfo = sid && contentType !== 'session' ? featurePanes.get(sid) : undefined;

    const isFlashed = !!sid && sid === flashedSessionId;
    return (
      <div
        className={`pane${paneId === activePaneId ? ' pane-active' : ''}${isFlashed ? ' pane-flash' : ''}`}
        onClick={() => setActivePaneId(paneId)}
      >
        <div className="pane-body">
          <ErrorBoundary
            fallback={(error, reset) => (
              <div className="pane-error" role="alert">
                <h3>{t('chrome.pane.crashed')}</h3>
                <p>{error.message || String(error)}</p>
                <button type="button" onClick={reset}>{t('common.retry')}</button>
              </div>
            )}
          >
          {session ? (
            session.status === 'connecting' ? (
              <ConnectingOverlay
                key={`${session.id}-connecting`}
                displayName={session.displayName}
              />
            ) : (
              <TerminalView
                key={session.id}
                session={session}
                active={paneId === activePaneId}
                onPasteRequest={handlePasteRequest}
              />
            )
          ) : featureInfo?.type === 'log-viewer' ? (
            <LogViewerPane
              key={featureInfo.id}
              paneId={featureInfo.id}
              active={paneId === activePaneId}
            />
          ) : featureInfo?.type === 'text-editor' ? (
            <TextEditorPane
              key={featureInfo.id}
              paneId={featureInfo.id}
              active={paneId === activePaneId}
              initialFilePath={editorInitialFiles.get(featureInfo.id)}
              onDisplayNameChange={(name) => handleUpdateFeatureDisplayName(featureInfo.id, name)}
            />
          ) : featureInfo?.type === 'file-explorer' ? (
            <FileExplorerPane
              key={featureInfo.id}
              paneId={featureInfo.id}
              active={paneId === activePaneId}
              onOpenFileInEditor={handleOpenFileInEditor}
            />
          ) : featureInfo?.type === 'ping-monitor' ? (
            <PingMonitorPane
              key={featureInfo.id}
              paneId={featureInfo.id}
              active={paneId === activePaneId}
            />
          ) : featureInfo?.type === 'file-server' ? (
            <FileServerPane
              key={featureInfo.id}
              paneId={featureInfo.id}
              active={paneId === activePaneId}
            />
          ) : featureInfo?.type === 'ai-chat' ? (
            <AIChatPane
              key={featureInfo.id}
              paneId={featureInfo.id}
              active={paneId === activePaneId}
              chatState={aiChatStates.get(featureInfo.id)}
              onChatStateChange={(newState) => updateAiChatState(featureInfo.id, newState)}
              onUpdateTabById={(tabId, partial) => updateTabById(featureInfo.id, tabId, partial)}
              onAddTab={(initialLink) => {
                const linkId = initialLink ?? lastTerminalSessionId ?? undefined;
                addTab(featureInfo.id, linkId);
              }}
              onCloseTab={(tabId) => closeTab(featureInfo.id, tabId)}
              onSelectTab={(tabId) => setActiveTab(featureInfo.id, tabId)}
              onFlashSessionPane={flashSessionPane}
              sessions={sessions}
              onRunCommand={(targetId, cmd, originatingTabId) =>
                onRunCommandImpl(targetId, cmd, originatingTabId, featureInfo.id)
              }
              onSendMessage={(text) => aiSendMessage(featureInfo.id, text)}
              aiPersonas={aiPersonas}
              terminalBackground={useSettingsStore.getState().terminalBackground}
            />
          ) : (
            <div className="pane-empty">
              {/^\d+$/.test(paneId) && (
                <span className="pane-label">{t('chrome.pane.label', { number: Number(paneId) + 1 })}</span>
              )}
              <span className="drop-hint">{t('chrome.pane.dropTabHere')}</span>
            </div>
          )}
          </ErrorBoundary>
        </div>
      </div>
    );
  };

  return (
    <div className="app-root">
      <div className={`app-container app-container-${sidebarPosition}`}>
        <AppSidebar onOpenSettings={() => setSettingsOpen(true)} onOpenHelp={() => setHelpOpen(true)} />
        <div className="main-layout">
          <TabBar
            tabItems={tabItems}
            activeTabId={activeTabId}
            visibleTabIds={visibleTabIds}
            onSelect={handleSelectTab}
            onClose={handleCloseTab}
            onNew={handleNewConnectionClick}
            onReorder={reorderSessionInStore}
            onToggleWatch={toggleWatch}
            onSaveToHostTree={(id) => setSaveToTreeSessionId(id)}
            onNewLogViewer={enabledFeatures['log-viewer'] ? () => handleNewFeaturePane('log-viewer') : undefined}
            onNewPingMonitor={enabledFeatures['ping-monitor'] ? () => handleNewFeaturePane('ping-monitor') : undefined}
            onNewTextEditor={enabledFeatures['text-editor'] ? () => handleNewFeaturePane('text-editor') : undefined}
            onNewFileExplorer={enabledFeatures['file-explorer'] ? () => handleNewFeaturePane('file-explorer') : undefined}
            onNewFileServer={enabledFeatures['file-server'] ? () => handleNewFeaturePane('file-server') : undefined}
            onNewAiChat={enabledFeatures['ai-chat'] ? () => handleNewFeaturePane('ai-chat') : undefined}
          />
          <div className="content-area">
            <Sidebar
              edge="left"
              onDropSession={(sid) => handleDropSession(sid, sidebarPaneId('left'))}
            >
              {renderPane(sidebarPaneId('left'))}
            </Sidebar>
            <div className="center-column">
              <Sidebar
                edge="top"
                onDropSession={(sid) => handleDropSession(sid, sidebarPaneId('top'))}
              >
                {renderPane(sidebarPaneId('top'))}
              </Sidebar>
              <GridLayout renderPane={renderPane} onDropSession={handleDropSession} />
              <Sidebar
                edge="bottom"
                onDropSession={(sid) => handleDropSession(sid, sidebarPaneId('bottom'))}
              >
                {renderPane(sidebarPaneId('bottom'))}
              </Sidebar>
            </div>
            <Sidebar
              edge="right"
              onDropSession={(sid) => handleDropSession(sid, sidebarPaneId('right'))}
            >
              {renderPane(sidebarPaneId('right'))}
            </Sidebar>
          </div>
        </div>
      </div>

      <SessionDialog
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onConnect={handleConnectSubmit}
        sessions={sessions}
      />
      <SaveToHostTreeDialog
        open={saveToTreeSessionId !== null}
        initialName={saveToTreeSession?.displayName ?? ''}
        protocol={saveToTreeSession?.protocol ?? null}
        config={saveToTreeSession?.connectionConfig}
        onClose={() => setSaveToTreeSessionId(null)}
      />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        themesData={themesData}
        onOpenCustomThemeCreator={() => setCustomThemeOpen(true)}
        onDeleteTheme={handleDeleteTheme}
      />
      <CustomThemeCreator
        isOpen={customThemeOpen}
        themesData={themesData}
        currentTheme={themeId}
        onSave={handleCustomThemeSaved}
        onCancel={() => setCustomThemeOpen(false)}
      />
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      <SshHostKeyModal />
      <IapVmStartModal />
      <UpdateNotification />
      <ErrorNotification />
      {pasteReq && (
        <PasteConfirmationModal
          content={pasteReq.content}
          onConfirm={() => {
            // Normalize CRLF/LF → CR so each pasted line produces one Enter,
            // not Enter + LF (which the remote shell echoes as a blank line).
            // Matches xterm.js's prepareTextForTerminal() behavior; we have to
            // do it ourselves because TerminalXtermHost suppresses xterm's
            // built-in paste handler to route through this modal.
            const normalized = pasteReq.content.replace(/\r\n|\n/g, '\r');
            tauriService.sendInput(pasteReq.sessionId, normalized).catch(() => {});
            const term = sessions.get(pasteReq.sessionId)?.term;
            setPasteReq(null);
            // Microtask: focus after React unmounts the modal so the now-removed
            // Paste button can't grab focus back, and the xterm helper textarea
            // is the live focus target.
            queueMicrotask(() => term?.focus());
          }}
          onCancel={() => {
            const term = sessions.get(pasteReq.sessionId)?.term;
            setPasteReq(null);
            queueMicrotask(() => term?.focus());
          }}
        />
      )}
      {askAiFreeFormatData && (
        <AskAiModal
          isOpen={true}
          selection={askAiFreeFormatData.selection}
          onClose={() => setAskAiFreeFormatData(null)}
          onSubmit={handleFreeFormatSubmit}
        />
      )}
    </div>
  );
}

export default App;
