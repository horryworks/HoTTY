import { useState, useEffect, useCallback, useRef } from 'react';
import type { PersonaDefinition } from '../types/appTypes';
import type { SessionRecord } from './useSessionManager';
import type { FeaturePaneInfo } from '../utils/paneTypes';
import { STORAGE_KEYS } from '../constants/storage';
import { buildExecutionRules, languageDirective } from '../constants/aiPrompts';
import { tauriService } from '../services/tauriService';
import { sessionBindingKey } from '../utils/sessionBindingKey';

// -- Types --

/**
 * One conversation tab inside the (singleton) AI Chat pane.
 * Phase 1: each tab has at most one linked terminal session (multi-link is Phase 2).
 */
export interface ChatTab {
  id: string;
  /** Auto-derived from linkedSessionId; updated on link change. */
  title: string;
  /** Stable counter used for "Tab N" titles when no link is set. */
  ordinal: number;
  linkedSessionId?: string;
  /**
   * Config-derived identity of the linked terminal (see `sessionBindingKey`),
   * stable across disconnect+reconnect. Set whenever the tab links to a session
   * and RETAINED when the session is removed so the tab can auto-rebind to a
   * reconnected session with the same target. Cleared on explicit unlink
   * (Watch toggle-off).
   */
  linkBindingKey?: string;
  pendingMessage?: string;
}

export interface AiChatState {
  selectedModel: string;
  selectedExpertise?: string;
  systemInstruction: string;
  activeTabId: string;
  tabs: ChatTab[];
}

interface UseAiChatOptions {
  sessions: Map<string, SessionRecord>;
  featurePanes: Map<string, FeaturePaneInfo>;
  aiPersonas: PersonaDefinition[];
  getWatchBuffer: (sessionId: string) => string;
  clearWatchBuffer: (sessionId: string) => void;
  createAiChatPane: () => string | undefined;
  lastTerminalSessionId: string | null;
  paneAllocations: Record<string, string | null>;
  activePaneId: string | null;
  setActivePaneId: (id: string) => void;
}

interface UseAiChatReturn {
  aiChatStates: Map<string, AiChatState>;
  updateAiChatState: (aiSessionId: string, newState: Partial<AiChatState>) => void;
  updateActiveTab: (aiSessionId: string, partial: Partial<ChatTab>) => void;
  updateTabById: (aiSessionId: string, tabId: string, partial: Partial<ChatTab>) => void;
  addTab: (aiSessionId: string, initialLinkSessionId?: string) => string;
  closeTab: (aiSessionId: string, tabId: string) => void;
  setActiveTab: (aiSessionId: string, tabId: string) => void;
  setTabLink: (aiSessionId: string, tabId: string, linkedSessionId: string | undefined, opts?: { retainBindingKey?: boolean }) => void;
  sendMessage: (aiSessionId: string, text: string) => void;
  askAi: (selection: string, type: string, targetSessionId?: string) => void;
  showPromptMenu: (aiSessionId: string) => void;
  askAiFreeFormatData: { selection: string } | null;
  setAskAiFreeFormatData: (data: { selection: string } | null) => void;
  handleFreeFormatSubmit: (prompt: string, selection: string) => void;
}

// -- Pure helpers --

export function getActiveTab(state: AiChatState | undefined): ChatTab | undefined {
  if (!state) return undefined;
  return state.tabs.find(t => t.id === state.activeTabId);
}

/** Build a short title from a tab's linked session, falling back to "Tab N". */
function deriveTabTitle(
  linkedSessionId: string | undefined,
  sessions: Map<string, SessionRecord>,
  ordinal: number,
): string {
  if (!linkedSessionId) return `Tab ${ordinal}`;
  const name = sessions.get(linkedSessionId)?.displayName;
  if (!name) return `Tab ${ordinal}`;
  return name.length > 12 ? `${name.slice(0, 11)}…` : name;
}

function makeTabId(): string {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createDefaultAiChatState(
  initialLinkSessionId?: string,
  initialTitle?: string,
  initialBindingKey?: string,
): AiChatState {
  const tabId = makeTabId();
  return {
    selectedModel: '',
    systemInstruction: 'You are a helpful assistant.',
    activeTabId: tabId,
    tabs: [{
      id: tabId,
      ordinal: 1,
      title: initialTitle ?? (initialLinkSessionId ? 'Linked' : 'Tab 1'),
      linkedSessionId: initialLinkSessionId,
      linkBindingKey: initialLinkSessionId ? initialBindingKey : undefined,
    }],
  };
}

// -- Hook --

export function useAiChat(options: UseAiChatOptions): UseAiChatReturn {
  const {
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
  } = options;

  const [aiChatStates, setAiChatStates] = useState<Map<string, AiChatState>>(() => new Map());
  const [askAiFreeFormatData, setAskAiFreeFormatData] = useState<{ selection: string } | null>(null);

  // Refs for stable access in callbacks
  const sessionsRef = useRef(sessions);
  const featurePanesRef = useRef(featurePanes);
  const aiPersonasRef = useRef(aiPersonas);
  const lastTerminalSessionIdRef = useRef(lastTerminalSessionId);
  const paneAllocationsRef = useRef(paneAllocations);
  const activePaneIdRef = useRef(activePaneId);
  const aiChatStatesRef = useRef(aiChatStates);

  useEffect(() => {
    sessionsRef.current = sessions;
    featurePanesRef.current = featurePanes;
    aiPersonasRef.current = aiPersonas;
    lastTerminalSessionIdRef.current = lastTerminalSessionId;
    paneAllocationsRef.current = paneAllocations;
    activePaneIdRef.current = activePaneId;
    aiChatStatesRef.current = aiChatStates;
  });

  const getWatchBufferRef = useRef(getWatchBuffer);
  const clearWatchBufferRef = useRef(clearWatchBuffer);
  const createAiChatPaneRef = useRef(createAiChatPane);
  const setActivePaneIdRef = useRef(setActivePaneId);

  useEffect(() => {
    getWatchBufferRef.current = getWatchBuffer;
    clearWatchBufferRef.current = clearWatchBuffer;
    createAiChatPaneRef.current = createAiChatPane;
    setActivePaneIdRef.current = setActivePaneId;
  });

  // -- State updaters --

  const updateAiChatState = useCallback((aiSessionId: string, newState: Partial<AiChatState>) => {
    setAiChatStates((prev) => {
      const next = new Map(prev);
      const existing = prev.get(aiSessionId) ?? createDefaultAiChatState();
      next.set(aiSessionId, { ...existing, ...newState });
      return next;
    });
  }, []);

  const updateActiveTab = useCallback((aiSessionId: string, partial: Partial<ChatTab>) => {
    setAiChatStates((prev) => {
      const next = new Map(prev);
      const existing = prev.get(aiSessionId);
      if (!existing) return prev;
      const updatedTabs = existing.tabs.map(t =>
        t.id === existing.activeTabId ? { ...t, ...partial } : t
      );
      next.set(aiSessionId, { ...existing, tabs: updatedTabs });
      return next;
    });
  }, []);

  /** Update a specific tab by id. Used to deliver in-flight command results to the
      tab that issued the command, even if the user has switched to a different tab. */
  const updateTabById = useCallback((aiSessionId: string, tabId: string, partial: Partial<ChatTab>) => {
    setAiChatStates((prev) => {
      const next = new Map(prev);
      const existing = prev.get(aiSessionId);
      if (!existing) return prev;
      if (!existing.tabs.find(t => t.id === tabId)) return prev;
      const updatedTabs = existing.tabs.map(t =>
        t.id === tabId ? { ...t, ...partial } : t
      );
      next.set(aiSessionId, { ...existing, tabs: updatedTabs });
      return next;
    });
  }, []);

  const setActiveTab = useCallback((aiSessionId: string, tabId: string) => {
    setAiChatStates((prev) => {
      const next = new Map(prev);
      const existing = prev.get(aiSessionId);
      if (!existing) return prev;
      if (!existing.tabs.find(t => t.id === tabId)) return prev;
      next.set(aiSessionId, { ...existing, activeTabId: tabId });
      return next;
    });
  }, []);

  const addTab = useCallback((aiSessionId: string, initialLinkSessionId?: string): string => {
    const newTabId = makeTabId();
    setAiChatStates((prev) => {
      const next = new Map(prev);
      const existing = prev.get(aiSessionId) ?? createDefaultAiChatState();
      const ordinals = existing.tabs.map(t => t.ordinal);
      const newOrdinal = ordinals.length > 0 ? Math.max(...ordinals) + 1 : 1;
      const title = deriveTabTitle(initialLinkSessionId, sessionsRef.current, newOrdinal);
      const linkedRec = initialLinkSessionId ? sessionsRef.current.get(initialLinkSessionId) : undefined;
      const newTab: ChatTab = {
        id: newTabId,
        ordinal: newOrdinal,
        title,
        linkedSessionId: initialLinkSessionId,
        linkBindingKey: linkedRec ? sessionBindingKey(linkedRec) : undefined,
      };
      next.set(aiSessionId, {
        ...existing,
        activeTabId: newTabId,
        tabs: [...existing.tabs, newTab],
      });
      return next;
    });
    return newTabId;
  }, []);

  const closeTab = useCallback((aiSessionId: string, tabId: string) => {
    setAiChatStates((prev) => {
      const next = new Map(prev);
      const existing = prev.get(aiSessionId);
      if (!existing) return prev;
      // Guard: keep at least one tab
      if (existing.tabs.length <= 1) return prev;
      const idx = existing.tabs.findIndex(t => t.id === tabId);
      if (idx < 0) return prev;
      const remaining = existing.tabs.filter(t => t.id !== tabId);
      let newActive = existing.activeTabId;
      if (existing.activeTabId === tabId) {
        // Pick neighbor: prefer next, else previous
        newActive = (remaining[idx] ?? remaining[idx - 1] ?? remaining[0]).id;
      }
      next.set(aiSessionId, { ...existing, tabs: remaining, activeTabId: newActive });
      return next;
    });
  }, []);

  const setTabLink = useCallback((aiSessionId: string, tabId: string, linkedSessionId: string | undefined, opts?: { retainBindingKey?: boolean }) => {
    setAiChatStates((prev) => {
      const next = new Map(prev);
      const existing = prev.get(aiSessionId);
      if (!existing) return prev;
      const updatedTabs = existing.tabs.map(t => {
        if (t.id !== tabId) return t;
        const newTitle = deriveTabTitle(linkedSessionId, sessionsRef.current, t.ordinal);
        // Track a config-derived binding key so the tab can auto-rebind after a
        // reconnect (which mints a new session id). On link: derive from the
        // session. On unlink: clear it, UNLESS the caller asks to retain it
        // (session removed out from under a still-watching tab → keep the key
        // so a reconnect can re-link automatically).
        let linkBindingKey = t.linkBindingKey;
        if (linkedSessionId) {
          const rec = sessionsRef.current.get(linkedSessionId);
          if (rec) linkBindingKey = sessionBindingKey(rec);
        } else if (!opts?.retainBindingKey) {
          linkBindingKey = undefined;
        }
        return { ...t, linkedSessionId, title: newTitle, linkBindingKey };
      });
      next.set(aiSessionId, { ...existing, tabs: updatedTabs });
      return next;
    });
  }, []);

  const updateAiChatStateRef = useRef(updateAiChatState);
  const updateActiveTabRef = useRef(updateActiveTab);
  const setTabLinkRef = useRef(setTabLink);
  useEffect(() => {
    updateAiChatStateRef.current = updateAiChatState;
    updateActiveTabRef.current = updateActiveTab;
    setTabLinkRef.current = setTabLink;
  });

  // -- Helper: resolve persona --
  const resolvePersona = useCallback((expertiseLabel?: string): PersonaDefinition | undefined => {
    const currentPersonas = aiPersonasRef.current;
    if (expertiseLabel) {
      return currentPersonas.find(p => p.label === expertiseLabel) ?? currentPersonas[0];
    }
    return currentPersonas[0];
  }, []);

  const resolvePersonaPrompt = useCallback((expertiseLabel?: string): string => {
    const currentPersonas = aiPersonasRef.current;
    let targetPrompt = 'You are a helpful assistant.';
    if (expertiseLabel) {
      const found = currentPersonas.find(p => p.label === expertiseLabel);
      if (found) targetPrompt = found.systemPrompt;
    } else if (currentPersonas.length > 0) {
      targetPrompt = currentPersonas[0].systemPrompt;
    }
    return targetPrompt + buildExecutionRules();
  }, []);

  // -- Helper: find target terminal for "ask AI" entry points --
  const resolveTargetTerminal = useCallback((targetSessionId?: string) => {
    const currentSessions = sessionsRef.current;
    const currentFeaturePanes = featurePanesRef.current;
    let activeTermId = targetSessionId || (paneAllocationsRef.current[activePaneIdRef.current || ''] as string);

    const featureInfo = activeTermId ? currentFeaturePanes.get(activeTermId) : undefined;
    const isAiPane = featureInfo?.type === 'ai-chat';

    if (isAiPane && !targetSessionId) {
      const chatState = aiChatStatesRef.current.get(activeTermId);
      const activeTab = getActiveTab(chatState);
      if (activeTab?.linkedSessionId) {
        activeTermId = activeTab.linkedSessionId;
      }
    }

    let activeSession = currentSessions.get(activeTermId);
    if (!activeSession) {
      if (lastTerminalSessionIdRef.current) {
        activeTermId = lastTerminalSessionIdRef.current;
        activeSession = currentSessions.get(activeTermId);
      }
    }
    return { activeTermId, activeSession };
  }, []);

  // -- sendMessage --
  const sendMessage = useCallback((aiSessionId: string, text: string) => {
    const chatState = aiChatStatesRef.current.get(aiSessionId);
    if (!chatState) return;
    const activeTab = getActiveTab(chatState);
    if (!activeTab) return;

    const terminalId = activeTab.linkedSessionId;
    let prependedContext = '';

    if (terminalId && !text.startsWith('Terminal Output (Command:')) {
      const termSession = sessionsRef.current.get(terminalId);
      if (termSession) {
        const buffer = getWatchBufferRef.current(terminalId);
        if (buffer) {
          prependedContext = `[Watched Terminal Output (Linked)]\n${buffer}\n================\n`;
          clearWatchBufferRef.current(terminalId);
        }
      }
    }

    const finalMessage = prependedContext + text;
    const selectedModel = chatState.selectedModel || 'Unspecified';
    const systemInstruction = chatState.systemInstruction || 'You are a helpful assistant.';

    const prepInfo = `useai-send-prep ${JSON.stringify({
      aiSessionId,
      tabId: activeTab.id,
      finalMessageLen: finalMessage.length,
      hasWatchPrefix: prependedContext.length > 0,
    })}`;
    console.debug(`[AIExec/info] ${prepInfo}`);
    tauriService.logDebug('info', 'AIExec', prepInfo)?.catch(() => {});

    tauriService.aiChatSend(aiSessionId, finalMessage, selectedModel, systemInstruction);
  }, []);

  // -- askAi --
  const askAi = useCallback((selection: string, type: string, targetSessionId?: string) => {
    const actualSelection = selection === '__WATCH_BUFFER__' ? '' : selection;

    const { activeTermId, activeSession } = resolveTargetTerminal(targetSessionId);

    let prependedContext = '';
    if (activeSession) {
      const buffer = getWatchBufferRef.current(activeTermId);
      if (buffer) {
        prependedContext = `[Watched Terminal Output]\n${buffer}\n================\n`;
        clearWatchBufferRef.current(activeTermId);
      }
    }

    const finalSelection = prependedContext
      ? (actualSelection ? `${prependedContext}[Target Text]\n${actualSelection}` : prependedContext)
      : actualSelection;

    if (!finalSelection) return;

    // Ensure AI Chat pane exists
    let aiPaneId: string;
    const existingAiPane = Array.from(featurePanesRef.current.entries())
      .find(([, info]) => info.type === 'ai-chat');

    if (existingAiPane) {
      aiPaneId = existingAiPane[0];
      setActivePaneIdRef.current(aiPaneId);
    } else {
      const newId = createAiChatPaneRef.current();
      if (newId) {
        aiPaneId = newId;
      } else {
        return;
      }
    }

    // Initialize state if missing, or set active tab's link to the target terminal
    let existingState = aiChatStatesRef.current.get(aiPaneId);
    if (!existingState) {
      existingState = createDefaultAiChatState(activeTermId, activeSession?.displayName);
      updateAiChatStateRef.current(aiPaneId, existingState);
    } else if (activeSession) {
      const activeTab = getActiveTab(existingState);
      if (activeTab && activeTab.linkedSessionId !== activeTermId) {
        setTabLinkRef.current(aiPaneId, activeTab.id, activeTermId);
      }
    }

    const lang = localStorage.getItem(STORAGE_KEYS.GEMINI_LANGUAGE) || 'English';
    const expertiseLabel = existingState?.selectedExpertise;
    const activePersona = resolvePersona(expertiseLabel);
    const defaultPersona = resolvePersonaPrompt(expertiseLabel);
    const currentCommands = activePersona?.askAiCommands ?? [];

    let systemInstruction = '';
    let userPrompt = '';

    if (type === 'analyze-watch') {
      systemInstruction = `${defaultPersona}${languageDirective(lang)}`;
      userPrompt = `Please analyze the following terminal output and point out any errors, warnings, or findings of interest:\n\n${finalSelection}`;
    } else if (type === 'free-format') {
      setAskAiFreeFormatData({ selection: finalSelection });
      return;
    } else {
      const existingCommand = currentCommands.find(c => c.id === type);
      if (existingCommand) {
        systemInstruction = `${defaultPersona}${languageDirective(lang)}`;
        if (existingCommand.id === 'root-cause') {
          systemInstruction = `You are an expert troubleshooter. ${defaultPersona}${languageDirective(lang)}`;
        }
        userPrompt = existingCommand.promptTemplate.replace('{selection}', finalSelection);
      } else {
        systemInstruction = `${defaultPersona}${languageDirective(lang)}`;
        userPrompt = `Please explain the following text:\n\n${finalSelection}`;
      }
    }

    updateAiChatStateRef.current(aiPaneId, { systemInstruction });
    updateActiveTabRef.current(aiPaneId, { pendingMessage: userPrompt });
  }, [resolveTargetTerminal, resolvePersonaPrompt, resolvePersona]);

  // -- showPromptMenu --
  const showPromptMenu = useCallback(async (aiSessionId: string) => {
    const chatState = aiChatStatesRef.current.get(aiSessionId);
    if (!chatState) return;

    const expertiseLabel = chatState.selectedExpertise;
    const activePersona = resolvePersona(expertiseLabel);
    const currentCommands = activePersona?.askAiCommands ?? [];

    const menuItems = [
      { id: 'analyze-watch', label: 'Analyze Watched Output', enabled: true },
      ...currentCommands.map(c => ({ id: c.id, label: c.label, enabled: true })),
    ];

    const selected = await tauriService.showContextMenu(menuItems);
    if (selected) {
      askAi('__WATCH_BUFFER__', selected);
    }
  }, [resolvePersona, askAi]);

  // -- handleFreeFormatSubmit --
  const handleFreeFormatSubmit = useCallback((prompt: string, selection: string) => {
    const existingAiPane = Array.from(featurePanesRef.current.entries())
      .find(([, info]) => info.type === 'ai-chat');
    if (!existingAiPane) return;

    const aiPaneId = existingAiPane[0];
    const chatState = aiChatStatesRef.current.get(aiPaneId);

    const lang = localStorage.getItem(STORAGE_KEYS.GEMINI_LANGUAGE) || 'English';
    const expertiseLabel = chatState?.selectedExpertise;
    const basePrompt = resolvePersonaPrompt(expertiseLabel);
    const systemInstruction = `${basePrompt}${languageDirective(lang)}`;
    const userPrompt = `${prompt}\n\n\`\`\`\n${selection}\n\`\`\``;

    updateAiChatStateRef.current(aiPaneId, { systemInstruction });
    updateActiveTabRef.current(aiPaneId, { pendingMessage: userPrompt });
    setActivePaneIdRef.current(aiPaneId);
    setAskAiFreeFormatData(null);
  }, [resolvePersonaPrompt]);

  // -- Custom event listener for ask-ai from terminal context menu etc. --
  useEffect(() => {
    const handleCustomAskAi = (e: Event) => {
      const customEvent = e as CustomEvent<{ selection: string; type: string; sessionId?: string }>;
      if (customEvent.detail) {
        askAi(customEvent.detail.selection, customEvent.detail.type, customEvent.detail.sessionId);
      }
    };

    window.addEventListener('ask-ai-internal', handleCustomAskAi);

    return () => {
      window.removeEventListener('ask-ai-internal', handleCustomAskAi);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dep array - uses refs internally

  return {
    aiChatStates,
    updateAiChatState,
    updateActiveTab,
    updateTabById,
    addTab,
    closeTab,
    setActiveTab,
    setTabLink,
    sendMessage,
    askAi,
    showPromptMenu,
    askAiFreeFormatData,
    setAskAiFreeFormatData,
    handleFreeFormatSubmit,
  };
}
