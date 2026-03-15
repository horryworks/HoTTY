import { useState, useEffect, useCallback, useRef } from 'react';
import type { Session } from './useSessionManager';
import type { AskGeminiCommand, PersonaDefinition } from '../App';
import { STORAGE_KEYS } from '../constants/storage';
import * as electronService from '../services/electronService';

// -- Types --

interface UseGeminiChatOptions {
  sessions: Session[];
  askGeminiCommands: AskGeminiCommand[];
  aiPersonas: PersonaDefinition[];
  proactiveInstruction: string;
  getWatchBuffer: (sessionId: string) => string;
  clearWatchBuffer: (sessionId: string) => void;
  updateSessionState: (sessionId: string, newState: Partial<Session['aiChatState']>) => void;
  toggleWatch: (sessionId: string) => void;
  createAISession: () => string | undefined;
  lastTerminalSessionId: string | null;
  paneAllocations: Record<string, string | null>;
  activePaneId: string | null;
  setActivePaneId: (id: string) => void;
}

interface UseGeminiChatReturn {
  sendMessage: (aiSessionId: string, text: string) => void;
  askGemini: (selection: string, type: string, targetSessionId?: string) => void;
  showPromptMenu: (aiSessionId: string) => void;
  askGeminiFreeFormatData: { selection: string } | null;
  setAskGeminiFreeFormatData: (data: { selection: string } | null) => void;
  handleFreeFormatSubmit: (prompt: string, selection: string) => void;
}

// -- Hook --

export function useGeminiChat(options: UseGeminiChatOptions): UseGeminiChatReturn {
  const {
    sessions,
    askGeminiCommands,
    aiPersonas,
    getWatchBuffer,
    clearWatchBuffer,
    updateSessionState,
    toggleWatch,
    createAISession,
    lastTerminalSessionId,
    paneAllocations,
    activePaneId,
    setActivePaneId,
  } = options;

  const [askGeminiFreeFormatData, setAskGeminiFreeFormatData] = useState<{ selection: string } | null>(null);

  // Refs for stable access in callbacks
  const sessionsRef = useRef(sessions);
  const askGeminiCommandsRef = useRef(askGeminiCommands);
  const aiPersonasRef = useRef(aiPersonas);
  const lastTerminalSessionIdRef = useRef(lastTerminalSessionId);
  const paneAllocationsRef = useRef(paneAllocations);
  const activePaneIdRef = useRef(activePaneId);

  useEffect(() => {
    sessionsRef.current = sessions;
    askGeminiCommandsRef.current = askGeminiCommands;
    aiPersonasRef.current = aiPersonas;
    lastTerminalSessionIdRef.current = lastTerminalSessionId;
    paneAllocationsRef.current = paneAllocations;
    activePaneIdRef.current = activePaneId;
  });

  // Stable refs for callbacks that don't change identity
  const getWatchBufferRef = useRef(getWatchBuffer);
  const clearWatchBufferRef = useRef(clearWatchBuffer);
  const updateSessionStateRef = useRef(updateSessionState);
  const toggleWatchRef = useRef(toggleWatch);
  const createAISessionRef = useRef(createAISession);
  const setActivePaneIdRef = useRef(setActivePaneId);

  useEffect(() => {
    getWatchBufferRef.current = getWatchBuffer;
    clearWatchBufferRef.current = clearWatchBuffer;
    updateSessionStateRef.current = updateSessionState;
    toggleWatchRef.current = toggleWatch;
    createAISessionRef.current = createAISession;
    setActivePaneIdRef.current = setActivePaneId;
  });

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

    return targetPrompt + " [ABSOLUTE MANDATORY RULES - NO EXCEPTIONS]\n1. Answer ONLY what the user asked. Do NOT suggest next steps, additional commands, or follow-up actions unless explicitly requested.\n2. After answering, always end your response with a brief closing statement such as 'That concludes my response.' or 'That is all.' to clearly signal that you are done. Do not end silently.\n3. ANY shell/terminal command MUST be placed in EXACTLY ONE ```execute block per response.\n4. It is STRICTLY FORBIDDEN to use more than one ```execute block in a single response.\n5. It is STRICTLY FORBIDDEN to write commands as inline code (`command`), plain text, or in ```bash/```sh/```shell blocks.\n6. If multiple steps are needed, combine them into a single ```execute block using && or semicolons.\n7. Breaking these rules causes a critical application failure.";
  }, []);

  // -- Helper: find active terminal --
  const resolveTargetTerminal = useCallback((targetSessionId?: string) => {
    const currentSessions = sessionsRef.current;
    let activeTermId = targetSessionId || (paneAllocationsRef.current[activePaneIdRef.current || ''] as string);
    let activeSession = currentSessions.find(s => s.id === activeTermId);

    // If active session is an AI chat, prioritize its linked terminal
    if (activeSession?.type === 'ai' && !targetSessionId) {
      if (activeSession.aiChatState?.lastTargetSessionId) {
        activeTermId = activeSession.aiChatState.lastTargetSessionId;
        activeSession = currentSessions.find(s => s.id === activeTermId);
      }
    }

    // If still AI or invalid, fallback to last known terminal
    if (!activeSession || activeSession.type === 'ai') {
      if (lastTerminalSessionIdRef.current) {
        activeTermId = lastTerminalSessionIdRef.current;
        activeSession = currentSessions.find(s => s.id === activeTermId);
      }
    }

    return { activeTermId, activeSession };
  }, []);

  // -- sendMessage --
  const sendMessage = useCallback((aiSessionId: string, text: string) => {
    const currentSessions = sessionsRef.current;
    const aiSession = currentSessions.find(s => s.id === aiSessionId);
    if (!aiSession || aiSession.type !== 'ai') return;

    const terminalId = aiSession.aiChatState?.lastTargetSessionId;
    let prependedContext = '';

    if (terminalId && !text.startsWith('Terminal Output (Command:')) {
      const termSession = currentSessions.find(s => s.id === terminalId);
      if (termSession?.isWatching) {
        const buffer = getWatchBufferRef.current(terminalId);
        if (buffer) {
          prependedContext = `[Watched Terminal Output (Linked)]\n${buffer}\n================\n`;
          clearWatchBufferRef.current(terminalId);
        }
      }
    }

    const finalMessage = prependedContext + text;
    const selectedModel = aiSession.aiChatState?.selectedModel || 'Unspecified';
    const systemInstruction = aiSession.aiChatState?.systemInstruction || 'You are a helpful assistant.';

    electronService.geminiChatSend(aiSessionId, finalMessage, selectedModel, systemInstruction);
  }, []);

  // -- askGemini --
  const askGemini = useCallback((selection: string, type: string, targetSessionId?: string) => {
    const actualSelection = selection === '__WATCH_BUFFER__' ? '' : selection;
    electronService.logDebug(`[useGeminiChat] onAskGemini triggered. Type: ${type}, Selection length: ${actualSelection?.length}`);

    const currentSessions = sessionsRef.current;
    const currentCommands = askGeminiCommandsRef.current;

    // Resolve target terminal
    const { activeTermId, activeSession } = resolveTargetTerminal(targetSessionId);

    // Extract watch buffer
    let prependedContext = '';
    if (activeSession?.isWatching) {
      const buffer = getWatchBufferRef.current(activeTermId);
      if (buffer) {
        prependedContext = `[Watched Terminal Output]\n${buffer}\n================\n`;
        clearWatchBufferRef.current(activeTermId);
      }
    }

    const finalSelection = prependedContext
      ? (actualSelection ? `${prependedContext}[Target Text]\n${actualSelection}` : prependedContext)
      : actualSelection;

    if (!finalSelection) {
      electronService.logDebug('[useGeminiChat] Selection and buffer are empty, ignoring.');
      return;
    }

    // Ensure AI Session
    let aiSessionId: string;
    const existingAiSession = currentSessions.find(s => s.type === 'ai');

    if (existingAiSession) {
      aiSessionId = existingAiSession.id;
      electronService.logDebug(`[useGeminiChat] Found existing AI session: ${aiSessionId}`);
      setActivePaneIdRef.current(aiSessionId);
    } else {
      const newId = createAISessionRef.current();
      if (newId) {
        aiSessionId = newId;
        electronService.logDebug(`[useGeminiChat] Created new AI session: ${aiSessionId}`);
      } else {
        electronService.logDebug('[useGeminiChat] Failed to create AI session (already exists?)');
        return;
      }
    }

    // Record target session info
    updateSessionStateRef.current(aiSessionId, {
      lastTargetSessionId: activeTermId,
      lastTargetSessionTitle: activeSession?.title || 'Unknown Terminal'
    });

    // Auto-start watching
    if (activeSession && !activeSession.isWatching) {
      toggleWatchRef.current(activeTermId);
    }

    const lang = localStorage.getItem(STORAGE_KEYS.GEMINI_LANGUAGE) || 'English';
    const expertiseLabel = existingAiSession?.aiChatState?.selectedExpertise;
    const defaultPersona = resolvePersonaPrompt(expertiseLabel);

    let systemInstruction = '';
    let userPrompt = '';

    if (type === 'analyze-watch') {
      systemInstruction = `${defaultPersona} Answer in ${lang}.`;
      userPrompt = `Please analyze the following terminal output and point out any errors, warnings, or findings of interest:\n\n${finalSelection}`;
    } else if (type === 'free-format') {
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
        systemInstruction = `${defaultPersona} Answer in ${lang}.`;
        userPrompt = `Please explain the following text:\n\n${finalSelection}`;
      }
    }

    electronService.logDebug(`[useGeminiChat] Updating session state with prompt. Prompt: ${userPrompt.substring(0, 50)}...`);
    updateSessionStateRef.current(aiSessionId, {
      pendingMessage: userPrompt,
      systemInstruction: systemInstruction
    });
  }, [resolveTargetTerminal, resolvePersonaPrompt]);

  // -- showPromptMenu --
  const showPromptMenu = useCallback((aiSessionId: string) => {
    electronService.logDebug(`[useGeminiChat] showPromptMenu for session: ${aiSessionId}`);
    const currentSessions = sessionsRef.current;
    const currentCommands = askGeminiCommandsRef.current;
    const aiSession = currentSessions.find(s => s.id === aiSessionId);
    if (!aiSession || aiSession.type !== 'ai') return;

    const menuCommands = [
      { id: 'analyze-watch', label: 'Analyze Watched Output' },
      ...currentCommands.map(c => ({ id: c.id, label: c.label }))
    ];
    electronService.showContextMenu('__WATCH_BUFFER__', menuCommands);
  }, []);

  // -- handleFreeFormatSubmit --
  const handleFreeFormatSubmit = useCallback((prompt: string, selection: string) => {
    const currentSessions = sessionsRef.current;
    const aiSession = currentSessions.find(s => s.type === 'ai');
    if (!aiSession) return;

    const lang = localStorage.getItem(STORAGE_KEYS.GEMINI_LANGUAGE) || 'English';
    const expertiseLabel = aiSession.aiChatState?.selectedExpertise;
    const basePrompt = resolvePersonaPrompt(expertiseLabel);
    const systemInstruction = `${basePrompt} Answer in ${lang}.`;
    const userPrompt = `${prompt}\n\n\`\`\`\n${selection}\n\`\`\``;

    updateSessionStateRef.current(aiSession.id, {
      pendingMessage: userPrompt,
      systemInstruction: systemInstruction,
      lastTargetSessionId: aiSession.aiChatState?.lastTargetSessionId,
      lastTargetSessionTitle: aiSession.aiChatState?.lastTargetSessionTitle
    });
    setActivePaneIdRef.current(aiSession.id);
    setAskGeminiFreeFormatData(null);
  }, [resolvePersonaPrompt]);

  // -- Register IPC listeners (once) --
  useEffect(() => {
    const removeListener = electronService.onAskGemini((selection: string, type: string) => {
      electronService.logDebug(`[useGeminiChat] onAskGemini IPC. Type: ${type}`);
      askGemini(selection, type);
    });

    const handleCustomAskGemini = (e: Event) => {
      const customEvent = e as CustomEvent<{ selection: string; type: string; sessionId?: string }>;
      electronService.logDebug(`[useGeminiChat] handleCustomAskGemini triggered with type: ${customEvent.detail?.type}`);
      if (customEvent.detail) {
        askGemini(customEvent.detail.selection, customEvent.detail.type, customEvent.detail.sessionId);
      }
    };

    window.addEventListener('ask-gemini-internal', handleCustomAskGemini);

    return () => {
      removeListener();
      window.removeEventListener('ask-gemini-internal', handleCustomAskGemini);
    };
  }, []); // Empty dep array - uses refs internally

  return {
    sendMessage,
    askGemini,
    showPromptMenu,
    askGeminiFreeFormatData,
    setAskGeminiFreeFormatData,
    handleFreeFormatSubmit,
  };
}
