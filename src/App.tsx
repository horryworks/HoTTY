import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { ConnectionDialog } from './components/SessionDialog/SessionDialog'
import { TabBar } from './components/TabBar/TabBar'
import { ResizeGrip } from './components/ResizeGrip/ResizeGrip'
import { PasteConfirmationModal } from './components/PasteConfirmationModal/PasteConfirmationModal'
import { SettingsModal } from './components/SettingsModal/SettingsModal'
import { LayoutSelector } from './components/LayoutSelector/LayoutSelector'
import { GridLayout } from './components/GridLayout/GridLayout'
import { MessageModal } from './components/MessageModal/MessageModal'
import { AskAiModal } from './components/AskAiModal/AskAiModal'
import HelpModal from './components/HelpModal/HelpModal'
import { UpdateNotification } from './components/UpdateNotification/UpdateNotification'
import { CustomThemeCreator } from './components/CustomThemeCreator/CustomThemeCreator'
import { PaneContent } from './components/PaneContent/PaneContent'
import { PaneLines } from './components/PaneLines/PaneLines'
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary'

import { useSessionManager } from './hooks/useSessionManager'
import type { Session } from './hooks/useSessionManager'
import { usePaneManager } from './hooks/usePaneManager'
import { useSettings } from './hooks/useSettings'
import { useInteractiveFlow } from './hooks/useInteractiveFlow'
import { useAiChat } from './hooks/useAiChat'
import { useSidebarLayout } from './hooks/useSidebarLayout'
import { STORAGE_KEYS } from './constants/storage'
import * as electronService from './services/electronService'

import '@xterm/xterm/css/xterm.css'
import './App.css'

// -- Exported Types (re-exported from types/appTypes for backward compatibility) --

export type { AskAiCommand, PromptPattern, PersonaDefinition } from './types/appTypes';

type ThemeDefinition = { name?: string; variables?: Record<string, string>; terminal?: { foreground?: string; background?: string; backgroundInactive?: string; paneBackground?: string } };

function App() {

  // ═══════════════════════════════════════════════
  // 1. Settings (useSettings hook)
  // ═══════════════════════════════════════════════

  const {
    settings,
    updateGlobalEncoding,
    updateTheme,
    updateFontSize,
    updateFontFamily,
    updateSshKeepAliveEnabled,
    updateSshKeepAliveInterval,
    updateTelnetKeepAliveEnabled,
    updateTelnetKeepAliveInterval,
    updateLoggingEnabled,
    updateLoggingPath,
    updateScrollback,
    updateWatchBufferLimit,
    updateBackspaceSendsDel,
    updateRightClickPaste,
    updateShowSystemPrompt,
    updateEnablePromptHighlight,
    updatePromptHighlightColor,
    updatePromptPatterns,
    updateAiPersonas,
    updateAskAiCommands,
    updateSidebarPosition,
    updateProactiveInstruction,
    updateInteractiveStabilizationTimeout,
    updateTerminalForeground,
    updateTerminalBackground,
    updateTerminalBackgroundInactive,
    updatePaneBackground,
    updatePaneBackgroundMode,
    updatePaneBackgroundImage,
    toggleLineWrap,
  } = useSettings();

  // ═══════════════════════════════════════════════
  // 2. UI State
  // ═══════════════════════════════════════════════

  const [themesData, setThemesData] = useState<Record<string, ThemeDefinition> | null>(null);
  const [showDialog, setShowDialog] = useState(true);
  const [globalMessage, setGlobalMessage] = useState<{ type: 'error' | 'success' | 'info', title?: string, message: string } | null>(null);
  const [focusTrigger, setFocusTrigger] = useState(0);
  const [lastTerminalSessionId, setLastTerminalSessionId] = useState<string | null>(null);
  const lastTerminalSessionIdRef = useRef<string | null>(null);

  const {
    showLeftSidebar, setShowLeftSidebar,
    showRightSidebar, setShowRightSidebar,
    showTopBar, setShowTopBar,
    showBottomBar, setShowBottomBar,
    leftSidebarPercent,
    rightSidebarPercent,
    topBarPercent,
    bottomBarPercent,
    resizingSide,
    handleResizeStart: handleSidebarResizeStart,
  } = useSidebarLayout();

  const [showPaneLines, setShowPaneLines] = useState(false);

  // Paste State
  const [pasteContent, setPasteContent] = useState<string | null>(null);
  const [pasteSessionId, setPasteSessionId] = useState<string | null>(null);

  // Update notification
  const [updateInfo, setUpdateInfo] = useState<{ version: string; releaseUrl: string } | null>(null);

  // Settings / Help Modal
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isCustomThemeCreatorOpen, setIsCustomThemeCreatorOpen] = useState(false);

  // Password Cache (In-Memory Only)
  const passwordCache = useRef<Record<string, string>>({});

  // ═══════════════════════════════════════════════
  // 3. Initialization Effects
  // ═══════════════════════════════════════════════

  // Load themes
  useEffect(() => {
    electronService.getThemes().then(setThemesData);
  }, []);

  const applyTheme = (themeName: string) => {
    if (!themesData) return;
    const themeDef = themesData[themeName];
    if (themeDef) {
      if (themeDef.variables) {
        Object.entries(themeDef.variables).forEach(([key, value]) => {
          document.documentElement.style.setProperty(`--${key}`, value as string);
        });
      }
      if (themeDef.terminal) {
        const { foreground, background, backgroundInactive, paneBackground: pBg } = themeDef.terminal;
        updateTerminalForeground(foreground ?? '');
        updateTerminalBackground(background ?? '');
        updateTerminalBackgroundInactive(backgroundInactive ?? '');
        updatePaneBackground(pBg ?? '');
      }
    }
  };

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme);
    localStorage.setItem(STORAGE_KEYS.THEME, settings.theme);
    if (themesData) {
      applyTheme(settings.theme);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.theme, themesData]);

  // Apply font family from settings to CSS variable (used by all monospace/code areas)
  useEffect(() => {
    document.documentElement.style.setProperty('--font-family', settings.fontFamily);
  }, [settings.fontFamily]);

  // Apply font size from settings to CSS variable (used as base UI font size)
  useEffect(() => {
    document.documentElement.style.setProperty('--font-size-base', `${settings.fontSize}px`);
  }, [settings.fontSize]);

  // Set Window Title
  useEffect(() => {
    electronService.getAppVersion().then(version => {
      document.title = `HoTTY v${version}`;
    });
  }, []);

  // Listen for update-available from main process
  useEffect(() => {
    const cleanup = electronService.onUpdateAvailable((data) => {
      if (localStorage.getItem(STORAGE_KEYS.NEVER_NOTIFY_UPDATE) === 'true') return;
      const skipped = localStorage.getItem(STORAGE_KEYS.SKIPPED_UPDATE_VERSION);
      if (skipped !== data.version) {
        setUpdateInfo(data);
      }
    });
    return cleanup;
  }, []);

  // Global keyboard shortcut: Ctrl+N → open New Session dialog
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'n') {
        if (isSettingsOpen || pasteContent !== null || globalMessage !== null) return;
        e.preventDefault();
        setShowDialog(true);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isSettingsOpen, pasteContent, globalMessage]);

  // ═══════════════════════════════════════════════
  // 5. Paste Handlers
  // ═══════════════════════════════════════════════

  const handlePasteRequest = (sessionId: string, text: string) => {
    setPasteContent(text);
    setPasteSessionId(sessionId);
  };

  const cancelPaste = () => {
    setPasteContent(null);
    setPasteSessionId(null);
    electronService.focusWindow();
    setFocusTrigger(prev => prev + 1);
  };

  const confirmPaste = () => {
    if (pasteSessionId && pasteContent) {
      electronService.sendInput(pasteSessionId, pasteContent);
    }
    setPasteContent(null);
    setPasteSessionId(null);
    electronService.focusWindow();
    setFocusTrigger(prev => prev + 1);
  };

  // ═══════════════════════════════════════════════
  // 6. Password Cache
  // ═══════════════════════════════════════════════

  const getCachedPassword = (host: string, user: string) => {
    return passwordCache.current[`${host}:${user}`] || '';
  };

  const saveCachedPassword = (host: string, user: string, pass: string) => {
    if (pass) {
      passwordCache.current[`${host}:${user}`] = pass;
    }
  };

  // ═══════════════════════════════════════════════
  // 7. Pane Manager
  // ═══════════════════════════════════════════════

  const pane = usePaneManager({
    showLeftSidebar,
    showRightSidebar,
    showTopBar,
    showBottomBar,
  });

  // ═══════════════════════════════════════════════
  // 8. Session Manager
  // ═══════════════════════════════════════════════

  const session = useSessionManager({
    globalEncoding: settings.globalEncoding,
    sshKeepAliveEnabled: settings.sshKeepAliveEnabled,
    sshKeepAliveInterval: settings.sshKeepAliveInterval,
    telnetKeepAliveEnabled: settings.telnetKeepAliveEnabled,
    telnetKeepAliveInterval: settings.telnetKeepAliveInterval,
    loggingEnabled: settings.loggingEnabled,
    loggingPath: settings.loggingPath,
    lineWrapEnabled: settings.lineWrapEnabled,
    scrollback: settings.scrollback,
    backspaceSendsDel: settings.backspaceSendsDel,
    onPasteRequest: handlePasteRequest,
    onSessionConnected: () => setShowDialog(false),
    onSessionError: (msg) => setGlobalMessage({ type: 'error', message: msg }),
    setPaneAllocations: pane.setPaneAllocations,
    setActivePaneId: pane.setActivePaneId,
    showLeftSidebar,
    showRightSidebar,
    showTopBar,
    showBottomBar,
    watchBufferLimit: settings.watchBufferLimit,
  });

  // ═══════════════════════════════════════════════
  // 9. Interactive Flow (useInteractiveFlow hook)
  // ═══════════════════════════════════════════════

  const interactiveFlow = useInteractiveFlow({
    promptPatterns: settings.promptPatterns,
    onFeedbackReady: (aiSessionId, resultText, termSessionId) => {
      session.updateSessionState(aiSessionId, {
        inputText: '',
        pendingMessage: resultText,
        isWaitingForTerminal: false
      });
      session.clearWatchBuffer(termSessionId);
    },
  });

  // ═══════════════════════════════════════════════
  // 10. AI Chat (useAiChat hook)
  // ═══════════════════════════════════════════════

  const aiChat = useAiChat({
    sessions: session.sessions,
    askAiCommands: settings.askAiCommands,
    aiPersonas: settings.aiPersonas,
    proactiveInstruction: settings.proactiveInstruction,
    getWatchBuffer: session.getWatchBuffer,
    clearWatchBuffer: session.clearWatchBuffer,
    updateSessionState: session.updateSessionState,
    toggleWatch: session.toggleWatch,
    createAISession: session.createAISession,
    lastTerminalSessionId,
    paneAllocations: pane.paneAllocations,
    activePaneId: pane.activePaneId,
    setActivePaneId: pane.setActivePaneId,
  });

  // ═══════════════════════════════════════════════
  // 11. Track last active terminal
  // ═══════════════════════════════════════════════

  useEffect(() => {
    const activeSessionId = pane.paneAllocations[pane.activePaneId || ''];
    if (activeSessionId) {
      const activeSession = session.sessions.find(s => s.id === activeSessionId);
      if (activeSession && activeSession.type !== 'ai' && activeSession.type !== 'log-viewer' && activeSession.type !== 'ping-monitor') {
        setLastTerminalSessionId(activeSessionId);
        lastTerminalSessionIdRef.current = activeSessionId;
      }
    }
  }, [pane.activePaneId, pane.paneAllocations, session.sessions]);

  // AI Focus Sync
  useEffect(() => {
    const handleFocus = (e: CustomEvent<{ sessionId: string }>) => {
      const { sessionId } = e.detail;
      const paneId = Object.keys(pane.paneAllocations).find(id => pane.paneAllocations[id] === sessionId);
      if (paneId) {
        pane.setActivePaneId(paneId);
      }
    };
    window.addEventListener('hotty-focus-session', handleFocus as EventListener);
    return () => {
      window.removeEventListener('hotty-focus-session', handleFocus as EventListener);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.paneAllocations, pane.setActivePaneId]);

  // ═══════════════════════════════════════════════
  // 12. Watch Toggle & Theme Change
  // ═══════════════════════════════════════════════

  const handleToggleWatch = (sessionId: string) => {
    const s = session.sessions.find(session => session.id === sessionId);
    if (!s) return;

    const isTurningOn = !s.isWatching;

    if (isTurningOn) {
      let aiSessionId = session.sessions.find(session => session.type === 'ai')?.id;
      if (!aiSessionId) {
        aiSessionId = session.createAISession();
      } else {
        const aiPaneId = Object.keys(pane.paneAllocations).find(id => pane.paneAllocations[id] === aiSessionId);
        if (aiPaneId) {
          pane.setActivePaneId(aiPaneId);
        }
      }
      // Pass aiSessionId so toggleWatch can update lastTargetSessionId atomically
      session.toggleWatch(sessionId, aiSessionId);
    } else {
      session.toggleWatch(sessionId);
    }
  };

  const handleThemeChange = (newTheme: string) => {
    if (themesData) {
      const themeDef = themesData[newTheme];
      if (themeDef && themeDef.terminal) {
        const { foreground, background, backgroundInactive, paneBackground: pBg } = themeDef.terminal;
        updateTerminalForeground(foreground ?? '');
        updateTerminalBackground(background ?? '');
        updateTerminalBackgroundInactive(backgroundInactive ?? '');
        updatePaneBackground(pBg ?? '');
        if (settings.paneBackgroundMode !== 'image') updatePaneBackgroundMode('color');
      }
    }
    updateTheme(newTheme);
  };

  const handleDeleteTheme = async (themeKey: string) => {
    await electronService.deleteCustomTheme(themeKey);
    const newThemesData = await electronService.getThemes();
    setThemesData(newThemesData);
    handleThemeChange('dark');
  };

  const handleCustomThemeCreatorSave = async (themeKey: string) => {
    const newThemesData = await electronService.getThemes();
    setThemesData(newThemesData);
    setIsCustomThemeCreatorOpen(false);
    handleThemeChange(themeKey);
  };

  const handleCustomThemeCreatorCancel = () => {
    setIsCustomThemeCreatorOpen(false);
    // Restore current theme CSS variables
    if (themesData) applyTheme(settings.theme);
  };

  // Handle encoding change for existing sessions
  const handleGlobalEncodingChange = (newEncoding: string) => {
    updateGlobalEncoding(newEncoding);
    session.sessions.forEach(s => {
      electronService.updateSessionEncoding(s.id, newEncoding);
    });
  };

  // ═══════════════════════════════════════════════
  // 13. Derived State
  // ═══════════════════════════════════════════════

  const orderedTabs = session.tabOrder
    .map(id => session.sessions.find(s => s.id === id))
    .filter((s): s is Session => !!s);

  const watchedSessionIds = session.sessions.filter(s => s.isWatching).map(s => s.id);

  // ═══════════════════════════════════════════════
  // 14. Helper: render pane content for sidebar bars
  // ═══════════════════════════════════════════════

  const renderPaneContent = (paneId: string, label: string) => {
    const sessionId = pane.paneAllocations[paneId];
    const sessionData = session.sessions.find(s => s.id === sessionId);
    const isActive = pane.activePaneId === paneId;

    if (!sessionData) {
      return (
        <div className="empty-pane-placeholder">
          <span className="pane-label">{label}</span>
          <span className="drop-hint">Drop Tab Here</span>
        </div>
      );
    }

    return (
      <PaneContent
        session={sessionData}
        isActive={isActive}
        focusTrigger={focusTrigger}
        disableFocus={showDialog || !!globalMessage}
        terminalInstance={session.terminalRegistry.current[sessionData.id]}
        onData={session.handleTerminalData}
        onPasteRequest={(text) => handlePasteRequest(sessionData.id, text)}
        lastTerminalSessionId={lastTerminalSessionId}
        lastTerminalSessionTitle={session.sessions.find(s => s.id === lastTerminalSessionId)?.title}
        interactiveSessionTracking={Object.values(interactiveFlow.trackings).find(t => t.aiSessionId === sessionData.id)}
        onRunCommand={(targetId, command) => {
          interactiveFlow.startTracking(targetId, sessionData.id, command);
        }}
        onShowPromptMenu={() => aiChat.showPromptMenu(sessionData.id)}
        onSendMessage={(text) => aiChat.sendMessage(sessionData.id, text)}
        onStateChange={(newState) => session.updateSessionState(sessionData.id, newState)}
        onPingMonitorStateChange={(newState) => session.updatePingMonitorState(sessionData.id, newState)}
      />
    );
  };

  // Pane container style
  const paneContainerStyle = (bg: string | null, bgMode: string, bgImage: string | null): React.CSSProperties => ({
    border: '1px solid var(--border-color)',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: bg || '#000000',
    backgroundImage: bgMode === 'image' ? `url("${bgImage || ''}")` : 'none',
    backgroundSize: bgMode === 'image' ? 'auto' : 'auto',
    backgroundRepeat: 'repeat',
    backgroundPosition: 'center',
    position: 'relative',
    flexShrink: 0,
    margin: '2px'
  });

  const basePaneStyle = useMemo(() =>
    paneContainerStyle(settings.paneBackground, settings.paneBackgroundMode, settings.paneBackgroundImage),
    [settings.paneBackground, settings.paneBackgroundMode, settings.paneBackgroundImage]
  );

  // Sidebar/bar drag-drop handlers (memoized to avoid re-renders)
  const handleSidebarDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleSidebarDrop = useCallback((paneId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    const sid = e.dataTransfer.getData('text/plain');
    if (sid) pane.handleDropSession(sid, paneId);
  }, [pane.handleDropSession]);

  const handlePaneActivate = useCallback((paneId: string) => () => {
    pane.setActivePaneId(paneId);
  }, [pane.setActivePaneId]);

  // GridLayout callback handlers (memoized)
  const handleGridPasteRequest = useCallback((text: string) => {
    const activePaneSessionId = pane.paneAllocations[pane.activePaneId || ''];
    if (activePaneSessionId) handlePasteRequest(activePaneSessionId, text);
  }, [pane.paneAllocations, pane.activePaneId]);

  const handleGridRunCommand = useCallback((targetId: string, command: string, aiSessionId: string) => {
    interactiveFlow.startTracking(targetId, aiSessionId, command);
  }, [interactiveFlow.startTracking]);

  const handleGridSendMessage = useCallback((aiSessionId: string, text: string) => {
    aiChat.sendMessage(aiSessionId, text);
  }, [aiChat.sendMessage]);

  const handleGridShowPromptMenu = useCallback((aiSessionId: string) => {
    aiChat.showPromptMenu(aiSessionId);
  }, [aiChat.showPromptMenu]);

  // ═══════════════════════════════════════════════
  // 15. Early Return
  // ═══════════════════════════════════════════════

  if (!window.electronAPI) {
    return <div style={{ color: 'white', padding: '20px' }}>Loading Electron API...</div>;
  }

  // ═══════════════════════════════════════════════
  // 16. Render
  // ═══════════════════════════════════════════════

  return (
    <div className="app-container">
      {/* Sidebar */}
      <div className={`sidebar ${settings.sidebarPosition === 'right' ? 'sidebar-right' : ''}`}>
        <div className="sidebar-top">
          <LayoutSelector
            currentLayout={pane.layoutMode}
            onLayoutChange={pane.setLayoutMode}
            showLeftSidebar={showLeftSidebar}
            onToggleLeftSidebar={() => setShowLeftSidebar(!showLeftSidebar)}
            showRightSidebar={showRightSidebar}
            onToggleRightSidebar={() => setShowRightSidebar(!showRightSidebar)}
            showTopBar={showTopBar}
            onToggleTopBar={() => setShowTopBar(!showTopBar)}
            showBottomBar={showBottomBar}
            onToggleBottomBar={() => setShowBottomBar(!showBottomBar)}
          />

          <div
            className={`sidebar-btn ${showPaneLines ? 'sidebar-btn-active' : ''}`}
            onClick={() => setShowPaneLines(prev => !prev)}
            title="Show Tab-Pane Mapping"
            style={{ marginTop: '10px' }}
            role="button"
            tabIndex={0}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="7" y1="17" x2="17" y2="7"></line>
              <polyline points="7 7 17 7 17 17"></polyline>
            </svg>
          </div>
        </div>
        <div className="sidebar-bottom">
          <button
            className={`sidebar-btn ${settings.lineWrapEnabled ? 'sidebar-btn-active' : ''}`}
            onClick={toggleLineWrap}
            title={settings.lineWrapEnabled ? "Disable Line Wrap" : "Enable Line Wrap"}
          >
            {settings.lineWrapEnabled ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 10 4 15 9 20"></polyline>
                <path d="M20 4v7a4 4 0 0 1-4 4H4"></path>
              </svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"></line>
                <polyline points="12 5 19 12 12 19"></polyline>
              </svg>
            )}
          </button>
          <button
            className="sidebar-btn"
            onClick={() => setIsHelpOpen(true)}
            title="Help / Documentation"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
          </button>
          <button
            className="sidebar-btn"
            onClick={() => setIsSettingsOpen(true)}
            title="Settings"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
          </button>
        </div>
      </div>

      <div className="main-layout" data-last-terminal={lastTerminalSessionId || ''}>
        <>
          {updateInfo && (
            <UpdateNotification
              version={updateInfo.version}
              releaseUrl={updateInfo.releaseUrl}
              onDismiss={() => setUpdateInfo(null)}
              onSkip={() => {
                localStorage.setItem(STORAGE_KEYS.SKIPPED_UPDATE_VERSION, updateInfo.version);
                setUpdateInfo(null);
              }}
              onNeverNotify={() => {
                localStorage.setItem(STORAGE_KEYS.NEVER_NOTIFY_UPDATE, 'true');
                setUpdateInfo(null);
              }}
            />
          )}
          <div className="top-bar">
            <TabBar
              tabs={orderedTabs}
              activeTabId={pane.activeSessionId}
              visibleSessionIds={pane.visibleSessionIds}
              watchedSessionIds={watchedSessionIds}
              onTabClick={pane.handleTabClick}
              onTabClose={session.closeSession}
              onToggleWatch={handleToggleWatch}
              onNewTab={() => setShowDialog(true)}
              onNewAITab={() => session.createAISession()}
              onNewLogViewer={() => session.createLogViewerSession()}
              onNewPingMonitor={() => session.createPingMonitorSession()}
              onTabReorder={session.handleTabReorder}
              lastTargetSessionId={session.sessions.find(s => s.type === 'ai')?.aiChatState?.lastTargetSessionId}
            />
          </div>
          <div className="content-area" style={{ display: 'flex', flexDirection: 'row', width: '100%', height: '100%', gap: '0' }}>

            {/* Left Sidebar */}
            {showLeftSidebar && (
              <div
                className={`left-sidebar-pane ${pane.activePaneId === 'sidebar-left' ? 'active-pane' : ''}`}
                data-pane-id="sidebar-left"
                style={{ ...basePaneStyle, width: `${leftSidebarPercent}%` }}
                onDragOver={handleSidebarDragOver}
                onDrop={handleSidebarDrop('sidebar-left')}
                onClick={handlePaneActivate('sidebar-left')}
              >
                <ErrorBoundary fallbackLabel="Left Sidebar">{renderPaneContent('sidebar-left', 'Left Sidebar')}</ErrorBoundary>
              </div>
            )}

            {showLeftSidebar && (
              <div
                className={`sidebar-resizer ${resizingSide === 'left' ? 'interact' : ''}`}
                onMouseDown={(e) => handleSidebarResizeStart(e, 'left')}
              />
            )}

            {/* Center Column */}
            <div className="center-column" style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, height: '100%', position: 'relative' }}>

              {/* Top Bar */}
              {showTopBar && (
                <div
                  className={`top-bar-pane ${pane.activePaneId === 'top-bar' ? 'active-pane' : ''}`}
                  data-pane-id="top-bar"
                  style={{ ...basePaneStyle, height: `${topBarPercent}%` }}
                  onDragOver={handleSidebarDragOver}
                  onDrop={handleSidebarDrop('top-bar')}
                  onClick={handlePaneActivate('top-bar')}
                >
                  <ErrorBoundary fallbackLabel="Top Bar">{renderPaneContent('top-bar', 'Top Bar')}</ErrorBoundary>
                </div>
              )}

              {showTopBar && (
                <div
                  className={`sidebar-resizer-h ${resizingSide === 'top' ? 'interact' : ''}`}
                  onMouseDown={(e) => handleSidebarResizeStart(e, 'top')}
                />
              )}

              {/* Grid Layout */}
              <div style={{ flex: 1, minHeight: 0, width: '100%' }}>
                <ErrorBoundary fallbackLabel="Grid Layout">
                <GridLayout
                  rows={pane.currentDims.rows}
                  cols={pane.currentDims.cols}
                  sessions={session.sessions}
                  updateSessionState={session.updateSessionState}
                  updatePingMonitorState={session.updatePingMonitorState}
                  paneAllocations={pane.paneAllocations}
                  activePaneId={pane.activePaneId || ''}
                  onPaneClick={pane.setActivePaneId}
                  onDropSession={pane.handleDropSession}
                  onData={session.handleTerminalData}
                  focusTrigger={focusTrigger}
                  terminalRegistry={session.terminalRegistry.current}
                  disableFocus={showDialog || !!globalMessage}
                  paneBackground={settings.paneBackground}
                  paneBackgroundMode={settings.paneBackgroundMode}
                  paneBackgroundImage={settings.paneBackgroundImage}
                  interactiveSessions={interactiveFlow.trackings}
                  onPasteRequest={handleGridPasteRequest}
                  onRunCommand={handleGridRunCommand}
                  onSendMessage={handleGridSendMessage}
                  onShowPromptMenu={handleGridShowPromptMenu}
                />
                </ErrorBoundary>
              </div>

              {/* Bottom Bar Resizer */}
              {showBottomBar && (
                <div
                  className={`sidebar-resizer-h ${resizingSide === 'bottom' ? 'interact' : ''}`}
                  onMouseDown={(e) => handleSidebarResizeStart(e, 'bottom')}
                />
              )}

              {/* Bottom Bar */}
              {showBottomBar && (
                <div
                  className={`bottom-bar-pane ${pane.activePaneId === 'bottom-bar' ? 'active-pane' : ''}`}
                  data-pane-id="bottom-bar"
                  style={{ ...basePaneStyle, height: `${bottomBarPercent}%` }}
                  onDragOver={handleSidebarDragOver}
                  onDrop={handleSidebarDrop('bottom-bar')}
                  onClick={handlePaneActivate('bottom-bar')}
                >
                  <ErrorBoundary fallbackLabel="Bottom Bar">{renderPaneContent('bottom-bar', 'Bottom Bar')}</ErrorBoundary>
                </div>
              )}

            </div>

            {/* Right Sidebar */}
            {showRightSidebar && (
              <div
                className={`sidebar-resizer ${resizingSide === 'right' ? 'interact' : ''}`}
                onMouseDown={(e) => handleSidebarResizeStart(e, 'right')}
              />
            )}

            {showRightSidebar && (
              <div
                className={`right-sidebar-pane ${pane.activePaneId === 'sidebar' ? 'active-pane' : ''}`}
                data-pane-id="sidebar"
                style={{ ...basePaneStyle, width: `${rightSidebarPercent}%` }}
                onDragOver={handleSidebarDragOver}
                onDrop={handleSidebarDrop('sidebar')}
                onClick={handlePaneActivate('sidebar')}
              >
                <ErrorBoundary fallbackLabel="Sidebar">{renderPaneContent('sidebar', 'Sidebar')}</ErrorBoundary>
              </div>
            )}
          </div>
        </>

        {/* Modals and Overlays */}
        {showDialog && (
          <ConnectionDialog
            onConnect={(config) => { session.createSession(config); setShowDialog(false); }}
            onClose={() => setShowDialog(false)}
            getCachedPassword={getCachedPassword}
            saveCachedPassword={saveCachedPassword}
            onShowMessage={(type, title, message) => setGlobalMessage({ type, title, message })}
            loggingPath={settings.loggingPath}
          />
        )}

        {globalMessage && (
          <MessageModal
            type={globalMessage.type}
            title={globalMessage.title}
            message={globalMessage.message}
            onClose={() => { setGlobalMessage(null); electronService.focusWindow(); }}
          />
        )}

        {pasteContent !== null && (
          <PasteConfirmationModal
            content={pasteContent}
            onConfirm={confirmPaste}
            onCancel={cancelPaste}
          />
        )}

        {aiChat.askAiFreeFormatData !== null && (
          <AskAiModal
            isOpen={true}
            selection={aiChat.askAiFreeFormatData.selection}
            onClose={() => aiChat.setAskAiFreeFormatData(null)}
            onSubmit={aiChat.handleFreeFormatSubmit}
          />
        )}

        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          onLogout={session.closeAllAISessions}
          encoding={settings.globalEncoding}
          onEncodingChange={handleGlobalEncodingChange}
          fontSize={settings.fontSize}
          onFontSizeChange={updateFontSize}
          fontFamily={settings.fontFamily}
          onFontFamilyChange={updateFontFamily}
          sshKeepAliveEnabled={settings.sshKeepAliveEnabled}
          onSshKeepAliveEnabledChange={updateSshKeepAliveEnabled}
          sshKeepAliveInterval={settings.sshKeepAliveInterval}
          onSshKeepAliveIntervalChange={updateSshKeepAliveInterval}
          telnetKeepAliveEnabled={settings.telnetKeepAliveEnabled}
          onTelnetKeepAliveEnabledChange={updateTelnetKeepAliveEnabled}
          telnetKeepAliveInterval={settings.telnetKeepAliveInterval}
          onTelnetKeepAliveIntervalChange={updateTelnetKeepAliveInterval}
          themesData={themesData}
          paneBackground={settings.paneBackground}
          onPaneBackgroundChange={updatePaneBackground}
          paneBackgroundMode={settings.paneBackgroundMode}
          onPaneBackgroundModeChange={updatePaneBackgroundMode}
          paneBackgroundImage={settings.paneBackgroundImage}
          onPaneBackgroundImageChange={updatePaneBackgroundImage}
          loggingEnabled={settings.loggingEnabled}
          onLoggingEnabledChange={updateLoggingEnabled}
          loggingPath={settings.loggingPath}
          onLoggingPathChange={updateLoggingPath}
          scrollback={settings.scrollback}
          onScrollbackChange={updateScrollback}
          theme={settings.theme}
          onThemeChange={handleThemeChange}
          onOpenCustomThemeCreator={() => setIsCustomThemeCreatorOpen(true)}
          onDeleteTheme={handleDeleteTheme}
          sidebarPosition={settings.sidebarPosition}
          onSidebarPositionChange={updateSidebarPosition}
          showSystemPrompt={settings.showSystemPrompt}
          onShowSystemPromptChange={updateShowSystemPrompt}
          askAiCommands={settings.askAiCommands}
          onAskAiCommandsChange={updateAskAiCommands}
          aiPersonas={settings.aiPersonas}
          onAiPersonasChange={updateAiPersonas}
          backspaceSendsDel={settings.backspaceSendsDel}
          onBackspaceSendsDelChange={updateBackspaceSendsDel}
          rightClickPaste={settings.rightClickPaste}
          onRightClickPasteChange={updateRightClickPaste}
          enablePromptHighlight={settings.enablePromptHighlight}
          onEnablePromptHighlightChange={updateEnablePromptHighlight}
          promptHighlightColor={settings.promptHighlightColor}
          onPromptHighlightColorChange={updatePromptHighlightColor}
          promptPatterns={settings.promptPatterns}
          onPromptPatternsChange={updatePromptPatterns}
          watchBufferLimit={settings.watchBufferLimit}
          onWatchBufferLimitChange={updateWatchBufferLimit}
          proactiveInstruction={settings.proactiveInstruction}
          onProactiveInstructionChange={updateProactiveInstruction}
          interactiveStabilizationTimeout={settings.interactiveStabilizationTimeout}
          onInteractiveStabilizationTimeoutChange={updateInteractiveStabilizationTimeout}
          updateInfo={updateInfo}
        />
        <PaneLines
          paneAllocations={pane.paneAllocations}
          totalPanes={pane.currentDims.rows * pane.currentDims.cols}
          visible={showPaneLines}
          showLeftSidebar={showLeftSidebar}
          showRightSidebar={showRightSidebar}
          showTopBar={showTopBar}
          showBottomBar={showBottomBar}
        />
        {themesData && (
          <CustomThemeCreator
            isOpen={isCustomThemeCreatorOpen}
            themesData={themesData as Record<string, { name: string; variables: Record<string, string>; terminal: Record<string, string> }>}
            currentTheme={settings.theme}
            onSave={handleCustomThemeCreatorSave}
            onCancel={handleCustomThemeCreatorCancel}
          />
        )}
        <ResizeGrip />
        <HelpModal
          isOpen={isHelpOpen}
          onClose={() => setIsHelpOpen(false)}
        />
      </div>
    </div>
  );
};

export default App;
