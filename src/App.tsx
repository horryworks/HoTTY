import { useState, useRef, useEffect } from 'react'
import { ConnectionDialog } from './components/ConnectionDialog/ConnectionDialog'
import { TabBar } from './components/TabBar/TabBar'
import { ResizeGrip } from './components/ResizeGrip/ResizeGrip'
import { PasteConfirmationModal } from './components/PasteConfirmationModal/PasteConfirmationModal'
import { SettingsModal } from './components/SettingsModal/SettingsModal'
import { LayoutSelector } from './components/LayoutSelector/LayoutSelector'
import { GridLayout } from './components/GridLayout/GridLayout'
import { ErrorModal } from './components/ErrorModal/ErrorModal'
import { PaneLines } from './components/PaneLines/PaneLines'
import { useSessionManager } from './hooks/useSessionManager'
import type { Session } from './hooks/useSessionManager'
import { usePaneManager } from './hooks/usePaneManager'
import '@xterm/xterm/css/xterm.css'
import './App.css'

function App() {
  // ── UI State ──
  const [showDialog, setShowDialog] = useState(true);
  const [errorModalMessage, setErrorModalMessage] = useState<string | null>(null);
  const [focusTrigger, setFocusTrigger] = useState(0);

  // Paste Confirmation State
  const [pasteContent, setPasteContent] = useState<string | null>(null);
  const [pasteSessionId, setPasteSessionId] = useState<string | null>(null);

  // Settings State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [globalEncoding, setGlobalEncoding] = useState<string>(() => {
    return localStorage.getItem('hterm_global_encoding') || 'utf8';
  });
  const [fontSize, setFontSize] = useState<number>(() => {
    const saved = localStorage.getItem('hterm_font_size');
    return saved ? parseInt(saved, 10) : 14;
  });
  const [fontFamily, setFontFamily] = useState<string>(() => {
    return localStorage.getItem('hterm_font_family') || 'Consolas, "Courier New", monospace';
  });
  const [theme, setTheme] = useState<'dark' | 'light' | 'custom'>(() => {
    return (localStorage.getItem('hterm_theme') as 'dark' | 'light' | 'custom') || 'dark';
  });

  // Apply theme attributes
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('hterm_theme', theme);
  }, [theme]);

  // Set Window Title with Version
  useEffect(() => {
    window.electronAPI.getAppVersion().then(version => {
      document.title = `HoTTY v${version}`;
    });
  }, []);

  // SSH KeepAlive State
  const [sshKeepAliveEnabled, setSshKeepAliveEnabled] = useState<boolean>(() => {
    return localStorage.getItem('hterm_ssh_keepalive_enabled') !== 'false'; // default true
  });
  const [sshKeepAliveInterval, setSshKeepAliveInterval] = useState<number>(() => {
    const saved = localStorage.getItem('hterm_ssh_keepalive_interval');
    return saved ? parseInt(saved, 10) : 10;
  });





  // Color Settings
  const [terminalForeground, setTerminalForeground] = useState<string>(() => {
    return localStorage.getItem('hterm_terminal_foreground') || '#ffffff';
  });
  const [terminalBackground, setTerminalBackground] = useState<string>(() => {
    return localStorage.getItem('hterm_terminal_background') || '#1e1e1e';
  });
  const [paneBackground, setPaneBackground] = useState<string>(() => {
    return localStorage.getItem('hterm_pane_background') || '#000200';
  });

  // Custom colors cache (to restore when switching back to Custom)
  const [customColors, setCustomColors] = useState(() => ({
    foreground: localStorage.getItem('hterm_custom_terminal_foreground') || '#ffffff',
    background: localStorage.getItem('hterm_custom_terminal_background') || '#1e1e1e',
    paneBackground: localStorage.getItem('hterm_custom_pane_background') || '#000200',
  }));

  const [paneBackgroundMode, setPaneBackgroundMode] = useState<'color' | 'image'>(() => {
    return (localStorage.getItem('hterm_pane_background_mode') as 'color' | 'image') || 'image';
  });
  const [paneBackgroundImage, setPaneBackgroundImage] = useState<string>(() => {
    return localStorage.getItem('hterm_pane_background_image') || '/bg-cyberspace.svg';
  });

  const [showPaneLines, setShowPaneLines] = useState(false);

  // Password Cache (In-Memory Only)
  const passwordCache = useRef<Record<string, string>>({});

  const getCachedPassword = (host: string, user: string) => {
    return passwordCache.current[`${host}:${user}`] || '';
  };

  const saveCachedPassword = (host: string, user: string, pass: string) => {
    if (pass) {
      passwordCache.current[`${host}:${user}`] = pass;
    }
  };

  // ── Pane Manager ──
  const pane = usePaneManager();

  // ── Paste handler (needed by session manager for terminal paste interception) ──
  const handlePasteRequest = (sessionId: string, text: string) => {
    setPasteContent(text);
    setPasteSessionId(sessionId);
  };

  // ── Session Manager ──
  const session = useSessionManager({
    globalEncoding,
    sshKeepAliveEnabled,
    sshKeepAliveInterval,
    onPasteRequest: handlePasteRequest,
    onSessionConnected: () => setShowDialog(false),
    onSessionError: (msg) => setErrorModalMessage(msg),
    setPaneAllocations: pane.setPaneAllocations,
    setActivePaneId: pane.setActivePaneId,
  });

  // ── Settings Updaters ──
  const updateGlobalEncoding = (newEncoding: string) => {
    setGlobalEncoding(newEncoding);
    localStorage.setItem('hterm_global_encoding', newEncoding);
    session.sessions.forEach(s => {
      window.electronAPI.updateSessionEncoding(s.id, newEncoding);
    });
  };

  const updateFontSize = (size: number) => {
    setFontSize(size);
    localStorage.setItem('hterm_font_size', size.toString());
  };

  const updateFontFamily = (family: string) => {
    setFontFamily(family);
    localStorage.setItem('hterm_font_family', family);
  };

  const updateSshKeepAliveEnabled = (enabled: boolean) => {
    setSshKeepAliveEnabled(enabled);
    localStorage.setItem('hterm_ssh_keepalive_enabled', enabled.toString());
  };

  const updateSshKeepAliveInterval = (interval: number) => {
    setSshKeepAliveInterval(interval);
    localStorage.setItem('hterm_ssh_keepalive_interval', interval.toString());
  };

  // Theme Change Handler
  const updateTheme = (newTheme: 'dark' | 'light' | 'custom') => {
    setTheme(newTheme);

    if (newTheme === 'dark') {
      updateTerminalForeground('#ffffff');
      updateTerminalBackground('#1e1e1e');
      updatePaneBackground('#000200');
    } else if (newTheme === 'light') {
      updateTerminalForeground('#000000');
      updateTerminalBackground('#ffffff');
      updatePaneBackground('#f0f0f0');
      updatePaneBackgroundMode('color');
    } else if (newTheme === 'custom') {
      // Restore custom colors
      updateTerminalForeground(customColors.foreground);
      updateTerminalBackground(customColors.background);
      updatePaneBackground(customColors.paneBackground);
    }
  };

  const updateTerminalForeground = (color: string) => {
    setTerminalForeground(color);
    localStorage.setItem('hterm_terminal_foreground', color);
    if (theme === 'custom') {
      localStorage.setItem('hterm_custom_terminal_foreground', color);
      setCustomColors(prev => ({ ...prev, foreground: color }));
    }
  };

  const updateTerminalBackground = (color: string) => {
    setTerminalBackground(color);
    localStorage.setItem('hterm_terminal_background', color);
    if (theme === 'custom') {
      localStorage.setItem('hterm_custom_terminal_background', color);
      setCustomColors(prev => ({ ...prev, background: color }));
    }
  };

  const updatePaneBackground = (color: string) => {
    setPaneBackground(color);
    localStorage.setItem('hterm_pane_background', color);
    if (theme === 'custom') {
      localStorage.setItem('hterm_custom_pane_background', color);
      setCustomColors(prev => ({ ...prev, paneBackground: color }));
    }
  };

  const updatePaneBackgroundMode = (mode: 'color' | 'image') => {
    setPaneBackgroundMode(mode);
    localStorage.setItem('hterm_pane_background_mode', mode);
  };

  const updatePaneBackgroundImage = (url: string) => {
    setPaneBackgroundImage(url);
    localStorage.setItem('hterm_pane_background_image', url);
  };

  // ── Paste Handlers ──
  const cancelPaste = () => {
    setPasteContent(null);
    setPasteSessionId(null);
    window.electronAPI.focusWindow();
    setFocusTrigger(prev => prev + 1);
  };

  const confirmPaste = () => {
    if (pasteSessionId && pasteContent) {
      window.electronAPI.sendInput(pasteSessionId, pasteContent);
    }
    setPasteContent(null);
    setPasteSessionId(null);
    window.electronAPI.focusWindow();
    setFocusTrigger(prev => prev + 1);
  };

  // ── Error Modal ──
  const handleCloseErrorModal = () => {
    setErrorModalMessage(null);
    window.electronAPI.focusWindow();
  };

  // ── Early Return ──
  if (!window.electronAPI) {
    return <div style={{ color: 'white', padding: '20px' }}>Loading Electron API...</div>;
  }

  // ── Derived State ──
  const orderedTabs = session.tabOrder
    .map(id => session.sessions.find(s => s.id === id))
    .filter((s): s is Session => !!s);

  // ── Render ──
  return (
    <div className="app-container">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-top">
          <LayoutSelector
            currentLayout={pane.layoutMode}
            onLayoutChange={pane.setLayoutMode}
          />
        </div>
        <div className="sidebar-bottom">
          <button
            className={`sidebar-btn ${showPaneLines ? 'sidebar-btn-active' : ''}`}
            onClick={() => setShowPaneLines(prev => !prev)}
            title="Show Tab-Pane Mapping"
          >
            ↗️
          </button>
          <button
            className="sidebar-btn"
            onClick={() => setIsSettingsOpen(true)}
            title="Settings"
          >
            ⚙️
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="main-layout">
        <div className="top-bar">
          <TabBar
            tabs={orderedTabs}
            activeTabId={pane.activeSessionId}
            visibleSessionIds={pane.visibleSessionIds}
            onTabClick={pane.handleTabClick}
            onTabClose={session.closeSession}
            onNewTab={() => setShowDialog(true)}
            onNewAITab={() => session.createAISession()}
            onTabReorder={session.handleTabReorder}
          />
        </div>

        <div className="content-area">
          <GridLayout
            rows={pane.currentDims.rows}
            cols={pane.currentDims.cols}
            sessions={session.sessions}
            updateSessionState={session.updateSessionState}
            paneAllocations={pane.paneAllocations}
            activePaneId={pane.activePaneId}
            onPaneClick={pane.setActivePaneId}
            onDropSession={pane.handleDropSession}
            onData={session.handleTerminalData}
            focusTrigger={focusTrigger}
            terminalRegistry={session.terminalRegistry.current}
            disableFocus={showDialog || !!errorModalMessage}
            fontSize={fontSize}
            fontFamily={fontFamily}
            terminalForeground={terminalForeground}
            terminalBackground={terminalBackground}
            paneBackground={paneBackground}
            paneBackgroundMode={paneBackgroundMode}
            paneBackgroundImage={paneBackgroundImage}
          />
        </div>
      </div>

      {showDialog && (
        <ConnectionDialog
          onConnect={(config) => { session.createSession(config); setShowDialog(false); }}
          onClose={() => setShowDialog(false)}
          getCachedPassword={getCachedPassword}
          saveCachedPassword={saveCachedPassword}
        />
      )}

      {errorModalMessage && (
        <ErrorModal message={errorModalMessage} onClose={handleCloseErrorModal} />
      )}

      {pasteContent !== null && (
        <PasteConfirmationModal
          content={pasteContent}
          onConfirm={confirmPaste}
          onCancel={cancelPaste}
        />
      )}

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        encoding={globalEncoding}
        onEncodingChange={updateGlobalEncoding}
        fontSize={fontSize}
        onFontSizeChange={updateFontSize}
        fontFamily={fontFamily}
        onFontFamilyChange={updateFontFamily}
        sshKeepAliveEnabled={sshKeepAliveEnabled}
        onSshKeepAliveEnabledChange={updateSshKeepAliveEnabled}
        sshKeepAliveInterval={sshKeepAliveInterval}
        onSshKeepAliveIntervalChange={updateSshKeepAliveInterval}
        terminalForeground={terminalForeground}
        onTerminalForegroundChange={updateTerminalForeground}
        terminalBackground={terminalBackground}
        onTerminalBackgroundChange={updateTerminalBackground}
        paneBackground={paneBackground}
        onPaneBackgroundChange={updatePaneBackground}
        paneBackgroundMode={paneBackgroundMode}
        onPaneBackgroundModeChange={updatePaneBackgroundMode}
        paneBackgroundImage={paneBackgroundImage}
        onPaneBackgroundImageChange={updatePaneBackgroundImage}
        theme={theme}
        onThemeChange={updateTheme}
      />
      <PaneLines
        paneAllocations={pane.paneAllocations}
        totalPanes={pane.currentDims.rows * pane.currentDims.cols}
        visible={showPaneLines}
      />
      <ResizeGrip />
    </div>
  )
}

export default App
