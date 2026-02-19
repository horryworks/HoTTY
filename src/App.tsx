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

export interface AskGeminiCommand {
  id: string;
  label: string;
  promptTemplate: string;
}

const DEFAULT_GEMINI_COMMANDS: AskGeminiCommand[] = [
  { id: 'what-is-this', label: 'What is this?', promptTemplate: 'Explain the following text or code snippet concisely:\n\n{selection}' },
  { id: 'what-does-it-mean', label: 'What does it mean?', promptTemplate: 'Interpret the meaning of this log entry or message and its implications:\n\n{selection}' },
  { id: 'root-cause', label: 'Research root cause', promptTemplate: 'Analyze the following error or issue, identify 3 potential root causes, and suggest verification steps for each:\n\n{selection}' },
  { id: 'fix-this', label: 'Fix this', promptTemplate: 'Suggest a fix or improvement for the selected code or configuration:\n\n{selection}' },
];

export interface PersonaDefinition {
  id: string;
  label: string;
  systemPrompt: string;
}

const DEFAULT_PERSONAS: PersonaDefinition[] = [
  {
    id: 'general-helper',
    label: 'General Helper',
    systemPrompt: 'You are a helpful technical assistant. Provide clear, concise, and accurate answers. When explaining concepts, use analogies where appropriate.'
  },
  {
    id: 'network-expert',
    label: 'Network Expert',
    systemPrompt: 'You are a Senior Network Engineer. Analyze network issues with a focus on OSI layers, routing protocols (BGP, OSPF), and switching. Use industry-standard terminology (Cisco/Juniper syntax) and formatting.'
  },
  {
    id: 'server-expert',
    label: 'Server Expert',
    systemPrompt: 'You are a Systems Administrator specializing in Linux and Windows servers. Focus on OS internals, kernel parameters, performance tuning, and security best practices. Provide specific commands for troubleshooting.'
  },
  {
    id: 'cloud-expert',
    label: 'Cloud Expert',
    systemPrompt: 'You are a Cloud Architect (AWS/Azure/GCP). Advise on cloud-native patterns, microservices, and infrastructure-as-code (Terraform/K8s). Prioritize scalability, cost-efficiency, and security in your recommendations.'
  },
  {
    id: 'coding-expert',
    label: 'Coding Expert',
    systemPrompt: 'You are a Senior Software Engineer. Provide idiomatic, clean, and performant code solutions. Explain time/space complexity (Big O) where relevant. Prefer modern syntax and safety.'
  },
  {
    id: 'security-analyst',
    label: 'Security Analyst',
    systemPrompt: 'You are a Cybersecurity Analyst. Analyze logs and configurations for potential vulnerabilities, threats, and indicators of compromise (IoCs). Recommend mitigation strategies based on industry standards (NIST/CIS).'
  }
];

function App() {

  // -- UI State --
  const [themesData, setThemesData] = useState<any>(null);
  const [showDialog, setShowDialog] = useState(true);
  const [errorModalMessage, setErrorModalMessage] = useState<string | null>(null);
  const [focusTrigger, setFocusTrigger] = useState(0);

  // Load themes on startup
  useEffect(() => {
    window.electronAPI.getThemes().then(setThemesData);
  }, []);


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
  const [theme, setTheme] = useState<'dark' | 'light' | 'medium' | 'custom'>(() => {
    return (localStorage.getItem('hterm_theme') as 'dark' | 'light' | 'medium' | 'custom') || 'dark';
  });

  // Apply theme attributes
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('hterm_theme', theme);
    if (themesData) {
      applyTheme(theme);
    }
  }, [theme, themesData]);


  const applyTheme = (themeName: string) => {
    if (themeName === 'custom') {
      return;
    }

    const themeDef = (themesData as any)[themeName];
    if (themeDef) {
      if (themeDef.variables) {
        Object.entries(themeDef.variables).forEach(([key, value]) => {
          document.documentElement.style.setProperty(`--${key}`, value as string);
        });
      }

      if (themeDef.terminal) {
        const { foreground, background, backgroundInactive, paneBackground: pBg } = themeDef.terminal;
        // Update state and localStorage to match the theme definition
        // This ensures that when the theme is selected, the specific colors are also updated
        updateTerminalForeground(foreground);
        updateTerminalBackground(background);
        updateTerminalBackgroundInactive(backgroundInactive);
        updatePaneBackground(pBg);
      }
    }
  };

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

  // Logging State
  const [loggingEnabled, setLoggingEnabled] = useState<boolean>(() => {
    return localStorage.getItem('hterm_logging_enabled') === 'true'; // default false
  });
  const [loggingPath, setLoggingPath] = useState<string>(() => {
    return localStorage.getItem('hterm_logging_path') || '';
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

  // New Inactive Terminal Background
  const [terminalBackgroundInactive, setTerminalBackgroundInactive] = useState<string>(() => {
    return localStorage.getItem('hterm_terminal_background_inactive') || '#121212';
  });

  // Custom colors cache (to restore when switching back to Custom)
  const [customColors, setCustomColors] = useState(() => ({
    foreground: localStorage.getItem('hterm_custom_terminal_foreground') || '#ffffff',
    background: localStorage.getItem('hterm_custom_terminal_background') || '#1e1e1e',
    backgroundInactive: localStorage.getItem('hterm_custom_terminal_background_inactive') || '#121212',
    paneBackground: localStorage.getItem('hterm_custom_pane_background') || '#000200',
  }));

  const [paneBackgroundMode, setPaneBackgroundMode] = useState<'color' | 'image' | 'default'>(() => {
    return (localStorage.getItem('hterm_pane_background_mode') as 'color' | 'image' | 'default') || 'default';
  });
  const [paneBackgroundImage, setPaneBackgroundImage] = useState<string>(() => {
    return localStorage.getItem('hterm_pane_background_image') || 'HoTTY_background.svg';
  });

  const [isMediaAuthorized, setIsMediaAuthorized] = useState(false);

  // Authorize media path whenever it changes (including startup)
  useEffect(() => {
    if (paneBackgroundImage.startsWith('media:///')) {
      const path = paneBackgroundImage.replace(/^media:\/\/\//, '');
      window.electronAPI.authorizeMediaPath(decodeURIComponent(path)).then(() => {
        setIsMediaAuthorized(true);
      });
    } else {
      setIsMediaAuthorized(true);
    }
  }, [paneBackgroundImage]);

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

  // Line Wrap State
  const [lineWrapEnabled, setLineWrapEnabled] = useState<boolean>(() => {
    return localStorage.getItem('hterm_line_wrap_enabled') !== 'false'; // default true
  });

  const toggleLineWrap = () => {
    setLineWrapEnabled(prev => {
      const newValue = !prev;
      localStorage.setItem('hterm_line_wrap_enabled', newValue.toString());
      return newValue;
    });
  };

  // Scrollback State
  const [scrollback, setScrollback] = useState<number>(() => {
    const saved = localStorage.getItem('hterm_scrollback');
    return saved ? parseInt(saved, 10) : 10000;
  });

  const updateScrollback = (lines: number) => {
    setScrollback(lines);
    localStorage.setItem('hterm_scrollback', lines.toString());
  };

  // Backspace Behavior State
  const [backspaceSendsDel, setBackspaceSendsDel] = useState<boolean>(() => {
    return localStorage.getItem('hterm_backspace_sends_del') === 'true'; // default false (0x08)
  });

  const updateBackspaceSendsDel = (sendsDel: boolean) => {
    setBackspaceSendsDel(sendsDel);
    localStorage.setItem('hterm_backspace_sends_del', sendsDel.toString());
  };

  // -- Pane Manager --
  const pane = usePaneManager();



  // -- Paste handler (needed by session manager for terminal paste interception) --
  const handlePasteRequest = (sessionId: string, text: string) => {
    setPasteContent(text);
    setPasteSessionId(sessionId);
  };

  // -- Session Manager --
  const session = useSessionManager({
    globalEncoding,
    sshKeepAliveEnabled,
    sshKeepAliveInterval,
    loggingEnabled,
    loggingPath,
    lineWrapEnabled,
    scrollback,
    backspaceSendsDel,
    onPasteRequest: handlePasteRequest,
    onSessionConnected: () => setShowDialog(false),
    onSessionError: (msg) => setErrorModalMessage(msg),
    setPaneAllocations: pane.setPaneAllocations,
    setActivePaneId: pane.setActivePaneId,
  });

  // Show System Prompt State
  const [showSystemPrompt, setShowSystemPrompt] = useState<boolean>(() => {
    return localStorage.getItem('hotty_show_system_prompt') === 'true';
  });

  const updateShowSystemPrompt = (show: boolean) => {
    setShowSystemPrompt(show);
    localStorage.setItem('hotty_show_system_prompt', show.toString());
  };

  // AI Persona State
  // AI Persona State
  const [aiPersonas, setAiPersonas] = useState<PersonaDefinition[]>(() => {
    const saved = localStorage.getItem('hotty_ai_personas');
    return saved ? JSON.parse(saved) : DEFAULT_PERSONAS;
  });

  const updateAiPersonas = (personas: PersonaDefinition[]) => {
    setAiPersonas(personas);
    localStorage.setItem('hotty_ai_personas', JSON.stringify(personas));
  };

  // Ask Gemini Commands State
  const [askGeminiCommands, setAskGeminiCommands] = useState<AskGeminiCommand[]>(() => {
    const saved = localStorage.getItem('hotty_ask_gemini_commands');
    return saved ? JSON.parse(saved) : DEFAULT_GEMINI_COMMANDS;
  });

  const updateAskGeminiCommands = (commands: AskGeminiCommand[]) => {
    setAskGeminiCommands(commands);
    localStorage.setItem('hotty_ask_gemini_commands', JSON.stringify(commands));
  };

  // -- Ask Gemini Handler --
  // Use ref to access latest sessions and functions without re-binding the listener
  const sessionRef = useRef(session);
  const paneRef = useRef(pane);
  const askGeminiCommandsRef = useRef(askGeminiCommands);
  const aiPersonasRef = useRef(aiPersonas); // Add ref for aiPersonas

  // Update refs on every render
  useEffect(() => {
    sessionRef.current = session;
    paneRef.current = pane;
    askGeminiCommandsRef.current = askGeminiCommands;
    aiPersonasRef.current = aiPersonas; // Update aiPersonas ref
  });

  useEffect(() => {
    const removeListener = window.electronAPI.onAskGemini((selection: string, type: string) => {
      window.electronAPI.logDebug(`[App.tsx] onAskGemini triggered. Type: ${type}, Selection length: ${selection?.length}`);

      if (!selection) {
        window.electronAPI.logDebug('[App.tsx] Selection is empty, ignoring.');
        return;
      }

      const currentSession = sessionRef.current;
      const currentPane = paneRef.current;
      const currentCommands = askGeminiCommandsRef.current;
      const currentPersonas = aiPersonasRef.current; // Get current personas

      // Ensure AI Session
      let aiSessionId: string;
      const existingAiSession = currentSession.sessions.find(s => s.type === 'ai');

      if (existingAiSession) {
        aiSessionId = existingAiSession.id;
        window.electronAPI.logDebug(`[App.tsx] Found existing AI session: ${aiSessionId}`);
        currentPane.setActivePaneId(aiSessionId);
      } else {
        // Create new AI session
        const newId = currentSession.createAISession();
        if (newId) {
          aiSessionId = newId;
          window.electronAPI.logDebug(`[App.tsx] Created new AI session: ${aiSessionId}`);
        } else {
          window.electronAPI.logDebug('[App.tsx] Failed to create AI session (already exists?)');
          return;
        }
      }

      const lang = localStorage.getItem('hotty_gemini_language') || 'English';

      // 1. Try to find persona from existing session's selected expertise
      let targetPersonaPrompt = 'You are a helpful assistant.';

      if (existingAiSession && existingAiSession.aiChatState?.selectedExpertise) {
        const expertiseLabel = existingAiSession.aiChatState.selectedExpertise;
        const foundPersona = currentPersonas.find(p => p.label === expertiseLabel);
        if (foundPersona) {
          targetPersonaPrompt = foundPersona.systemPrompt;
        }
      }
      // 2. If not found (or new session), fallback to first persona if available
      else if (currentPersonas.length > 0) {
        targetPersonaPrompt = currentPersonas[0].systemPrompt;
      }

      const defaultPersona = targetPersonaPrompt;

      let systemInstruction = '';
      let userPrompt = '';

      const existingCommand = currentCommands.find(c => c.id === type);

      if (existingCommand) {
        systemInstruction = `${defaultPersona} Answer in ${lang}.`;
        if (existingCommand.id === 'root-cause') {
          systemInstruction = `You are an expert troubleshooter. ${defaultPersona} Answer in ${lang}.`;
        }
        userPrompt = existingCommand.promptTemplate.replace('{selection}', selection);
      } else {
        // Fallback
        systemInstruction = `${defaultPersona} Answer in ${lang}.`;
        userPrompt = `Please explain the following text:\n\n${selection}`;
      }

      window.electronAPI.logDebug(`[App.tsx] Updating session state. Prompt: ${userPrompt.substring(0, 50)}...`);
      currentSession.updateSessionState(aiSessionId, {
        pendingMessage: userPrompt,
        systemInstruction: systemInstruction
      });
      window.electronAPI.logDebug('[App.tsx] Session state updated.');
    });

    return () => removeListener();
  }, []); // Empty dependency array ensures listener is bound ONLY ONCE

  // ... (rest of the file)



  // -- Settings Updaters --
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

  const updateLoggingEnabled = (enabled: boolean) => {
    setLoggingEnabled(enabled);
    localStorage.setItem('hterm_logging_enabled', enabled.toString());
  };

  const updateLoggingPath = (path: string) => {
    setLoggingPath(path);
    localStorage.setItem('hterm_logging_path', path);
  };

  // Theme Change Handler
  const updateTheme = (newTheme: 'dark' | 'light' | 'medium' | 'custom') => {
    setTheme(newTheme);

    if (newTheme === 'custom') {
      const shouldSetColorMode = paneBackgroundMode !== 'image';
      // Restore custom colors
      updateTerminalForeground(customColors.foreground);
      updateTerminalBackground(customColors.background);
      updateTerminalBackgroundInactive(customColors.backgroundInactive);
      updatePaneBackground(customColors.paneBackground);
      if (shouldSetColorMode) updatePaneBackgroundMode('color');
      return;
    }

    const themeDef = (themesData as any)[newTheme];
    if (themeDef && themeDef.terminal) {
      const { foreground, background, backgroundInactive, paneBackground: pBg } = themeDef.terminal;
      updateTerminalForeground(foreground);
      updateTerminalBackground(background);
      updateTerminalBackgroundInactive(backgroundInactive);
      updatePaneBackground(pBg);

      const shouldSetColorMode = paneBackgroundMode !== 'image';
      if (shouldSetColorMode) updatePaneBackgroundMode('color');
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

  const updateTerminalBackgroundInactive = (color: string) => {
    setTerminalBackgroundInactive(color);
    localStorage.setItem('hterm_terminal_background_inactive', color);
    if (theme === 'custom') {
      localStorage.setItem('hterm_custom_terminal_background_inactive', color);
      setCustomColors(prev => ({ ...prev, backgroundInactive: color }));
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

  const updatePaneBackgroundMode = (mode: 'color' | 'image' | 'default') => {
    setPaneBackgroundMode(mode);
    localStorage.setItem('hterm_pane_background_mode', mode);
  };

  const updatePaneBackgroundImage = (url: string) => {
    setPaneBackgroundImage(url);
    localStorage.setItem('hterm_pane_background_image', url);
  };

  // -- Paste Handlers --
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

  // -- Error Modal --
  const handleCloseErrorModal = () => {
    setErrorModalMessage(null);
    window.electronAPI.focusWindow();
  };

  // -- Early Return --
  if (!window.electronAPI) {
    return <div style={{ color: 'white', padding: '20px' }}>Loading Electron API...</div>;
  }

  // -- Derived State --
  const orderedTabs = session.tabOrder
    .map(id => session.sessions.find(s => s.id === id))
    .filter((s): s is Session => !!s);

  // -- Render --
  return (
    <div className="app-container">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-top">
          <LayoutSelector
            currentLayout={pane.layoutMode}
            onLayoutChange={pane.setLayoutMode}
          />
          <div
            className={`sidebar-btn ${showPaneLines ? 'sidebar-btn-active' : ''}`}
            onClick={() => setShowPaneLines(prev => !prev)}
            title="Show Tab-Pane Mapping"
            style={{ marginTop: '10px' }} // Add margin to separate from LayoutSelector
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
            className={`sidebar-btn ${lineWrapEnabled ? 'sidebar-btn-active' : ''}`}
            onClick={toggleLineWrap}
            title={lineWrapEnabled ? "Disable Line Wrap" : "Enable Line Wrap"}
          >
            {lineWrapEnabled ? (
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

      <div className="main-layout">
        {!isMediaAuthorized ? (
          <div className="content-area">
            <div className="empty-state">Loading background...</div>
          </div>
        ) : (
          <>
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
                activePaneId={pane.activePaneId || ''}
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
                terminalBackgroundInactive={terminalBackgroundInactive}
                paneBackground={paneBackground}
                paneBackgroundMode={paneBackgroundMode}
                paneBackgroundImage={paneBackgroundImage}
                lineWrapEnabled={lineWrapEnabled}
                showSystemPrompt={showSystemPrompt}
                askGeminiCommands={askGeminiCommands}
                aiPersonas={aiPersonas}
              />
            </div>
          </>
        )}
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
        terminalBackgroundInactive={terminalBackgroundInactive}
        onTerminalBackgroundInactiveChange={updateTerminalBackgroundInactive}
        paneBackground={paneBackground}
        onPaneBackgroundChange={updatePaneBackground}
        paneBackgroundMode={paneBackgroundMode}
        onPaneBackgroundModeChange={updatePaneBackgroundMode}
        paneBackgroundImage={paneBackgroundImage}
        onPaneBackgroundImageChange={updatePaneBackgroundImage}
        loggingEnabled={loggingEnabled}
        onLoggingEnabledChange={updateLoggingEnabled}
        loggingPath={loggingPath}
        onLoggingPathChange={updateLoggingPath}
        scrollback={scrollback}
        onScrollbackChange={updateScrollback}
        theme={theme}
        onThemeChange={updateTheme}
        showSystemPrompt={showSystemPrompt}
        onShowSystemPromptChange={updateShowSystemPrompt}
        askGeminiCommands={askGeminiCommands}
        onAskGeminiCommandsChange={updateAskGeminiCommands}
        aiPersonas={aiPersonas}
        onAiPersonasChange={updateAiPersonas}
        backspaceSendsDel={backspaceSendsDel}
        onBackspaceSendsDelChange={updateBackspaceSendsDel}
      />
      <PaneLines
        paneAllocations={pane.paneAllocations}
        totalPanes={pane.currentDims.rows * pane.currentDims.cols}
        visible={showPaneLines}
      />
      <ResizeGrip />
    </div>
  );
};

export default App
