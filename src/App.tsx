import { useCallback, useEffect, useState } from 'react';
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
import { ConnectForm, type ConnectSubmitPayload } from './components/ConnectForm/ConnectForm';
import { SettingsModal } from './components/SettingsModal/SettingsModal';
import { SshHostKeyModal } from './components/SshHostKeyModal/SshHostKeyModal';
import { PasteConfirmationModal } from './components/PasteConfirmationModal/PasteConfirmationModal';
import { tauriService } from './services/tauriService';
import { useSessionManager, type SessionRecord } from './hooks/useSessionManager';
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

  const [connectOpen, setConnectOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  const tabItems = buildTabItems(orderedSessions, featurePanesList, sessionOrder);

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
      setFeaturePanes((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      removeSessionFromStore(id);
    } else {
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
  }, [addSessionToStore]);

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
        <AppSidebar onOpenSettings={() => setSettingsOpen(true)} />
        <div className="main-layout">
          <TabBar
            tabItems={tabItems}
            activeTabId={activeTabId}
            visibleTabIds={visibleTabIds}
            onSelect={handleSelectTab}
            onClose={handleCloseTab}
            onNew={handleNewConnectionClick}
            onReorder={reorderSessionInStore}
            onNewLogViewer={() => handleNewFeaturePane('log-viewer')}
            onNewPingMonitor={() => handleNewFeaturePane('ping-monitor')}
            onNewTextEditor={() => handleNewFeaturePane('text-editor')}
            onNewFileExplorer={() => handleNewFeaturePane('file-explorer')}
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

      <ConnectForm
        open={connectOpen}
        onCancel={() => setConnectOpen(false)}
        onSubmit={handleConnectSubmit}
      />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
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
    </div>
  );
}

export default App;
