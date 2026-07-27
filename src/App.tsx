import { useCallback, useEffect, useRef, useState } from 'react';
import { GridLayout } from './components/GridLayout/GridLayout';
import { Sidebar } from './components/Sidebar/Sidebar';
import { sidebarPaneId } from './components/Sidebar/sidebarHelpers';
import { AppSidebar } from './components/AppSidebar/AppSidebar';
import { TabBar } from './components/TabBar/TabBar';
import { buildTabItems, type ConversationSummary } from './components/TabBar/tabBarHelpers';
import { conversationColorIndex } from './utils/conversationColor';
import { TerminalView } from './components/Terminal/Terminal';
import { ConnectingOverlay } from './components/ConnectingOverlay/ConnectingOverlay';
import { LogViewerPane } from './components/LogViewerPane/LogViewerPane';
import { PingMonitorPane } from './components/PingMonitorPane/PingMonitorPane';
import { InterfaceTrafficPane } from './components/InterfaceTrafficPane/InterfaceTrafficPane';
import { FileServerPane } from './components/FileServerPane/FileServerPane';
import { WebBrowserPane } from './components/WebBrowserPane/WebBrowserPane';
import { AIChatPane } from './components/AIChatPane/AIChatPane';
import { SessionDialog, type ConnectSubmitPayload } from './components/SessionDialog/SessionDialog';
import { SaveToHostTreeDialog } from './components/SaveToHostTreeDialog/SaveToHostTreeDialog';
import { SettingsModal, type SettingsTab } from './components/SettingsModal/SettingsModal';
import { CustomThemeCreator } from './components/CustomThemeCreator/CustomThemeCreator';
import { HelpModal } from './components/HelpModal/HelpModal';
import { SshHostKeyModal } from './components/SshHostKeyModal/SshHostKeyModal';
import { IapVmStartModal } from './components/IapVmStartModal/IapVmStartModal';
import { PasteConfirmationModal } from './components/PasteConfirmationModal/PasteConfirmationModal';
import { AiConsentModal } from './components/AiConsentModal/AiConsentModal';
import { UpdateNotification } from './components/UpdateNotification/UpdateNotification';
import { ErrorNotification } from './components/ErrorNotification/ErrorNotification';
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary';
import { tauriService } from './services/tauriService';
import { useSessionManager, type SessionRecord } from './hooks/useSessionManager';
import { useHostManager, flattenHosts } from './hooks/useHostManager';
import { useAiAuthOwner } from './hooks/useAiAuthOwner';
import { useAiChat, getActiveTab } from './hooks/useAiChat';
import { useAiConsent } from './hooks/useAiConsent';
import { useAiOrchestrator } from './hooks/useAiOrchestrator';
import { usePaneStore, gridPaneIds, SIDEBAR_PANE_IDS } from './stores/paneStore';
import { initOverlayWatcher } from './stores/uiOverlayStore';
import { useWebBrowserBookmarkStore } from './stores/webBrowserBookmarkStore';
import { useWebBrowserZoomStore } from './stores/webBrowserZoomStore';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from './stores/settingsStore';
import i18n from './i18n';
import { applyTheme } from './utils/applyTheme';
import { DEFAULT_THEMES, isBuiltInThemeId } from './themes/defaults';
import { useThemes } from './hooks/useThemes';
import { usePaneKeyboardNav } from './hooks/usePaneKeyboardNav';
import { useNewWindowShortcut } from './hooks/useNewWindowShortcut';
import { initSharedStoreSync } from './stores/sharedStoreSync';
import { IS_TAURI, WINDOW_LABEL } from './utils/windowLabel';
import type { LinkableSession } from './types/appTypes';
import {
  makeFeaturePaneId,
  getPaneContentType,
  isFeaturePane,
  getFeatureDisplayName,
  type FeaturePaneInfo,
  type FeaturePaneType,
} from './utils/paneTypes';
import './App.css';

function App() {
  // Single per-window owner of the AI auth lifecycle (auto re-auth + event
  // mirroring into aiAuthStore). Panes and Settings only read the store.
  useAiAuthOwner();

  // One-time AI data-sharing consent gate. Constructed early because useAiChat
  // (below) and the AI orchestrator both need `ensureAiConsent`.
  const consent = useAiConsent();

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

  // Delegate so useSessionManager (constructed before the AI orchestrator) can
  // reach the orchestrator's session-removal cleanup. useSessionManager keeps
  // its own ref to onSessionRemoved and refreshes it every render, and removals
  // only happen well after mount — so a stable delegate forwarding to the
  // orchestrator (wired in an effect below) is sufficient.
  const handleSessionRemovedRef = useRef<(id: string) => void>(() => {});
  const onSessionRemoved = useCallback((id: string) => handleSessionRemovedRef.current(id), []);
  const { sessions, openSession, closeSession, setSessionFixedSize } = useSessionManager({
    onPasteRequest: handlePasteRequest,
    onSessionRemoved,
  });
  // Fresh mirror of `sessions` for event handlers that read it post-render (the
  // fixed-size toggle). Synced in an effect (not during render) so it doesn't
  // trip the refs-during-render lint.
  const sessionsRef = useRef(sessions);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

  // Host tree — used to persist a live fixed-size toggle back onto the host entry
  // a session was opened from. This instance shares state with the SessionDialog's
  // (useHostManager is multi-instance-safe and syncs across windows).
  const hostManager = useHostManager();

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
  // Ctrl+Shift+N opens a new HoTTY window in the same process.
  useNewWindowShortcut();

  // Keep shared stores (settings, bookmarks) in sync across windows. Returns a
  // disposer so StrictMode's double-mount doesn't leak duplicate listeners.
  // No-op outside Tauri (tests).
  useEffect(() => {
    if (!IS_TAURI) return;
    return initSharedStoreSync();
  }, []);

  const { t } = useTranslation();
  const language = useSettingsStore((s) => s.language);
  const themeId = useSettingsStore((s) => s.theme);
  const fontSize = useSettingsStore((s) => s.fontSize);
  // Subscribed (not a getState() snapshot) so a theme/background change re-renders
  // the AI Chat pane immediately instead of on the next unrelated App re-render.
  const terminalBackground = useSettingsStore((s) => s.terminalBackground);
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

  // Watch the DOM for modal/dropdown overlays so the Web Browser pane can hide
  // its native (OS-composited) webview when something must render over it.
  useEffect(() => {
    initOverlayWatcher();
  }, []);

  const activePaneAllocation = paneAllocations[activePaneId];
  useEffect(() => {
    if (activePaneAllocation && !isFeaturePane(activePaneAllocation)) {
      // "Last-seen terminal" is genuinely retained state — it must PERSIST when
      // the active pane becomes a non-terminal feature pane, so it can't be
      // derived during render (there is nothing to derive from at that point).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLastTerminalSessionId(activePaneAllocation);
    }
  }, [activePaneAllocation]);

  // Read-and-clear a session's backend watch buffer, handed to useAiChat for
  // chat sends that include the linked terminal's recent output.
  const takeWatchBuffer = useCallback(
    (sid: string) => tauriService.takeWatchBuffer(sid),
    [],
  );

  const createAiChatPane = useCallback((): string | undefined => {
    if (!useSettingsStore.getState().enabledFeatures['ai-chat']) return undefined;
    // Only allow one AI chat pane at a time
    const existing = Array.from(featurePanes.values()).find(p => p.type === 'ai-chat');
    if (existing) return existing.id;
    const id = makeFeaturePaneId('ai-chat');
    setFeaturePanes((prev) => {
      const next = new Map(prev);
      next.set(id, { id, type: 'ai-chat', displayName: getFeatureDisplayName('ai-chat') });
      return next;
    });
    addSessionToStore(id);
    return id;
  }, [featurePanes, addSessionToStore]);

  const {
    aiChatStates,
    updateAiChatState,
    updateTabById,
    enqueuePendingMessage,
    dequeuePendingMessage,
    enqueuePendingUserMessage,
    dequeuePendingUserMessage,
    addTab,
    closeTab,
    removeAiChatState,
    setActiveTab,
    addTabLink,
    removeTabLink,
    rebindTabLink,
    sendMessage: aiSendMessage,
    askAi,
  } = useAiChat({
    sessions,
    featurePanes,
    aiPersonas,
    takeWatchBuffer,
    ensureAiConsent: consent.ensureAiConsent,
    createAiChatPane,
    lastTerminalSessionId,
    paneAllocations,
    activePaneId,
    setActivePaneId,
  });

  // AI Chat watch/command-execution lifecycle: capture toggling, cross-window
  // session discovery, "AI Monitor" tab routing, and the command runner. Owns
  // the watch state + poll/sleep timers that App previously carried inline.
  const aiOrch = useAiOrchestrator({
    sessions,
    featurePanes,
    lastTerminalSessionId,
    setActivePaneId,
    createAiChatPane,
    ensureConsent: consent.ensureAiConsent,
    aiChat: {
      aiChatStates,
      updateAiChatState,
      updateTabById,
      enqueuePendingMessage,
      addTab,
      closeTab,
      setActiveTab,
      addTabLink,
      removeTabLink,
      rebindTabLink,
    },
  });
  const {
    watchingSessionId,
    setWatchingSessionId,
    watchingSessionIdsRef,
    watchedSessions,
    crossWindowSessions,
    refreshCrossWindowSessions,
    removeAiChatTabsForSession,
    toggleWatch,
    watchInConversation,
    openAiChatPane,
    clearRunCommandIntervals,
  } = aiOrch;

  // Forward the orchestrator's session-removal cleanup to the delegate ref that
  // useSessionManager (constructed earlier) invokes on session removal.
  useEffect(() => {
    handleSessionRemovedRef.current = aiOrch.handleSessionRemoved;
  }, [aiOrch.handleSessionRemoved]);

  const [connectOpen, setConnectOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab | undefined>(undefined);
  const openSettings = useCallback((tab?: SettingsTab) => {
    setSettingsInitialTab(tab);
    setSettingsOpen(true);
  }, []);
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

  // Sessions selectable in the AI Chat link picker: this window's own sessions
  // plus every other window's live sessions (cross-window AI linking).
  const linkableSessions: LinkableSession[] = [
    ...orderedSessions.map((s) => ({
      sessionId: s.id,
      displayName: s.displayName,
      ownerLabel: WINDOW_LABEL,
      isLocal: true,
      status: s.status,
    })),
    ...crossWindowSessions
      .filter((cs) => !!cs.ownerLabel && cs.ownerLabel !== WINDOW_LABEL)
      .map((cs) => ({
        sessionId: cs.sessionId,
        displayName: cs.host || cs.sessionId,
        ownerLabel: cs.ownerLabel as string,
        isLocal: false,
        status: 'connected',
      })),
  ];

  const featurePanesList: FeaturePaneInfo[] = Array.from(featurePanes.values());

  const tabItems = buildTabItems(orderedSessions, featurePanesList, sessionOrder, watchedSessions);

  // Conversations of the singleton AI Chat pane, for the terminal tab's "Watch in ▸"
  // picker. Titles are resolved here (with the "Tab N" fallback) so TabBar needs no
  // aiChat i18n; the color matches each conversation's tab and its watched terminals.
  const aiChatPaneId = featurePanesList.find((f) => f.type === 'ai-chat')?.id;
  const aiConversations: ConversationSummary[] = aiChatPaneId
    ? (aiChatStates.get(aiChatPaneId)?.tabs ?? []).map((tab) => ({
        id: tab.id,
        title: tab.title || t('aiChat.tabStrip.tabN', { n: tab.ordinal }),
        colorIndex: conversationColorIndex(tab.ordinal),
      }))
    : [];

  const visibleTabIds: string[] = [
    ...gridPaneIds(layoutMode),
    ...SIDEBAR_PANE_IDS,
  ]
    .map((pid) => paneAllocations[pid])
    .filter((sid): sid is string => !!sid);

  const activeTabId: string | null = paneAllocations[activePaneId] ?? null;

  const handleNewConnectionClick = () => setConnectOpen(true);

  const handleConnectSubmit = (payload: ConnectSubmitPayload): string => {
    // Start the connection but keep the dialog open and DON'T reveal a pane yet.
    // openSession returns the id synchronously and runs the connect in the
    // background; SessionDialog watches the resulting session and shows an
    // in-dialog "connecting" state. The pane is created only once the session
    // reaches 'connected' (handleSessionConnected) — a failed or cancelled
    // attempt never puts a tab in the grid. The id is returned so the dialog
    // can track this session's lifecycle.
    return openSession(payload);
  };

  // Called by SessionDialog once a dialog-initiated session is established:
  // reveal + activate its pane, close the dialog, and focus the terminal.
  // addSessionToStore already marks the new pane active; the queueMicrotask
  // focus is belt-and-suspenders alongside TerminalXtermHost's active-effect.
  const handleSessionConnected = (id: string) => {
    addSessionToStore(id);
    setConnectOpen(false);
    // The revealed pane's TerminalXtermHost opens + focuses the terminal via its
    // own mount effects; this extra focus is belt-and-suspenders and guarded
    // because the xterm may not be open()'d yet when the microtask runs.
    queueMicrotask(() => { try { sessions.get(id)?.term.focus(); } catch { /* not yet open — the pane's active-effect will focus it */ } });
  };

  // Called by SessionDialog when the user cancels an in-progress connection:
  // tear down the never-revealed session (disconnects the backend and cancels
  // any pending host-key prompt). The dialog stays open and editable.
  const handleCancelConnect = (id: string) => {
    void closeSession(id);
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
      if (type === 'interface-traffic') {
        // The SNMP poll loop lives in the backend, so closing the tab has to
        // tell it to stop or it keeps querying the device.
        tauriService.snmpWatcherStop(id).catch(() => {});
      }
      if (type === 'file-server') {
        // Policy: the File Server runs only while its tab is open. Closing the
        // tab tears down both servers and frees their ports.
        tauriService.fileServerTftpStop(id).catch(() => {});
        tauriService.fileServerSftpStop(id).catch(() => {});
      }
      if (type === 'web-browser') {
        // Destroy the embedded child webview so it doesn't leak (it is kept
        // alive across mere remounts, so closing the tab is the teardown point).
        tauriService.webBrowserDestroy(id).catch(() => {});
        // Drop the pane's remembered zoom level so it can't outlive the pane.
        useWebBrowserZoomStore.getState().removeZoom(id);
        setWebBrowserInitialUrls((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
      }
      if (type === 'ai-chat') {
        clearRunCommandIntervals(id);
        // Disable backend capture for EVERY session this (singleton) pane was
        // watching — else those watch entries leak after close.
        for (const sid of watchingSessionIdsRef.current) {
          void tauriService.setWatching(sid, false, 0);
        }
        watchingSessionIdsRef.current = new Set();
        setWatchingSessionId(null);
        // Free the pane's per-tab backend histories and drop its in-memory state,
        // so a later watch-diff can't resurrect capture for a pane that's gone.
        removeAiChatState(id);
      }
      setFeaturePanes((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      removeSessionFromStore(id);
    } else {
      if (watchingSessionId === id) {
        void tauriService.setWatching(id, false, 0);
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
    addSessionToStore(id);
  }, [addSessionToStore]);

  // Track initial URLs for web browser panes opened from a Web bookmark.
  const [webBrowserInitialUrls, setWebBrowserInitialUrls] = useState<Map<string, string>>(new Map());

  // Open a Web Browser pane from the New Session "Web" tab. With a URL (bookmark)
  // it loads that site; without one (the "New Web Browser" entry) it opens blank.
  // The callback closes over only stable setters + module fns, so the manual memo
  // is correct; the compiler can't prove it and would drop the memo, so keep it.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const handleOpenBookmark = useCallback((url?: string) => {
    if (!useSettingsStore.getState().enabledFeatures['web-browser']) return;
    const id = makeFeaturePaneId('web-browser');
    let displayName = getFeatureDisplayName('web-browser');
    if (url) {
      try { displayName = new URL(url).hostname || displayName; } catch { /* keep default */ }
    }
    setFeaturePanes((prev) => {
      const next = new Map(prev);
      next.set(id, { id, type: 'web-browser', displayName });
      return next;
    });
    if (url) {
      setWebBrowserInitialUrls((prev) => {
        const next = new Map(prev);
        next.set(id, url);
        return next;
      });
    }
    addSessionToStore(id);
    setActivePaneId(id);
  }, [addSessionToStore, setActivePaneId]);

  // Keep a web-browser tab's name in sync with the site being browsed: derive
  // the host from the current URL (falls back to the generic name on parse fail
  // or about:blank). No-op if the pane no longer exists.
  const updateWebBrowserTabName = useCallback((paneId: string, url: string) => {
    let name = getFeatureDisplayName('web-browser');
    if (url && url !== 'about:blank') {
      try { name = new URL(url).hostname || name; } catch { /* keep default */ }
    }
    setFeaturePanes((prev) => {
      const cur = prev.get(paneId);
      if (!cur || cur.displayName === name) return prev;
      const next = new Map(prev);
      next.set(paneId, { ...cur, displayName: name });
      return next;
    });
  }, []);

  const handleDropSession = (sessionId: string, targetPaneId: string) => {
    moveSessionToPane(sessionId, targetPaneId);
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
            // Mount the terminal even while connecting, with the connecting
            // overlay stacked on top of it. xterm therefore renders, measures
            // its real width, and reports it (term_resize → PendingSizes) BEFORE
            // the SSH connect path allocates the pty. Devices that latch the pty
            // width and ignore later window-change (e.g. Huawei USG/VRP) would
            // otherwise get the 80x24 fallback — the terminal used to mount only
            // AFTER 'connected', i.e. after the pty-req — which desynced
            // wrapped-line editing. See resolve_initial_pty_size in ssh.rs.
            <div className="pane-session-wrap">
              <TerminalView
                key={session.id}
                session={session}
                active={paneId === activePaneId}
                onPasteRequest={handlePasteRequest}
                onAskAiSubmit={(sessionId, selection, question) =>
                  askAi(selection, question, sessionId)
                }
              />
              {session.status === 'connecting' && (
                <ConnectingOverlay
                  key={`${session.id}-connecting`}
                  displayName={session.displayName}
                />
              )}
            </div>
          ) : featureInfo?.type === 'log-viewer' ? (
            <LogViewerPane
              key={featureInfo.id}
              paneId={featureInfo.id}
              active={paneId === activePaneId}
            />
          ) : featureInfo?.type === 'ping-monitor' ? (
            <PingMonitorPane
              key={featureInfo.id}
              paneId={featureInfo.id}
              active={paneId === activePaneId}
            />
          ) : featureInfo?.type === 'interface-traffic' ? (
            <InterfaceTrafficPane
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
          ) : featureInfo?.type === 'web-browser' ? (
            <WebBrowserPane
              key={featureInfo.id}
              paneId={featureInfo.id}
              active={paneId === activePaneId}
              initialUrl={webBrowserInitialUrls.get(featureInfo.id)}
              onUrlChange={(url) => updateWebBrowserTabName(featureInfo.id, url)}
              onOpenInNewPane={handleOpenBookmark}
              onPageFocus={() => setActivePaneId(paneId)}
            />
          ) : featureInfo?.type === 'ai-chat' ? (
            <AIChatPane
              key={featureInfo.id}
              paneId={featureInfo.id}
              active={paneId === activePaneId}
              chatState={aiChatStates.get(featureInfo.id)}
              onChatStateChange={(newState) => updateAiChatState(featureInfo.id, newState)}
              onUpdateTabById={(tabId, partial) => updateTabById(featureInfo.id, tabId, partial)}
              onEnqueuePending={(tabId, message) => enqueuePendingMessage(featureInfo.id, tabId, message)}
              onDequeuePending={(tabId) => dequeuePendingMessage(featureInfo.id, tabId)}
              onEnqueuePendingUser={(tabId, message, images) => enqueuePendingUserMessage(featureInfo.id, tabId, message, images)}
              onDequeuePendingUser={(tabId) => dequeuePendingUserMessage(featureInfo.id, tabId)}
              ensureConsent={consent.ensureAiConsent}
              // The bare "+" opens an UNLINKED tab (general chat); it no longer
              // inherits the last-focused terminal. Callers that want a linked tab
              // pass the session id explicitly (e.g. terminal "Watch with AI").
              onAddTab={(initialLink) => addTab(featureInfo.id, initialLink)}
              onCloseTab={(tabId) => closeTab(featureInfo.id, tabId)}
              onClosePane={() => handleCloseTab(featureInfo.id)}
              onSelectTab={(tabId) => setActiveTab(featureInfo.id, tabId)}
              onFlashSessionPane={flashSessionPane}
              sessions={sessions}
              onRunCommand={(targetId, cmd, originatingTabId) =>
                aiOrch.onRunCommand(targetId, cmd, originatingTabId, featureInfo.id)
              }
              onSendMessage={(text, images) => aiSendMessage(featureInfo.id, text, images)}
              aiPersonas={aiPersonas}
              terminalBackground={terminalBackground}
              linkableSessions={linkableSessions}
              onRefreshSessions={refreshCrossWindowSessions}
              // Add a terminal to the active tab's watched set (the header "+"
              // picker). Adding streams that terminal's output to the AI, so gate
              // the first add on the data-sharing consent (same as enabling Watch).
              onAddLink={(sid) => {
                const st = aiChatStates.get(featureInfo.id);
                const activeTab = st ? getActiveTab(st) : undefined;
                if (!activeTab) return;
                void consent.ensureAiConsent().then((ok) => {
                  if (ok) addTabLink(featureInfo.id, activeTab.id, sid);
                });
              }}
              // Remove a watched terminal (chip ×). Egresses nothing → no consent.
              onRemoveLink={(sid) => {
                const st = aiChatStates.get(featureInfo.id);
                const activeTab = st ? getActiveTab(st) : undefined;
                if (!activeTab) return;
                removeTabLink(featureInfo.id, activeTab.id, sid);
              }}
              onOpenSettings={() => openSettings('ai')}
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
            conversations={aiConversations}
            onWatchInConversation={watchInConversation}
            onSaveToHostTree={(id) => setSaveToTreeSessionId(id)}
            onToggleFixedSize={(id) => {
              const rec = sessionsRef.current.get(id);
              if (!rec) return;
              const on = !rec.fixedSize;
              setSessionFixedSize(id, on);
              // If this session came from a Host Tree node, persist the choice
              // back onto that host entry so future connects inherit it (and it
              // syncs to other windows via useHostManager's broadcast).
              if (rec.hostNodeId) {
                const node = flattenHosts(hostManager.tree).find((n) => n.id === rec.hostNodeId);
                if (node?.entry) {
                  hostManager.editNode(rec.hostNodeId, {
                    entry: { ...node.entry, fixedTerminalSize: on },
                  });
                }
              }
            }}
            onBookmark={(id) => {
              // A hidden web-browser tab is in no slot (its pane is unmounted), so
              // move it into the active pane to mount it, then request the bookmark
              // modal — the request persists until that pane consumes it.
              moveSessionToPane(id, activePaneId);
              setActivePaneId(activePaneId);
              useWebBrowserBookmarkStore.getState().requestBookmark(id);
            }}
            onNewLogViewer={enabledFeatures['log-viewer'] ? () => handleNewFeaturePane('log-viewer') : undefined}
            onNewPingMonitor={enabledFeatures['ping-monitor'] ? () => handleNewFeaturePane('ping-monitor') : undefined}
            onNewInterfaceTraffic={enabledFeatures['interface-traffic'] ? () => handleNewFeaturePane('interface-traffic') : undefined}
            onNewFileServer={enabledFeatures['file-server'] ? () => handleNewFeaturePane('file-server') : undefined}
            onNewAiChat={enabledFeatures['ai-chat'] ? openAiChatPane : undefined}
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
        onConnected={handleSessionConnected}
        onCancelConnect={handleCancelConnect}
        sessions={sessions}
        onOpenBookmark={handleOpenBookmark}
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
        onClose={() => { setSettingsOpen(false); setSettingsInitialTab(undefined); }}
        themesData={themesData}
        onOpenCustomThemeCreator={() => setCustomThemeOpen(true)}
        onDeleteTheme={handleDeleteTheme}
        initialTab={settingsInitialTab}
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
      {consent.aiConsentOpen && (
        <AiConsentModal
          onAccept={consent.handleAiConsentAccept}
          onCancel={consent.handleAiConsentCancel}
        />
      )}
    </div>
  );
}

export default App;
