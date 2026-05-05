import { useState, useEffect, useCallback, useRef } from 'react';
import type { PersonaDefinition } from '../types/appTypes';
import type { SessionRecord } from './useSessionManager';
import type { FeaturePaneInfo } from '../utils/paneTypes';
import { STORAGE_KEYS } from '../constants/storage';
import { buildExecutionRules } from '../constants/aiPrompts';
import { tauriService } from '../services/tauriService';

// -- Types --

export interface AiChatState {
  selectedModel: string;
  selectedExpertise?: string;
  systemInstruction: string;
  pendingMessage?: string;
  lastTargetSessionId?: string;
  lastTargetSessionTitle?: string;
}

interface UseAiChatOptions {
  sessions: Map<string, SessionRecord>;
  featurePanes: Map<string, FeaturePaneInfo>;
  aiPersonas: PersonaDefinition[];
  getWatchBuffer: (sessionId: string) => string;
  clearWatchBuffer: (sessionId: string) => void;
  toggleWatch: (sessionId: string) => void;
  createAiChatPane: () => string | undefined;
  lastTerminalSessionId: string | null;
  paneAllocations: Record<string, string | null>;
  activePaneId: string | null;
  setActivePaneId: (id: string) => void;
}

interface UseAiChatReturn {
  aiChatStates: Map<string, AiChatState>;
  updateAiChatState: (aiSessionId: string, newState: Partial<AiChatState>) => void;
  sendMessage: (aiSessionId: string, text: string) => void;
  askAi: (selection: string, type: string, targetSessionId?: string) => void;
  showPromptMenu: (aiSessionId: string) => void;
  askAiFreeFormatData: { selection: string } | null;
  setAskAiFreeFormatData: (data: { selection: string } | null) => void;
  handleFreeFormatSubmit: (prompt: string, selection: string) => void;
}

// -- Hook --

export function useAiChat(options: UseAiChatOptions): UseAiChatReturn {
  const {
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

  // Stable refs for callbacks that don't change identity
  const getWatchBufferRef = useRef(getWatchBuffer);
  const clearWatchBufferRef = useRef(clearWatchBuffer);
  const toggleWatchRef = useRef(toggleWatch);
  const createAiChatPaneRef = useRef(createAiChatPane);
  const setActivePaneIdRef = useRef(setActivePaneId);

  useEffect(() => {
    getWatchBufferRef.current = getWatchBuffer;
    clearWatchBufferRef.current = clearWatchBuffer;
    toggleWatchRef.current = toggleWatch;
    createAiChatPaneRef.current = createAiChatPane;
    setActivePaneIdRef.current = setActivePaneId;
  });

  // -- State updater --
  const updateAiChatState = useCallback((aiSessionId: string, newState: Partial<AiChatState>) => {
    setAiChatStates((prev) => {
      const next = new Map(prev);
      const existing = prev.get(aiSessionId) ?? {
        selectedModel: '',
        systemInstruction: 'You are a helpful assistant.',
      };
      next.set(aiSessionId, { ...existing, ...newState });
      return next;
    });
  }, []);

  const updateAiChatStateRef = useRef(updateAiChatState);
  useEffect(() => {
    updateAiChatStateRef.current = updateAiChatState;
  });

  // -- Helper: resolve persona by label --
  const resolvePersona = useCallback((expertiseLabel?: string): PersonaDefinition | undefined => {
    const currentPersonas = aiPersonasRef.current;
    if (expertiseLabel) {
      return currentPersonas.find(p => p.label === expertiseLabel) ?? currentPersonas[0];
    }
    return currentPersonas[0];
  }, []);

  // -- Helper: resolve persona prompt --
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

  // -- Helper: find active terminal --
  const resolveTargetTerminal = useCallback((targetSessionId?: string) => {
    const currentSessions = sessionsRef.current;
    const currentFeaturePanes = featurePanesRef.current;
    let activeTermId = targetSessionId || (paneAllocationsRef.current[activePaneIdRef.current || ''] as string);

    // Check if the active allocation is an AI chat pane
    const featureInfo = activeTermId ? currentFeaturePanes.get(activeTermId) : undefined;
    const isAiPane = featureInfo?.type === 'ai-chat';

    // If active pane is an AI chat, use its linked terminal
    if (isAiPane && !targetSessionId) {
      const chatState = aiChatStatesRef.current.get(activeTermId);
      if (chatState?.lastTargetSessionId) {
        activeTermId = chatState.lastTargetSessionId;
      }
    }

    let activeSession = currentSessions.get(activeTermId);

    // If still invalid, fallback to last known terminal
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

    const terminalId = chatState.lastTargetSessionId;
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

    // Resolve target terminal
    const { activeTermId, activeSession } = resolveTargetTerminal(targetSessionId);

    // Extract watch buffer
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

    // Record target session info
    const existingState = aiChatStatesRef.current.get(aiPaneId);
    updateAiChatStateRef.current(aiPaneId, {
      lastTargetSessionId: activeTermId,
      lastTargetSessionTitle: activeSession?.displayName || 'Unknown Terminal',
    });

    // Auto-start watching
    if (activeSession) {
      toggleWatchRef.current(activeTermId);
    }

    const lang = localStorage.getItem(STORAGE_KEYS.GEMINI_LANGUAGE) || 'English';
    const expertiseLabel = existingState?.selectedExpertise;
    const activePersona = resolvePersona(expertiseLabel);
    const defaultPersona = resolvePersonaPrompt(expertiseLabel);
    const currentCommands = activePersona?.askAiCommands ?? [];

    let systemInstruction = '';
    let userPrompt = '';

    if (type === 'analyze-watch') {
      systemInstruction = lang !== 'English' ? `${defaultPersona} You MUST answer in ${lang}.` : defaultPersona;
      userPrompt = `Please analyze the following terminal output and point out any errors, warnings, or findings of interest:\n\n${finalSelection}`;
    } else if (type === 'free-format') {
      setAskAiFreeFormatData({ selection: finalSelection });
      return;
    } else {
      const existingCommand = currentCommands.find(c => c.id === type);
      if (existingCommand) {
        systemInstruction = lang !== 'English' ? `${defaultPersona} You MUST answer in ${lang}.` : defaultPersona;
        if (existingCommand.id === 'root-cause') {
          systemInstruction = `You are an expert troubleshooter. ${defaultPersona} Answer in ${lang}.`;
        }
        userPrompt = existingCommand.promptTemplate.replace('{selection}', finalSelection);
      } else {
        systemInstruction = `${defaultPersona} Answer in ${lang}.`;
        userPrompt = `Please explain the following text:\n\n${finalSelection}`;
      }
    }

    updateAiChatStateRef.current(aiPaneId, {
      pendingMessage: userPrompt,
      systemInstruction,
    });
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
    const systemInstruction = lang !== 'English' ? `${basePrompt} You MUST answer in ${lang}.` : basePrompt;
    const userPrompt = `${prompt}\n\n\`\`\`\n${selection}\n\`\`\``;

    updateAiChatStateRef.current(aiPaneId, {
      pendingMessage: userPrompt,
      systemInstruction,
      lastTargetSessionId: chatState?.lastTargetSessionId,
      lastTargetSessionTitle: chatState?.lastTargetSessionTitle,
    });
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
    sendMessage,
    askAi,
    showPromptMenu,
    askAiFreeFormatData,
    setAskAiFreeFormatData,
    handleFreeFormatSubmit,
  };
}
