import { useState, useRef, useEffect } from 'react'
import { ConnectionDialog } from './components/ConnectionDialog/ConnectionDialog'
import { TabBar } from './components/TabBar/TabBar'
import { ResizeGrip } from './components/ResizeGrip/ResizeGrip'
import { PasteConfirmationModal } from './components/PasteConfirmationModal/PasteConfirmationModal'
import { SettingsModal } from './components/SettingsModal/SettingsModal'
import { LayoutSelector } from './components/LayoutSelector/LayoutSelector'
import { GridLayout } from './components/GridLayout/GridLayout'
import { TerminalComponent } from './components/Terminal/Terminal'
import { AIChatPane } from './components/AIChatPane/AIChatPane'
import { MessageModal } from './components/MessageModal/MessageModal'
import { AskGeminiModal } from './components/AskGeminiModal/AskGeminiModal'

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

export interface PromptPattern {
  id: string;
  name: string;
  pattern: string;
  enabled: boolean;
}

const DEFAULT_PROMPT_PATTERNS: PromptPattern[] = [
  { id: 'cisco', name: 'Cisco / Allied Telesis', pattern: '^([a-zA-Z0-9_\\-\\.]+(?:\\([a-zA-Z0-9_\\-\\.]+\\))?[>#])\\s*', enabled: true },
  { id: 'huawei', name: 'Huawei / Yamaha', pattern: '^([<\\[][a-zA-Z0-9_\\-\\./]+[>\\]])\\s*', enabled: true },
  { id: 'juniper', name: 'Juniper', pattern: '^([-_\\w]+@[-_\\w]+[>#])\\s*', enabled: true },
  { id: 'linux', name: 'Linux', pattern: '^([-_\\w]+@[-_\\w]+:.*[$#])\\s*', enabled: true },
  { id: 'cmd', name: 'Command Prompt', pattern: '^([A-Za-z]:\\\\.*>)\\s*', enabled: true },
  { id: 'powershell', name: 'PowerShell', pattern: '^(PS\\s+[A-Za-z]:\\\\.*>)\\s*', enabled: true }
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
  // -- UI State --
  const [themesData, setThemesData] = useState<any>(null);
  const [showDialog, setShowDialog] = useState(true);
  const [globalMessage, setGlobalMessage] = useState<{ type: 'error' | 'success' | 'info', title?: string, message: string } | null>(null);
  const [focusTrigger, setFocusTrigger] = useState(0);

  // Load UI state from localStorage or default
  const [showLeftSidebar, setShowLeftSidebar] = useState(() => localStorage.getItem('hterm_ui_showLeftSidebar') === 'true');
  const [showRightSidebar, setShowRightSidebar] = useState(() => localStorage.getItem('hterm_ui_showRightSidebar') === 'true');
  const [sidebarPosition, setSidebarPosition] = useState<'left' | 'right'>(() => {
    return (localStorage.getItem('hterm_sidebar_position') as 'left' | 'right') || 'left';
  });
  const [showTopBar, setShowTopBar] = useState(() => localStorage.getItem('hterm_ui_showTopBar') === 'true');
  const [showBottomBar, setShowBottomBar] = useState(() => localStorage.getItem('hterm_ui_showBottomBar') === 'true');

  const [leftSidebarPercent, setLeftSidebarPercent] = useState(() => parseFloat(localStorage.getItem('hterm_ui_leftSidebarPercent') || '20'));
  const [rightSidebarPercent, setRightSidebarPercent] = useState(() => parseFloat(localStorage.getItem('hterm_ui_rightSidebarPercent') || '20'));
  const [topBarPercent, setTopBarPercent] = useState(() => parseFloat(localStorage.getItem('hterm_ui_topBarPercent') || '20'));
  const [bottomBarPercent, setBottomBarPercent] = useState(() => parseFloat(localStorage.getItem('hterm_ui_bottomBarPercent') || '20'));

  const [resizingSide, setResizingSide] = useState<'left' | 'right' | 'top' | 'bottom' | null>(null);

  // Persist UI State on change
  useEffect(() => localStorage.setItem('hterm_ui_showLeftSidebar', String(showLeftSidebar)), [showLeftSidebar]);
  useEffect(() => localStorage.setItem('hterm_ui_showRightSidebar', String(showRightSidebar)), [showRightSidebar]);
  useEffect(() => localStorage.setItem('hterm_ui_showTopBar', String(showTopBar)), [showTopBar]);
  useEffect(() => localStorage.setItem('hterm_ui_showBottomBar', String(showBottomBar)), [showBottomBar]);

  useEffect(() => localStorage.setItem('hterm_ui_leftSidebarPercent', String(leftSidebarPercent)), [leftSidebarPercent]);
  useEffect(() => localStorage.setItem('hterm_ui_rightSidebarPercent', String(rightSidebarPercent)), [rightSidebarPercent]);
  useEffect(() => localStorage.setItem('hterm_ui_topBarPercent', String(topBarPercent)), [topBarPercent]);
  useEffect(() => localStorage.setItem('hterm_ui_bottomBarPercent', String(bottomBarPercent)), [bottomBarPercent]);


  // -- Sidebar Resizing Logic --

  const sidebarResizingState = useRef<{
    side: 'left' | 'right' | 'top' | 'bottom';
    startPos: number; // X for left/right, Y for top/bottom
    startPercent: number;
    containerSize: number;
  } | null>(null);

  const handleSidebarResizeStart = (e: React.MouseEvent, side: 'left' | 'right' | 'top' | 'bottom') => {
    e.preventDefault();
    e.stopPropagation();

    setResizingSide(side);

    // Get container dimensions
    const container = document.querySelector('.app-container'); // Use outer container for width
    const centerColumn = document.querySelector('.center-column'); // Use center column for height

    const containerWidth = container ? container.clientWidth : window.innerWidth;
    const containerHeight = centerColumn ? centerColumn.clientHeight : window.innerHeight;

    sidebarResizingState.current = {
      side,
      startPos: side === 'left' || side === 'right' ? e.clientX : e.clientY,
      startPercent: side === 'left' ? leftSidebarPercent
        : side === 'right' ? rightSidebarPercent
          : side === 'top' ? topBarPercent
            : bottomBarPercent,
      containerSize: side === 'left' || side === 'right' ? containerWidth : containerHeight
    };

    document.addEventListener('mousemove', handleSidebarResizeMove);
    document.addEventListener('mouseup', handleSidebarResizeEnd);
    document.body.style.cursor = (side === 'left' || side === 'right') ? 'col-resize' : 'row-resize';
  };

  const handleSidebarResizeMove = (e: MouseEvent) => {
    if (!sidebarResizingState.current) return;

    const { side, startPos, startPercent, containerSize } = sidebarResizingState.current;

    if (side === 'left' || side === 'right') {
      const currentX = e.clientX;
      const deltaPx = side === 'left' ? currentX - startPos : startPos - currentX;
      const deltaPercent = (deltaPx / containerSize) * 100;

      const newPercent = Math.max(5, Math.min(80, startPercent + deltaPercent)); // Limit between 5% and 80%

      if (side === 'left') setLeftSidebarPercent(newPercent);
      else setRightSidebarPercent(newPercent);
    } else {
      const currentY = e.clientY;
      const deltaPx = side === 'top' ? currentY - startPos : startPos - currentY;
      const deltaPercent = (deltaPx / containerSize) * 100;

      const newPercent = Math.max(5, Math.min(80, startPercent + deltaPercent));

      if (side === 'top') setTopBarPercent(newPercent);
      else setBottomBarPercent(newPercent);
    }
  };

  const handleSidebarResizeEnd = () => {
    sidebarResizingState.current = null;
    setResizingSide(null);
    document.removeEventListener('mousemove', handleSidebarResizeMove);
    document.removeEventListener('mouseup', handleSidebarResizeEnd);
    document.body.style.cursor = '';
  };




  // Load themes on startup



  useEffect(() => {
    window.electronAPI.getThemes().then(setThemesData);
  }, []);



  const [pasteContent, setPasteContent] = useState<string | null>(null);
  const [pasteSessionId, setPasteSessionId] = useState<string | null>(null);

  // Settings State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Ask Gemini Free Format State
  const [askGeminiFreeFormatData, setAskGeminiFreeFormatData] = useState<{ selection: string } | null>(null);

  // Global keyboard shortcut: Ctrl+N → open New Connection dialog
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'n') {
        // Ignore if any modal is open
        if (isSettingsOpen || pasteContent !== null || globalMessage !== null) return;
        e.preventDefault();
        setShowDialog(true);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isSettingsOpen, pasteContent, globalMessage]);

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

  // Telnet KeepAlive State
  const [telnetKeepAliveEnabled, setTelnetKeepAliveEnabled] = useState<boolean>(() => {
    return localStorage.getItem('hterm_telnet_keepalive_enabled') !== 'false'; // default true
  });
  const [telnetKeepAliveInterval, setTelnetKeepAliveInterval] = useState<number>(() => {
    const saved = localStorage.getItem('hterm_telnet_keepalive_interval');
    return saved ? parseInt(saved, 10) : 30;
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

  const [paneBackgroundMode, setPaneBackgroundMode] = useState<'color' | 'image'>(() => {
    const saved = localStorage.getItem('hterm_pane_background_mode');
    if (saved === 'default') return 'color';
    return (saved as 'color' | 'image') || 'color';
  });
  const [paneBackgroundImage, setPaneBackgroundImage] = useState<string>(() => {
    return localStorage.getItem('hterm_pane_background_image') || 'HoTTY_background.svg';
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

  // Watch Buffer State
  const [watchBufferLimit, setWatchBufferLimit] = useState<number>(() => {
    const saved = localStorage.getItem('hotty_watch_buffer_limit');
    return saved ? parseInt(saved, 10) : 500000; // default 500k chars
  });

  const updateWatchBufferLimit = (limit: number) => {
    setWatchBufferLimit(limit);
    localStorage.setItem('hotty_watch_buffer_limit', limit.toString());
  };

  // Backspace Behavior State
  const [backspaceSendsDel, setBackspaceSendsDel] = useState<boolean>(() => {
    return localStorage.getItem('hterm_backspace_sends_del') === 'true'; // default false (0x08)
  });

  const updateBackspaceSendsDel = (sendsDel: boolean) => {
    setBackspaceSendsDel(sendsDel);
    localStorage.setItem('hterm_backspace_sends_del', sendsDel.toString());
  };

  // Right-Click Paste State
  const [rightClickPaste, setRightClickPaste] = useState<boolean>(() => {
    return localStorage.getItem('hterm_right_click_paste') !== 'false'; // default true
  });

  const updateRightClickPaste = (enabled: boolean) => {
    setRightClickPaste(enabled);
    localStorage.setItem('hterm_right_click_paste', enabled.toString());
  };

  // -- Pane Manager --
  const pane = usePaneManager({
    showLeftSidebar,
    showRightSidebar,
    showTopBar,
    showBottomBar,
  });



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
    telnetKeepAliveEnabled,
    telnetKeepAliveInterval,
    loggingEnabled,
    loggingPath,
    lineWrapEnabled,
    scrollback,
    backspaceSendsDel,
    onPasteRequest: handlePasteRequest,
    onSessionConnected: () => setShowDialog(false),
    onSessionError: (msg) => setGlobalMessage({ type: 'error', message: msg }),
    setPaneAllocations: pane.setPaneAllocations,
    setActivePaneId: pane.setActivePaneId,
    showLeftSidebar,
    showRightSidebar,
    showTopBar,
    showBottomBar,
    watchBufferLimit: watchBufferLimit,
  });

  // Show System Prompt State
  const [showSystemPrompt, setShowSystemPrompt] = useState<boolean>(() => {
    return localStorage.getItem('hotty_show_system_prompt') === 'true';
  });

  const updateShowSystemPrompt = (show: boolean) => {
    setShowSystemPrompt(show);
    localStorage.setItem('hotty_show_system_prompt', show.toString());
  };

  // Prompt Highlight State
  const [enablePromptHighlight, setEnablePromptHighlight] = useState<boolean>(() => {
    return localStorage.getItem('hotty_enable_prompt_highlight') !== 'false';
  });
  const [promptHighlightColor, setPromptHighlightColor] = useState<string>(() => {
    return localStorage.getItem('hotty_prompt_highlight_color') || 'rgba(255, 255, 255, 0.15)';
  });
  const [promptPatterns, setPromptPatterns] = useState<PromptPattern[]>(() => {
    const saved = localStorage.getItem('hotty_prompt_patterns');
    return saved ? JSON.parse(saved) : DEFAULT_PROMPT_PATTERNS;
  });

  const updateEnablePromptHighlight = (enabled: boolean) => {
    setEnablePromptHighlight(enabled);
    localStorage.setItem('hotty_enable_prompt_highlight', enabled.toString());
  };
  const updatePromptHighlightColor = (color: string) => {
    setPromptHighlightColor(color);
    localStorage.setItem('hotty_prompt_highlight_color', color);
  };
  const updatePromptPatterns = (patterns: PromptPattern[]) => {
    setPromptPatterns(patterns);
    localStorage.setItem('hotty_prompt_patterns', JSON.stringify(patterns));
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
    const handleAskGemini = (selection: string, type: string, targetSessionId?: string) => {
      // If we got the special watch buffer marker, treat selection as empty
      const actualSelection = selection === '__WATCH_BUFFER__' ? '' : selection;
      window.electronAPI.logDebug(`[App.tsx] onAskGemini triggered. Type: ${type}, Selection length: ${actualSelection?.length}`);

      const currentSession = sessionRef.current;
      const currentPane = paneRef.current;
      const currentCommands = askGeminiCommandsRef.current;
      const currentPersonas = aiPersonasRef.current; // Get current personas

      // Extract Watch Buffer before changing active pane
      const activeTermId = targetSessionId || currentPane.activePaneId;
      const activeSession = currentSession.sessions.find(s => s.id === activeTermId);
      let prependedContext = '';
      if (activeSession?.isWatching) {
        const buffer = currentSession.getWatchBuffer(activeTermId);
        if (buffer) {
          prependedContext = `[Watched Terminal Output]\n${buffer}\n================\n`;
        }
      }

      const finalSelection = prependedContext ? (actualSelection ? `${prependedContext}[Target Text]\n${actualSelection}` : prependedContext) : actualSelection;

      if (!finalSelection) {
        window.electronAPI.logDebug('[App.tsx] Selection and buffer are empty, ignoring.');
        return;
      }

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

      if (type === 'analyze-watch') {
        systemInstruction = `${defaultPersona} Answer in ${lang}.`;
        userPrompt = `Please analyze the following terminal output and point out any errors, warnings, or findings of interest:\n\n${finalSelection}`;
      } else if (type === 'free-format') {
        // Open modal instead of sending immediately
        setAskGeminiFreeFormatData({ selection: finalSelection });
        return;
      } else {
        const existingCommand = currentCommands.find(c => c.id === type);

        if (existingCommand) {
          systemInstruction = `${defaultPersona} Answer in ${lang}.`;
          if (existingCommand.id === 'root-cause') {
            systemInstruction = `You are an expert troubleshooter. ${defaultPersona} Answer in ${lang}.`;
          }
          userPrompt = existingCommand.promptTemplate.replace('{selection}', finalSelection);
        } else {
          // Fallback
          systemInstruction = `${defaultPersona} Answer in ${lang}.`;
          userPrompt = `Please explain the following text:\n\n${finalSelection}`;
        }
      }

      window.electronAPI.logDebug(`[App.tsx] Updating session state. Prompt: ${userPrompt.substring(0, 50)}...`);
      console.log(`[App.tsx] Updating session state. Prompt: ${userPrompt.substring(0, 50)}...`);
      currentSession.updateSessionState(aiSessionId, {
        pendingMessage: userPrompt,
        systemInstruction: systemInstruction
      });
      window.electronAPI.logDebug('[App.tsx] Session state updated.');
      console.log('[App.tsx] Session state updated.');
    };

    const removeListener = window.electronAPI.onAskGemini(handleAskGemini);

    const handleCustomAskGemini = (e: Event) => {
      const customEvent = e as CustomEvent<{ selection: string, type: string, sessionId?: string }>;
      console.log('[App.tsx] handleCustomAskGemini triggered with detail:', customEvent.detail);
      window.electronAPI.logDebug(`[App.tsx] handleCustomAskGemini triggered with type: ${customEvent.detail?.type}`);
      if (customEvent.detail) {
        handleAskGemini(customEvent.detail.selection, customEvent.detail.type, customEvent.detail.sessionId);
      }
    };
    window.addEventListener('ask-gemini-internal', handleCustomAskGemini);

    return () => {
      removeListener();
      window.removeEventListener('ask-gemini-internal', handleCustomAskGemini);
    };
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

  const updateTelnetKeepAliveEnabled = (enabled: boolean) => {
    setTelnetKeepAliveEnabled(enabled);
    localStorage.setItem('hterm_telnet_keepalive_enabled', enabled.toString());
  };

  const updateTelnetKeepAliveInterval = (interval: number) => {
    setTelnetKeepAliveInterval(interval);
    localStorage.setItem('hterm_telnet_keepalive_interval', interval.toString());
  };

  const updateLoggingEnabled = (enabled: boolean) => {
    setLoggingEnabled(enabled);
    localStorage.setItem('hterm_logging_enabled', enabled.toString());
    // Apply to existing sessions immediately
    window.electronAPI.updateLogging(enabled, loggingPath);
  };

  const updateLoggingPath = (path: string) => {
    setLoggingPath(path);
    localStorage.setItem('hterm_logging_path', path);
    // Apply to existing sessions immediately if logging is enabled
    if (loggingEnabled && path) {
      window.electronAPI.updateLogging(loggingEnabled, path);
    }
  };

  const updateSidebarPosition = (pos: 'left' | 'right') => {
    setSidebarPosition(pos);
    localStorage.setItem('hterm_sidebar_position', pos);
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

  const updatePaneBackgroundMode = (mode: 'color' | 'image') => {
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

  const handleAskGeminiSubmit = (prompt: string, selection: string) => {
    const currentSession = sessionRef.current;
    const currentPane = paneRef.current;

    // AI session is already created or found in handleAskGemini before the modal opens
    // but just in case, we find it here
    const aiSession = currentSession.sessions.find(s => s.type === 'ai');
    if (aiSession) {
      const lang = localStorage.getItem('hotty_gemini_language') || 'English';
      let targetPersonaPrompt = 'You are a helpful assistant.';
      const currentPersonas = aiPersonasRef.current;

      if (aiSession.aiChatState?.selectedExpertise) {
        const expertiseLabel = aiSession.aiChatState.selectedExpertise;
        const foundPersona = currentPersonas.find(p => p.label === expertiseLabel);
        if (foundPersona) {
          targetPersonaPrompt = foundPersona.systemPrompt;
        }
      } else if (currentPersonas.length > 0) {
        targetPersonaPrompt = currentPersonas[0].systemPrompt;
      }

      const systemInstruction = `${targetPersonaPrompt} Answer in ${lang}.`;
      const userPrompt = `${prompt}\n\n\`\`\`\n${selection}\n\`\`\``;

      console.log(`[Ask Gemini Modal] Submitting free format request...`);
      currentSession.updateSessionState(aiSession.id, {
        pendingMessage: userPrompt,
        systemInstruction: systemInstruction
      });
      currentPane.setActivePaneId(aiSession.id);
    }
    setAskGeminiFreeFormatData(null);
  };

  // -- Message Modal --
  const handleCloseMessageModal = () => {
    setGlobalMessage(null);
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

  const watchedSessionIds = session.sessions.filter(s => s.isWatching).map(s => s.id);
  const nonEmptyBufferSessionIds = session.sessions.filter(s => s.hasWatchData).map(s => s.id);

  const handleAskGeminiFromTab = (sessionId: string) => {
    // Switch to the target tab first to ensure context
    pane.setActivePaneId(sessionId);

    // Prepare menu items: default analysis + user-defined commands
    const menuCommands = [
      { id: 'analyze-watch', label: 'Analyze Watched Output' },
      ...askGeminiCommands.map(c => ({ id: c.id, label: c.label }))
    ];

    // Show native context menu at current mouse position
    // Use special selection marker to hide Paste and enable Gemini without real selection
    window.electronAPI.showContextMenu('__WATCH_BUFFER__', menuCommands);
  };

  // -- Render --
  return (
    <div className="app-container">
      {/* Sidebar */}
      <div className={`sidebar ${sidebarPosition === 'right' ? 'sidebar-right' : ''}`}>
        <div className="sidebar-top">
          <LayoutSelector
            currentLayout={pane.layoutMode}
            onLayoutChange={pane.setLayoutMode}
            showLeftSidebar={showLeftSidebar}
            onToggleLeftSidebar={() => setShowLeftSidebar(prev => !prev)}
            showRightSidebar={showRightSidebar}
            onToggleRightSidebar={() => setShowRightSidebar(prev => !prev)}
            showTopBar={showTopBar}
            onToggleTopBar={() => setShowTopBar(prev => !prev)}
            showBottomBar={showBottomBar}
            onToggleBottomBar={() => setShowBottomBar(prev => !prev)}
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
        <>
          <div className="top-bar">
            <TabBar
              tabs={orderedTabs}
              activeTabId={pane.activeSessionId}
              visibleSessionIds={pane.visibleSessionIds}
              watchedSessionIds={watchedSessionIds}
              nonEmptyBufferSessionIds={nonEmptyBufferSessionIds}
              onTabClick={pane.handleTabClick}
              onTabClose={session.closeSession}
              onToggleWatch={session.toggleWatch}
              onAskGeminiTab={handleAskGeminiFromTab}
              onNewTab={() => setShowDialog(true)}
              onNewAITab={() => session.createAISession()}
              onTabReorder={session.handleTabReorder}
            />
          </div>
          <div className="content-area" style={{ display: 'flex', flexDirection: 'row', width: '100%', height: '100%', gap: '0' }}>


            {showLeftSidebar && (
              <div
                className="left-sidebar-pane"
                data-pane-id="sidebar-left"
                style={{
                  width: `${leftSidebarPercent}%`,
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  flexDirection: 'column',
                  backgroundColor: paneBackground || '#000000',
                  backgroundImage: paneBackgroundMode === 'image' ? `url("${paneBackgroundImage || ''}")` : 'none',
                  backgroundSize: paneBackgroundMode === 'image' ? 'auto' : 'auto',
                  backgroundRepeat: 'repeat',
                  backgroundPosition: 'center',
                  position: 'relative',
                  flexShrink: 0,
                  margin: '2px' // Gap all around to match grid padding
                }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}


                onDrop={(e) => {
                  e.preventDefault();
                  const sessionId = e.dataTransfer.getData('text/plain');
                  if (sessionId) {
                    pane.handleDropSession(sessionId, 'sidebar-left');
                  }
                }}
                onClick={() => pane.setActivePaneId('sidebar-left')}
              >
                {(() => {
                  const sessionId = pane.paneAllocations['sidebar-left'];
                  const sessionData = session.sessions.find(s => s.id === sessionId);
                  const isActive = pane.activePaneId === 'sidebar-left';

                  if (sessionData) {
                    return sessionData.type === 'ai' ? (
                      <AIChatPane
                        sessionId={sessionData.id}
                        initialState={sessionData.aiChatState}
                        onStateChange={(newState) => session.updateSessionState(sessionData.id, newState)}
                        showSystemPrompt={showSystemPrompt}
                        askGeminiCommands={askGeminiCommands}
                        aiPersonas={aiPersonas}
                        fontSize={fontSize}
                        terminalBackground={terminalBackground}
                        terminalBackgroundInactive={terminalBackgroundInactive || undefined}
                      />
                    ) : (
                      <TerminalComponent
                        key={sessionData.id}
                        sessionId={sessionData.id}
                        onData={session.handleTerminalData}
                        isActive={isActive}
                        focusTrigger={focusTrigger}
                        terminalInstance={session.terminalRegistry.current[sessionData.id]}
                        disableFocus={showDialog || !!globalMessage}
                        fontSize={fontSize}
                        fontFamily={fontFamily}
                        terminalForeground={terminalForeground}
                        terminalBackground={terminalBackground}
                        terminalBackgroundInactive={terminalBackgroundInactive || undefined}
                        lineWrapEnabled={lineWrapEnabled}
                        askGeminiCommands={askGeminiCommands}
                        enablePromptHighlight={enablePromptHighlight}
                        promptHighlightColor={promptHighlightColor}
                        promptPatterns={promptPatterns}
                        onPasteRequest={(text) => handlePasteRequest(sessionData.id, text)}
                      />
                    );
                  } else {
                    return (
                      <div className="empty-pane-placeholder">
                        <span className="pane-label">Left Sidebar</span>
                        <span className="drop-hint">Drop Tab Here</span>
                      </div>
                    );
                  }
                })()}
              </div>
            )}

            {showLeftSidebar && (
              <div
                className={`sidebar-resizer ${resizingSide === 'left' ? 'interact' : ''}`}
                onMouseDown={(e) => handleSidebarResizeStart(e, 'left')}
              />
            )}


            {/* Center Column: TopBar + Grid + BottomBar */}
            <div className="center-column" style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, height: '100%', position: 'relative' }}>

              {/* Top Bar */}
              {showTopBar && (
                <div
                  className="top-bar-pane"
                  data-pane-id="top-bar"
                  style={{
                    height: `${topBarPercent}%`,
                    // width: '100%', // Removed to prevent overflow with margin
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    flexDirection: 'column',
                    backgroundColor: paneBackground || '#000000',
                    backgroundImage: paneBackgroundMode === 'image' ? `url("${paneBackgroundImage || ''}")` : 'none',
                    backgroundSize: paneBackgroundMode === 'image' ? 'auto' : 'auto',
                    backgroundRepeat: 'repeat',
                    backgroundPosition: 'center',
                    position: 'relative',
                    flexShrink: 0,
                    margin: '2px' // Gap
                  }}

                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const sessionId = e.dataTransfer.getData('text/plain');
                    if (sessionId) {
                      pane.handleDropSession(sessionId, 'top-bar'); // Use specific ID
                    }
                  }}
                  onClick={() => pane.setActivePaneId('top-bar')}
                >
                  {/* Top Bar Content */}
                  {(() => {
                    const sessionId = pane.paneAllocations['top-bar'];
                    const sessionData = session.sessions.find(s => s.id === sessionId);

                    if (sessionData) {
                      // Render session... (simplified for brevity, should duplicate logic or extract component)
                      return sessionData.type === 'ai' ? (
                        <AIChatPane
                          sessionId={sessionData.id}
                          initialState={sessionData.aiChatState}
                          onStateChange={(newState) => session.updateSessionState(sessionData.id, newState)}
                          showSystemPrompt={showSystemPrompt}
                          askGeminiCommands={askGeminiCommands}
                          aiPersonas={aiPersonas}
                          fontSize={fontSize}
                          terminalBackground={terminalBackground}
                          terminalBackgroundInactive={terminalBackgroundInactive || undefined}
                        />
                      ) : (
                        <TerminalComponent
                          key={sessionData.id}
                          sessionId={sessionData.id}
                          onData={session.handleTerminalData}
                          isActive={pane.activePaneId === 'top-bar'}
                          focusTrigger={focusTrigger}
                          terminalInstance={session.terminalRegistry.current[sessionData.id]}
                          disableFocus={showDialog || !!globalMessage}
                          fontSize={fontSize}
                          fontFamily={fontFamily}
                          terminalForeground={terminalForeground}
                          terminalBackground={terminalBackground}
                          terminalBackgroundInactive={terminalBackgroundInactive || undefined}
                          lineWrapEnabled={lineWrapEnabled}
                          askGeminiCommands={askGeminiCommands}
                          enablePromptHighlight={enablePromptHighlight}
                          promptHighlightColor={promptHighlightColor}
                          promptPatterns={promptPatterns}
                          onPasteRequest={(text) => handlePasteRequest(sessionData.id, text)}
                        />
                      );
                    } else {
                      return (
                        <div className="empty-pane-placeholder">
                          <span className="pane-label">Top Bar</span>
                          <span className="drop-hint">Drop Tab Here</span>
                        </div>
                      );
                    }
                  })()}
                </div>
              )}

              {/* Top Bar Resizer */}
              {showTopBar && (
                <div
                  className={`sidebar-resizer-h ${resizingSide === 'top' ? 'interact' : ''}`}
                  onMouseDown={(e) => handleSidebarResizeStart(e, 'top')}
                />
              )}

              {/* Grid Layout Container */}
              <div style={{ flex: 1, minHeight: 0, width: '100%' }}>
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
                  disableFocus={showDialog || !!globalMessage}
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
                  enablePromptHighlight={enablePromptHighlight}
                  promptHighlightColor={promptHighlightColor}
                  promptPatterns={promptPatterns}
                  onPasteRequest={(text) => {
                    const activePaneSessionId = pane.paneAllocations[pane.activePaneId || ''];
                    if (activePaneSessionId) handlePasteRequest(activePaneSessionId, text);
                  }}
                />
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
                  className="bottom-bar-pane"
                  data-pane-id="bottom-bar"
                  style={{
                    height: `${bottomBarPercent}%`,
                    // width: '100%', // Removed to prevent overflow
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    flexDirection: 'column',
                    backgroundColor: paneBackground || '#000000',
                    backgroundImage: paneBackgroundMode === 'image' ? `url("${paneBackgroundImage || ''}")` : 'none',
                    backgroundSize: paneBackgroundMode === 'image' ? 'auto' : 'auto',
                    backgroundRepeat: 'repeat',
                    backgroundPosition: 'center',
                    position: 'relative',
                    flexShrink: 0,
                    margin: '2px' // Gap
                  }}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const sessionId = e.dataTransfer.getData('text/plain');
                    if (sessionId) {
                      pane.handleDropSession(sessionId, 'bottom-bar'); // Use specific ID
                    }
                  }}
                  onClick={() => pane.setActivePaneId('bottom-bar')}
                >
                  {/* Bottom Bar Content */}
                  {(() => {
                    const sessionId = pane.paneAllocations['bottom-bar'];
                    const sessionData = session.sessions.find(s => s.id === sessionId);

                    if (sessionData) {
                      // Render session...
                      return sessionData.type === 'ai' ? (
                        <AIChatPane
                          sessionId={sessionData.id}
                          initialState={sessionData.aiChatState}
                          onStateChange={(newState) => session.updateSessionState(sessionData.id, newState)}
                          showSystemPrompt={showSystemPrompt}
                          askGeminiCommands={askGeminiCommands}
                          aiPersonas={aiPersonas}
                          fontSize={fontSize}
                          terminalBackground={terminalBackground}
                          terminalBackgroundInactive={terminalBackgroundInactive || undefined}
                        />
                      ) : (
                        <TerminalComponent
                          key={sessionData.id}
                          sessionId={sessionData.id}
                          onData={session.handleTerminalData}
                          isActive={pane.activePaneId === 'bottom-bar'}
                          focusTrigger={focusTrigger}
                          terminalInstance={session.terminalRegistry.current[sessionData.id]}
                          disableFocus={showDialog || !!globalMessage}
                          fontSize={fontSize}
                          fontFamily={fontFamily}
                          terminalForeground={terminalForeground}
                          terminalBackground={terminalBackground}
                          terminalBackgroundInactive={terminalBackgroundInactive || undefined}
                          lineWrapEnabled={lineWrapEnabled}
                          askGeminiCommands={askGeminiCommands}
                          enablePromptHighlight={enablePromptHighlight}
                          promptHighlightColor={promptHighlightColor}
                          promptPatterns={promptPatterns}
                          onPasteRequest={(text) => handlePasteRequest(sessionData.id, text)}
                        />
                      );
                    } else {
                      return (
                        <div className="empty-pane-placeholder">
                          <span className="pane-label">Bottom Bar</span>
                          <span className="drop-hint">Drop Tab Here</span>
                        </div>
                      );
                    }
                  })()}
                </div>
              )}

            </div>


            {showRightSidebar && (
              <div
                className={`sidebar-resizer ${resizingSide === 'right' ? 'interact' : ''}`}
                onMouseDown={(e) => handleSidebarResizeStart(e, 'right')}
              />
            )}

            {showRightSidebar && (
              <div
                className="right-sidebar-pane"
                data-pane-id="sidebar"
                style={{
                  width: `${rightSidebarPercent}%`,
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  flexDirection: 'column',
                  backgroundColor: paneBackground || '#000000',
                  backgroundImage: paneBackgroundMode === 'image' ? `url("${paneBackgroundImage || ''}")` : 'none',
                  backgroundSize: paneBackgroundMode === 'image' ? 'auto' : 'auto',
                  backgroundRepeat: 'repeat',
                  backgroundPosition: 'center',
                  position: 'relative',
                  flexShrink: 0,
                  margin: '2px' // Gap all around to match grid padding
                }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}


                onDrop={(e) => {
                  e.preventDefault();
                  const sessionId = e.dataTransfer.getData('text/plain');
                  if (sessionId) {
                    pane.handleDropSession(sessionId, 'sidebar');
                  }
                }}
                onClick={() => pane.setActivePaneId('sidebar')}
              >
                {(() => {
                  const sessionId = pane.paneAllocations['sidebar'];
                  const sessionData = session.sessions.find(s => s.id === sessionId);
                  const isActive = pane.activePaneId === 'sidebar';

                  if (sessionData) {
                    return sessionData.type === 'ai' ? (
                      <AIChatPane
                        sessionId={sessionData.id}
                        initialState={sessionData.aiChatState}
                        onStateChange={(newState) => session.updateSessionState(sessionData.id, newState)}
                        showSystemPrompt={showSystemPrompt}
                        askGeminiCommands={askGeminiCommands}
                        aiPersonas={aiPersonas}
                        fontSize={fontSize}
                        terminalBackground={terminalBackground}
                        terminalBackgroundInactive={terminalBackgroundInactive || undefined}
                      />
                    ) : (
                      <TerminalComponent
                        key={sessionData.id}
                        sessionId={sessionData.id}
                        onData={session.handleTerminalData}
                        isActive={isActive}
                        focusTrigger={focusTrigger}
                        terminalInstance={session.terminalRegistry.current[sessionData.id]}
                        disableFocus={showDialog || !!globalMessage}
                        fontSize={fontSize}
                        fontFamily={fontFamily}
                        terminalForeground={terminalForeground}
                        terminalBackground={terminalBackground}
                        terminalBackgroundInactive={terminalBackgroundInactive || undefined}
                        lineWrapEnabled={lineWrapEnabled}
                        askGeminiCommands={askGeminiCommands}
                        onPasteRequest={(text) => handlePasteRequest(sessionData.id, text)}
                      />
                    );
                  } else {
                    return (
                      <div className="empty-pane-placeholder">
                        <span className="pane-label">Sidebar</span>
                        <span className="drop-hint">Drop Tab Here</span>
                      </div>
                    );
                  }
                })()}
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
          />
        )}

        {
          globalMessage && (
            <MessageModal
              type={globalMessage.type}
              title={globalMessage.title}
              message={globalMessage.message}
              onClose={handleCloseMessageModal}
            />
          )
        }

        {
          pasteContent !== null && (
            <PasteConfirmationModal
              content={pasteContent}
              onConfirm={confirmPaste}
              onCancel={cancelPaste}
            />
          )
        }

        {
          askGeminiFreeFormatData !== null && (
            <AskGeminiModal
              isOpen={true}
              selection={askGeminiFreeFormatData.selection}
              onClose={() => setAskGeminiFreeFormatData(null)}
              onSubmit={handleAskGeminiSubmit}
            />
          )
        }

        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          onLogout={session.closeAllAISessions}
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
          telnetKeepAliveEnabled={telnetKeepAliveEnabled}
          onTelnetKeepAliveEnabledChange={updateTelnetKeepAliveEnabled}
          telnetKeepAliveInterval={telnetKeepAliveInterval}
          onTelnetKeepAliveIntervalChange={updateTelnetKeepAliveInterval}
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
          sidebarPosition={sidebarPosition}
          onSidebarPositionChange={updateSidebarPosition}
          showSystemPrompt={showSystemPrompt}
          onShowSystemPromptChange={updateShowSystemPrompt}
          askGeminiCommands={askGeminiCommands}
          onAskGeminiCommandsChange={updateAskGeminiCommands}
          aiPersonas={aiPersonas}
          onAiPersonasChange={updateAiPersonas}
          backspaceSendsDel={backspaceSendsDel}
          onBackspaceSendsDelChange={updateBackspaceSendsDel}
          rightClickPaste={rightClickPaste}
          onRightClickPasteChange={updateRightClickPaste}
          enablePromptHighlight={enablePromptHighlight}
          onEnablePromptHighlightChange={updateEnablePromptHighlight}
          promptHighlightColor={promptHighlightColor}
          onPromptHighlightColorChange={updatePromptHighlightColor}
          promptPatterns={promptPatterns}
          onPromptPatternsChange={updatePromptPatterns}
          watchBufferLimit={watchBufferLimit}
          onWatchBufferLimitChange={updateWatchBufferLimit}
        />
        <PaneLines
          paneAllocations={pane.paneAllocations}
          totalPanes={pane.currentDims.rows * pane.currentDims.cols}
          visible={showPaneLines}
        />
        <ResizeGrip />
      </div>
    </div>
  );
};

export default App;
