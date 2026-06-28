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
  /**
   * Active client-side sleep delay for an AI-issued command (see App.tsx
   * scheduleSleepDelay). Drives the "⏳ Waiting Ns…" indicator on the matching
   * execute block. `token` is a monotonic id used to abort a stale delay if the
   * tab starts a new chat or issues a newer command. Cleared (null) when the
   * delay fires or is cancelled.
   */
  sleepDelay?: {
    command: string;
    untilTs: number;
    wasClamped: boolean;
    token: number;
  } | null;
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
  /** Read-and-clear a session's watch buffer (backend-backed, async). */
  takeWatchBuffer: (sessionId: string) => Promise<string>;
  /**
   * Ensure the user has accepted the one-time AI data-sharing disclosure before
   * any terminal data is sent to a third-party provider. Resolves `true` to
   * proceed, `false` if the user declined (abort the send). Resolves immediately
   * when consent was already granted.
   */
  ensureAiConsent: () => Promise<boolean>;
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
  sendMessage: (aiSessionId: string, text: string) => Promise<void>;
  askAi: (selection: string, question: string, targetSessionId?: string) => Promise<void>;
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
    takeWatchBuffer,
    ensureAiConsent,
    createAiChatPane,
    lastTerminalSessionId,
    paneAllocations,
    activePaneId,
    setActivePaneId,
  } = options;

  const [aiChatStates, setAiChatStates] = useState<Map<string, AiChatState>>(() => new Map());

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

  const takeWatchBufferRef = useRef(takeWatchBuffer);
  const ensureAiConsentRef = useRef(ensureAiConsent);
  const createAiChatPaneRef = useRef(createAiChatPane);
  const setActivePaneIdRef = useRef(setActivePaneId);

  useEffect(() => {
    takeWatchBufferRef.current = takeWatchBuffer;
    ensureAiConsentRef.current = ensureAiConsent;
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
  const sendMessage = useCallback(async (aiSessionId: string, text: string) => {
    const chatState = aiChatStatesRef.current.get(aiSessionId);
    if (!chatState) return;
    const activeTab = getActiveTab(chatState);
    if (!activeTab) return;

    // Gate the first send to a third-party AI provider on the data-sharing consent.
    if (!(await ensureAiConsentRef.current())) return;

    const terminalId = activeTab.linkedSessionId;
    let prependedContext = '';

    if (terminalId && !text.startsWith('Terminal Output (Command:')) {
      const buffer = await takeWatchBufferRef.current(terminalId);
      if (buffer) {
        prependedContext = `[Watched Terminal Output (Linked)]\n${buffer}\n================\n`;
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
  // Inline terminal Ask AI: sends the user's typed question plus the selected
  // text (and any watched-terminal buffer) to the AI chat pane.
  const askAi = useCallback(async (selection: string, question: string, targetSessionId?: string) => {
    if (!question.trim()) return;

    // Gate before reading/consuming any terminal data for the AI provider.
    if (!(await ensureAiConsentRef.current())) return;

    const { activeTermId, activeSession } = resolveTargetTerminal(targetSessionId);

    let prependedContext = '';
    if (activeSession) {
      const buffer = await takeWatchBufferRef.current(activeTermId);
      if (buffer) {
        prependedContext = `[Watched Terminal Output]\n${buffer}\n================\n`;
      }
    }

    const finalSelection = prependedContext
      ? (selection ? `${prependedContext}[Target Text]\n${selection}` : prependedContext)
      : selection;

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
    const systemInstruction = `${resolvePersonaPrompt(expertiseLabel)}${languageDirective(lang)}`;
    const userPrompt = `${question}\n\n\`\`\`\n${finalSelection}\n\`\`\``;

    updateAiChatStateRef.current(aiPaneId, { systemInstruction });
    updateActiveTabRef.current(aiPaneId, { pendingMessage: userPrompt });
  }, [resolveTargetTerminal, resolvePersonaPrompt]);

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
  };
}
