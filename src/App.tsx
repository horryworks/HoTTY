import { useCallback, useEffect, useRef, useState } from 'react';
import { GridLayout } from './components/GridLayout/GridLayout';
import { Sidebar } from './components/Sidebar/Sidebar';
import { sidebarPaneId } from './components/Sidebar/sidebarHelpers';
import { AppSidebar } from './components/AppSidebar/AppSidebar';
import { TabBar } from './components/TabBar/TabBar';
import { buildTabItems } from './components/TabBar/tabBarHelpers';
import { TerminalView } from './components/Terminal/Terminal';
import { LogViewerPane } from './components/LogViewerPane/LogViewerPane';
import { TextEditorPane } from './components/TextEditorPane/TextEditorPane';
import { FileExplorerPane } from './components/FileExplorerPane/FileExplorerPane';
import { PingMonitorPane } from './components/PingMonitorPane/PingMonitorPane';
import { AIChatPane } from './components/AIChatPane/AIChatPane';
import { AskAiModal } from './components/AskAiModal/AskAiModal';
import { SessionDialog, type ConnectSubmitPayload } from './components/SessionDialog/SessionDialog';
import { SettingsModal } from './components/SettingsModal/SettingsModal';
import { HelpModal } from './components/HelpModal/HelpModal';
import { SshHostKeyModal } from './components/SshHostKeyModal/SshHostKeyModal';
import { PasteConfirmationModal } from './components/PasteConfirmationModal/PasteConfirmationModal';
import { tauriService } from './services/tauriService';
import { useSessionManager, type SessionRecord } from './hooks/useSessionManager';
import { useAiChat } from './hooks/useAiChat';
import { usePaneStore, gridPaneIds, SIDEBAR_PANE_IDS } from './stores/paneStore';
import { useSettingsStore } from './stores/settingsStore';
import { applyTheme } from './utils/applyTheme';
import { getTheme } from './themes/defaults';
import {
  makeFeaturePaneId,
  getPaneContentType,
  isFeaturePane,
  getFeatureDisplayName,
  type FeaturePaneInfo,
  type FeaturePaneType,
} from './utils/paneTypes';
import { stripAnsiCodes } from './utils/ansiUtils';
import './App.css';

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

  const { sessions, openSession, closeSession } = useSessionManager({
    onPasteRequest: handlePasteRequest,
  });

  const layoutMode = usePaneStore((s) => s.layoutMode);
  const activePaneId = usePaneStore((s) => s.activePaneId);
  const setActivePaneId = usePaneStore((s) => s.setActivePaneId);
  const paneAllocations = usePaneStore((s) => s.paneAllocations);
  const sessionOrder = usePaneStore((s) => s.sessionOrder);
  const addSessionToStore = usePaneStore((s) => s.addSession);
  const removeSessionFromStore = usePaneStore((s) => s.removeSession);
  const reorderSessionInStore = usePaneStore((s) => s.reorderSession);
  const moveSessionToPane = usePaneStore((s) => s.moveSessionToPane);

  const themeId = useSettingsStore((s) => s.theme);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const fontFamily = useSettingsStore((s) => s.fontFamily);
  const sidebarPosition = useSettingsStore((s) => s.sidebarPosition);
  const updateSetting = useSettingsStore((s) => s.update);

  const aiPersonas = useSettingsStore((s) => s.aiPersonas);

  // Track last known terminal session for AI targeting
  const [lastTerminalSessionId, setLastTerminalSessionId] = useState<string | null>(null);
  const activePaneAllocation = paneAllocations[activePaneId];
  useEffect(() => {
    if (activePaneAllocation && !isFeaturePane(activePaneAllocation)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLastTerminalSessionId(activePaneAllocation);
    }
  }, [activePaneAllocation]);

  // AI Watch mode
  const [watchingSessionId, setWatchingSessionId] = useState<string | null>(null);
  const watchBuffers = useRef(new Map<string, string>());
  const getWatchBuffer = useCallback((sid: string) => watchBuffers.current.get(sid) || '', []);
  const clearWatchBuffer = useCallback((sid: string) => { watchBuffers.current.delete(sid); }, []);

  const watchingSessionIdRef = useRef(watchingSessionId);
  useEffect(() => { watchingSessionIdRef.current = watchingSessionId; }, [watchingSessionId]);

  const createAiChatPaneRef = useRef<() => string | undefined>();
  const updateAiChatStateRef = useRef<(id: string, state: Record<string, unknown>) => void>();

  const toggleWatch = useCallback((sessionId?: string) => {
    if (!sessionId) return;
    const prev = watchingSessionIdRef.current;
    const isTurningOn = prev !== sessionId;

    if (!isTurningOn) {
      // Turning off
      watchBuffers.current.delete(sessionId);
      setWatchingSessionId(null);
      return;
    }

    // Turning on
    if (prev) watchBuffers.current.delete(prev);
    watchBuffers.current.set(sessionId, '');
    setWatchingSessionId(sessionId);

    // Auto-create/focus AI Chat pane and link target session
    const aiPaneId = createAiChatPaneRef.current?.();
    if (aiPaneId) {
      const alloc = usePaneStore.getState().paneAllocations;
      const paneEntry = Object.entries(alloc).find(([, sid]) => sid === aiPaneId);
      if (paneEntry) setActivePaneId(paneEntry[0]);
      const session = sessions.get(sessionId);
      updateAiChatStateRef.current?.(aiPaneId, {
        lastTargetSessionId: sessionId,
        lastTargetSessionTitle: session?.displayName || 'Unknown Terminal',
      });
    }
  }, [sessions, setActivePaneId]);

  // Capture terminal data into watch buffer
  useEffect(() => {
    if (!watchingSessionId) return;
    let cancelled = false;
    const unlistenPromise = tauriService.onSessionData(({ sessionId, data }) => {
      if (cancelled || sessionId !== watchingSessionIdRef.current) return;
      const stripped = stripAnsiCodes(data);
      const current = watchBuffers.current.get(sessionId) || '';
      let newBuffer = current + stripped;
      const limit = useSettingsStore.getState().watchBufferLimit;
      if (newBuffer.length > limit) {
        newBuffer = newBuffer.substring(newBuffer.length - limit);
      }
      watchBuffers.current.set(sessionId, newBuffer);
    });
    return () => {
      cancelled = true;
      unlistenPromise.then(fn => fn());
    };
  }, [watchingSessionId]);

  const createAiChatPane = useCallback((): string | undefined => {
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
    sendMessage: aiSendMessage,
    showPromptMenu: aiShowPromptMenu,
    askAiFreeFormatData,
    setAskAiFreeFormatData,
    handleFreeFormatSubmit,
  } = useAiChat({
    sessions,
    featurePanes,
    aiPersonas,
    getWatchBuffer,
    clearWatchBuffer,
    toggleWatch,
    createAiChatPane,
    lastTerminalSessionId,
    paneAllocations,
    activePaneId,
    setActivePaneId,
  });

  // Wire up refs for toggleWatch (avoids circular dependency)
  useEffect(() => {
    createAiChatPaneRef.current = createAiChatPane;
    updateAiChatStateRef.current = updateAiChatState;
  });

  const [connectOpen, setConnectOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    tauriService.getAppVersion().then((v) => {
      tauriService.setWindowTitle(`HoTTY v${v}`);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const theme = getTheme(themeId);
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
  }, [themeId, fontSize, fontFamily, updateSetting]);

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

  const handleConnectSubmit = async (payload: ConnectSubmitPayload) => {
    setConnectOpen(false);
    const id = await openSession(payload);
    addSessionToStore(id);
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
      if (type === 'ai-chat' && watchingSessionId) {
        watchBuffers.current.delete(watchingSessionId);
        setWatchingSessionId(null);
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
      removeSessionFromStore(id);
    }
  };

  const handleNewFeaturePane = useCallback((type: FeaturePaneType) => {
    const id = makeFeaturePaneId(type);
    const displayName = getFeatureDisplayName(type);
    setFeaturePanes((prev) => {
      const next = new Map(prev);
      next.set(id, { id, type, displayName });
      return next;
    });
    addSessionToStore(id);
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

  const renderPane = (paneId: string) => {
    const sid = paneAllocations[paneId] ?? null;
    const contentType = sid ? getPaneContentType(sid) : null;
    const session = sid && contentType === 'session' ? sessions.get(sid) : undefined;
    const featureInfo = sid && contentType !== 'session' ? featurePanes.get(sid) : undefined;

    return (
      <div
        className={`pane${paneId === activePaneId ? ' pane-active' : ''}`}
        onClick={() => setActivePaneId(paneId)}
      >
        <div className="pane-body">
          {session ? (
            <TerminalView
              key={session.id}
              session={session}
              active={paneId === activePaneId}
              onPasteRequest={handlePasteRequest}
            />
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
          ) : featureInfo?.type === 'ai-chat' ? (
            <AIChatPane
              key={featureInfo.id}
              paneId={featureInfo.id}
              active={paneId === activePaneId}
              chatState={aiChatStates.get(featureInfo.id)}
              onChatStateChange={(newState) => updateAiChatState(featureInfo.id, newState)}
              onRunCommand={(targetId, cmd) => {
                // Record buffer position before sending command
                const startLen = (watchBuffers.current.get(targetId) || '').length;

                // Send command lines to terminal
                const lines = cmd.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                lines.forEach((line, index) => {
                  setTimeout(() => {
                    tauriService.sendInput(targetId, line + '\r').catch(() => {});
                  }, index * 150);
                });

                // Poll watch buffer for command completion (shell prompt detection)
                if (watchingSessionIdRef.current === targetId) {
                  const sendDuration = lines.length * 150;
                  let attempts = 0;
                  const maxAttempts = 150; // 30 seconds max
                  const pollInterval = setInterval(() => {
                    attempts++;
                    const buf = watchBuffers.current.get(targetId) || '';
                    const newContent = buf.substring(startLen);
                    // Wait until all lines are sent + some output received
                    if (attempts * 200 < sendDuration + 300) return;
                    // Detect shell prompt: line ending with common prompt chars
                    const promptPattern = /[\$#>]\s*$/m;
                    if (newContent.length > 0 && promptPattern.test(newContent)) {
                      clearInterval(pollInterval);
                      clearWatchBuffer(targetId);
                      const outputText = `Terminal Output (Command: ${cmd}):\n${newContent.trim()}`;
                      updateAiChatState(featureInfo.id, { pendingMessage: outputText });
                    } else if (attempts >= maxAttempts) {
                      clearInterval(pollInterval);
                    }
                  }, 200);
                }
              }}
              onShowPromptMenu={() => aiShowPromptMenu(featureInfo.id)}
              onSendMessage={(text) => aiSendMessage(featureInfo.id, text)}
              aiPersonas={aiPersonas}
              terminalBackground={useSettingsStore.getState().terminalBackground}
            />
          ) : (
            <div className="pane-empty">No session</div>
          )}
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
            onNewLogViewer={() => handleNewFeaturePane('log-viewer')}
            onNewPingMonitor={() => handleNewFeaturePane('ping-monitor')}
            onNewTextEditor={() => handleNewFeaturePane('text-editor')}
            onNewFileExplorer={() => handleNewFeaturePane('file-explorer')}
            onNewAiChat={() => handleNewFeaturePane('ai-chat')}
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
      />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      <SshHostKeyModal />
      {pasteReq && (
        <PasteConfirmationModal
          content={pasteReq.content}
          onConfirm={() => {
            tauriService.sendInput(pasteReq.sessionId, pasteReq.content).catch(() => {});
            setPasteReq(null);
          }}
          onCancel={() => setPasteReq(null)}
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
