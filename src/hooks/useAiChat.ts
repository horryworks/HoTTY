import { useState, useEffect, useCallback, useRef } from 'react';
import type { PersonaDefinition, ChatImage } from '../types/appTypes';
import type { SessionRecord } from './useSessionManager';
import type { FeaturePaneInfo } from '../utils/paneTypes';
import { STORAGE_KEYS } from '../constants/storage';
import { buildExecutionRules, languageDirective, watchedOutputSection, buildWatchTargetsBlock } from '../constants/aiPrompts';
import { tauriService } from '../services/tauriService';
import { sessionBindingKey } from '../utils/sessionBindingKey';
import { redactSecrets } from '../utils/redaction';
import { buildAliasEntries } from '../utils/terminalAlias';

// -- Types --

/**
 * A human-typed message queued while a response was streaming. Carries the text
 * plus any attached images so a paste-and-send mid-stream isn't downgraded to
 * text-only when the queue drains.
 */
export interface PendingUserMessage {
  text: string;
  images?: ChatImage[];
}

/**
 * One terminal watched by a chat tab. `sessionId` is the ephemeral live-session
 * id (minted anew on every (re)connect); `bindingKey` is the config-derived
 * identity (see `sessionBindingKey`), stable across disconnect+reconnect, kept so
 * an orphaned entry can auto-rebind to a reconnected session with the same target.
 */
export interface WatchedTerminal {
  sessionId: string;
  bindingKey?: string;
}

/**
 * One conversation tab inside the (singleton) AI Chat pane.
 * Phase 2: a tab watches a SET of terminals (`linkedSessions`). Output from all of
 * them is aggregated into the conversation; each AI-issued command still runs on a
 * single terminal (declared by the AI via `target=`, else the last-focused one).
 */
export interface ChatTab {
  id: string;
  /** Auto-derived from linkedSessions; updated on link change. */
  title: string;
  /** Stable counter used for "Tab N" titles when no link is set. */
  ordinal: number;
  /**
   * Terminals this tab watches, in insertion order. Empty = unlinked. Entries for
   * disconnected terminals are KEPT (greyed in the UI, excluded from new
   * drains/executes) so the per-entry `bindingKey` can auto-rebind on reconnect;
   * they are dropped only by explicit user removal (chip ×, Watch toggle-off).
   */
  linkedSessions: WatchedTerminal[];
  /**
   * The watched terminal a command falls back to when the AI does not tag its
   * execute block with `target=` and more than one terminal is watched (the
   * most-recently added/focused one). Reset when it leaves the set.
   */
  lastFocusedWatchId?: string;
  /**
   * FIFO queue of machine-generated messages waiting to be dispatched to the AI
   * (Network-Expert kickoff, terminal-output envelopes, decline / not-connected
   * notes, sleep-delay results). A QUEUE rather than a single slot so two
   * producers writing while a stream blocks the send loop can't overwrite each
   * other — every fact reaches the model. Enqueue via `enqueuePendingMessage`;
   * the send loop dispatches index 0 then `dequeuePendingMessage`s it.
   */
  pendingMessages?: string[];
  /**
   * FIFO queue of HUMAN-typed messages the user sent while a response was still
   * streaming (input is no longer locked mid-response). Kept separate from — and
   * dispatched with priority OVER — `pendingMessages` so a message the user types
   * reaches the model as its NEXT thinking turn, ahead of machine-generated
   * envelopes (e.g. auto-exec terminal output). FIFO preserves the user's typing
   * order across multiple queued sends. Enqueue via `enqueuePendingUserMessage`.
   * Each entry carries optional image attachments (see `PendingUserMessage`).
   */
  pendingUserMessages?: PendingUserMessage[];
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
  /** Append a machine-generated message to a tab's pending-send queue. */
  enqueuePendingMessage: (aiSessionId: string, tabId: string, message: string) => void;
  /** Drop the first message from a tab's pending-send queue (after dispatch). */
  dequeuePendingMessage: (aiSessionId: string, tabId: string) => void;
  /** Append a human-typed message (with optional images) to a tab's priority (user) send queue. */
  enqueuePendingUserMessage: (aiSessionId: string, tabId: string, message: string, images?: ChatImage[]) => void;
  /** Drop the first message from a tab's priority (user) send queue (after dispatch). */
  dequeuePendingUserMessage: (aiSessionId: string, tabId: string) => void;
  addTab: (aiSessionId: string, initialLinkSessionId?: string) => string;
  closeTab: (aiSessionId: string, tabId: string) => void;
  /** Remove an entire pane's chat state + free its per-tab backend histories. */
  removeAiChatState: (aiSessionId: string) => void;
  setActiveTab: (aiSessionId: string, tabId: string) => void;
  /** Add a terminal to a tab's watched set (and mark it the default execute target). */
  addTabLink: (aiSessionId: string, tabId: string, sessionId: string) => void;
  /** Remove a terminal from a tab's watched set (explicit user unlink). */
  removeTabLink: (aiSessionId: string, tabId: string, sessionId: string) => void;
  /** Swap a dead entry's session id in place on reconnect (auto-rebind). */
  rebindTabLink: (aiSessionId: string, tabId: string, bindingKey: string, newSessionId: string) => void;
  sendMessage: (aiSessionId: string, text: string, images?: ChatImage[]) => Promise<void>;
  askAi: (selection: string, question: string, targetSessionId?: string) => Promise<void>;
}

// -- Pure helpers --

export function getActiveTab(state: AiChatState | undefined): ChatTab | undefined {
  if (!state) return undefined;
  return state.tabs.find(t => t.id === state.activeTabId);
}

// -- Watched-terminal selectors (pure; exported for reuse & tests) --

/** The session ids a tab watches, in insertion order. */
export function tabSessionIds(tab: ChatTab | undefined): string[] {
  return (tab?.linkedSessions ?? []).map(w => w.sessionId);
}

/** Whether a tab currently watches `sessionId`. */
export function tabHasSession(tab: ChatTab | undefined, sessionId: string): boolean {
  return (tab?.linkedSessions ?? []).some(w => w.sessionId === sessionId);
}

/** The tab's primary (first) watched session id, or undefined when unlinked.
 *  Used wherever a single representative link is still needed (title flash,
 *  Network-Expert device identity, the active-tab "watching" indicator). */
export function firstLinkedSessionId(tab: ChatTab | undefined): string | undefined {
  return (tab?.linkedSessions ?? [])[0]?.sessionId;
}

/**
 * Backend conversation-history key for one chat tab. The Rust AI service keys
 * its `chat_histories` by whatever string we pass as `session_id`; scoping that
 * key to the TAB (not just the pane) is what isolates each tab's conversation,
 * so a newly opened tab starts with a clean context instead of inheriting the
 * pane's earlier exchanges. `::` never appears in a pane id (makeFeaturePaneId)
 * or tab id (makeTabId / crypto.randomUUID), so the pane prefix stays
 * unambiguous — the response listener routes by `startsWith(paneId + '::')`.
 * Falls back to the bare paneId when no tab id is known.
 */
export function aiBackendSessionId(paneId: string, tabId?: string | null): string {
  return tabId ? `${paneId}::${tabId}` : paneId;
}

/**
 * Build a short title from a tab's watched terminals. Returns '' when the set is
 * empty / unnamed so the renderer (TabStrip) can substitute a localized "Tab N"
 * fallback — keeping the ordinal fallback out of this non-i18n module. With one
 * terminal it's the (truncated) name; with several it's "<primary> +N".
 */
function deriveTabTitle(
  linkedSessions: WatchedTerminal[],
  sessions: Map<string, SessionRecord>,
): string {
  const primaryId = linkedSessions[0]?.sessionId;
  if (!primaryId) return '';
  const name = sessions.get(primaryId)?.displayName;
  if (!name) return '';
  const extra = linkedSessions.length - 1;
  const suffix = extra > 0 ? ` +${extra}` : '';
  // Keep the total compact: budget the name so name+suffix stays ~12 chars.
  const budget = 12 - suffix.length;
  const shown = name.length > budget ? `${name.slice(0, Math.max(1, budget - 1))}…` : name;
  return `${shown}${suffix}`;
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
      // Empty title => TabStrip renders the localized "Tab N" fallback.
      title: initialTitle ?? '',
      linkedSessions: initialLinkSessionId
        ? [{ sessionId: initialLinkSessionId, bindingKey: initialBindingKey }]
        : [],
      lastFocusedWatchId: initialLinkSessionId,
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

  const enqueuePendingMessage = useCallback((aiSessionId: string, tabId: string, message: string) => {
    setAiChatStates((prev) => {
      const next = new Map(prev);
      const existing = prev.get(aiSessionId);
      if (!existing) return prev;
      if (!existing.tabs.find(t => t.id === tabId)) return prev;
      const updatedTabs = existing.tabs.map(t =>
        t.id === tabId ? { ...t, pendingMessages: [...(t.pendingMessages ?? []), message] } : t
      );
      next.set(aiSessionId, { ...existing, tabs: updatedTabs });
      return next;
    });
  }, []);

  const dequeuePendingMessage = useCallback((aiSessionId: string, tabId: string) => {
    setAiChatStates((prev) => {
      const next = new Map(prev);
      const existing = prev.get(aiSessionId);
      if (!existing) return prev;
      const tab = existing.tabs.find(t => t.id === tabId);
      if (!tab || !tab.pendingMessages || tab.pendingMessages.length === 0) return prev;
      const updatedTabs = existing.tabs.map(t =>
        t.id === tabId ? { ...t, pendingMessages: t.pendingMessages!.slice(1) } : t
      );
      next.set(aiSessionId, { ...existing, tabs: updatedTabs });
      return next;
    });
  }, []);

  const enqueuePendingUserMessage = useCallback((aiSessionId: string, tabId: string, message: string, images?: ChatImage[]) => {
    setAiChatStates((prev) => {
      const next = new Map(prev);
      const existing = prev.get(aiSessionId);
      if (!existing) return prev;
      if (!existing.tabs.find(t => t.id === tabId)) return prev;
      const entry: PendingUserMessage = images && images.length > 0 ? { text: message, images } : { text: message };
      const updatedTabs = existing.tabs.map(t =>
        t.id === tabId ? { ...t, pendingUserMessages: [...(t.pendingUserMessages ?? []), entry] } : t
      );
      next.set(aiSessionId, { ...existing, tabs: updatedTabs });
      return next;
    });
  }, []);

  const dequeuePendingUserMessage = useCallback((aiSessionId: string, tabId: string) => {
    setAiChatStates((prev) => {
      const next = new Map(prev);
      const existing = prev.get(aiSessionId);
      if (!existing) return prev;
      const tab = existing.tabs.find(t => t.id === tabId);
      if (!tab || !tab.pendingUserMessages || tab.pendingUserMessages.length === 0) return prev;
      const updatedTabs = existing.tabs.map(t =>
        t.id === tabId ? { ...t, pendingUserMessages: t.pendingUserMessages!.slice(1) } : t
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
      const linkedRec = initialLinkSessionId ? sessionsRef.current.get(initialLinkSessionId) : undefined;
      const linkedSessions: WatchedTerminal[] = initialLinkSessionId
        ? [{ sessionId: initialLinkSessionId, bindingKey: linkedRec ? sessionBindingKey(linkedRec) : undefined }]
        : [];
      const title = deriveTabTitle(linkedSessions, sessionsRef.current);
      const newTab: ChatTab = {
        id: newTabId,
        ordinal: newOrdinal,
        title,
        linkedSessions,
        lastFocusedWatchId: initialLinkSessionId,
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
    // Free the closed tab's per-tab backend conversation history (see
    // aiBackendSessionId) so it isn't orphaned until logout. Guard mirrors the
    // state updater below: only a tab that actually closes drops its history.
    const cur = aiChatStatesRef.current.get(aiSessionId);
    if (cur && cur.tabs.length > 1 && cur.tabs.some(t => t.id === tabId)) {
      tauriService.aiChatClear(aiBackendSessionId(aiSessionId, tabId)).catch(() => {});
    }
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

  /** Remove an entire AI-chat pane's state (on pane close): free every tab's
   *  per-tab backend conversation history and drop the in-memory entry so a
   *  future watch-diff can't resurrect capture for a pane that no longer exists. */
  const removeAiChatState = useCallback((aiSessionId: string) => {
    const existing = aiChatStatesRef.current.get(aiSessionId);
    if (existing) {
      for (const t of existing.tabs) {
        tauriService.aiChatClear(aiBackendSessionId(aiSessionId, t.id)).catch(() => {});
      }
    }
    setAiChatStates((prev) => {
      if (!prev.has(aiSessionId)) return prev;
      const next = new Map(prev);
      next.delete(aiSessionId);
      return next;
    });
  }, []);

  // -- Watched-set mutators (replace the single-link setTabLink) --

  /** Reduce a tab's watched set with `mutate`, recomputing its derived title. */
  const mutateTabLinks = useCallback((
    aiSessionId: string,
    tabId: string,
    mutate: (tab: ChatTab) => ChatTab,
  ) => {
    setAiChatStates((prev) => {
      const existing = prev.get(aiSessionId);
      if (!existing) return prev;
      let changed = false;
      const updatedTabs = existing.tabs.map(t => {
        if (t.id !== tabId) return t;
        const mutated = mutate(t);
        if (mutated === t) return t;
        changed = true;
        return { ...mutated, title: deriveTabTitle(mutated.linkedSessions, sessionsRef.current) };
      });
      if (!changed) return prev;
      const next = new Map(prev);
      next.set(aiSessionId, { ...existing, tabs: updatedTabs });
      return next;
    });
  }, []);

  /** Add a terminal to a tab's watched set (no-op if already present) and mark it
   *  the last-focused (default execute target). */
  const addTabLink = useCallback((aiSessionId: string, tabId: string, sessionId: string) => {
    mutateTabLinks(aiSessionId, tabId, (t) => {
      const already = t.linkedSessions.some(w => w.sessionId === sessionId);
      const rec = sessionsRef.current.get(sessionId);
      const bindingKey = rec ? sessionBindingKey(rec) : undefined;
      const linkedSessions = already
        ? t.linkedSessions
        : [...t.linkedSessions, { sessionId, bindingKey }];
      return { ...t, linkedSessions, lastFocusedWatchId: sessionId };
    });
  }, [mutateTabLinks]);

  /** Remove a terminal from a tab's watched set (explicit user unlink). */
  const removeTabLink = useCallback((aiSessionId: string, tabId: string, sessionId: string) => {
    mutateTabLinks(aiSessionId, tabId, (t) => {
      if (!t.linkedSessions.some(w => w.sessionId === sessionId)) return t;
      const linkedSessions = t.linkedSessions.filter(w => w.sessionId !== sessionId);
      const lastFocusedWatchId = t.lastFocusedWatchId === sessionId
        ? linkedSessions[0]?.sessionId
        : t.lastFocusedWatchId;
      return { ...t, linkedSessions, lastFocusedWatchId };
    });
  }, [mutateTabLinks]);

  /** Swap a dead entry's ephemeral `sessionId` in place (auto-rebind on reconnect).
   *  Matches the entry by its stable `bindingKey`; keeps insertion order and the
   *  conversation intact. Updates `lastFocusedWatchId` if it pointed at the old id. */
  const rebindTabLink = useCallback((aiSessionId: string, tabId: string, bindingKey: string, newSessionId: string) => {
    mutateTabLinks(aiSessionId, tabId, (t) => {
      const idx = t.linkedSessions.findIndex(w => w.bindingKey === bindingKey);
      if (idx < 0) return t;
      const oldId = t.linkedSessions[idx].sessionId;
      if (oldId === newSessionId) return t;
      const linkedSessions = t.linkedSessions.map((w, i) =>
        i === idx ? { ...w, sessionId: newSessionId } : w);
      const lastFocusedWatchId = t.lastFocusedWatchId === oldId ? newSessionId : t.lastFocusedWatchId;
      return { ...t, linkedSessions, lastFocusedWatchId };
    });
  }, [mutateTabLinks]);

  const updateAiChatStateRef = useRef(updateAiChatState);
  const updateActiveTabRef = useRef(updateActiveTab);
  const addTabLinkRef = useRef(addTabLink);
  const enqueuePendingMessageRef = useRef(enqueuePendingMessage);
  useEffect(() => {
    updateAiChatStateRef.current = updateAiChatState;
    updateActiveTabRef.current = updateActiveTab;
    addTabLinkRef.current = addTabLink;
    enqueuePendingMessageRef.current = enqueuePendingMessage;
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
      // Prefer the active tab's last-focused watched terminal, else its primary.
      const preferred = activeTab?.lastFocusedWatchId ?? firstLinkedSessionId(activeTab);
      if (preferred) {
        activeTermId = preferred;
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
  const sendMessage = useCallback(async (aiSessionId: string, text: string, images?: ChatImage[]) => {
    const chatState = aiChatStatesRef.current.get(aiSessionId);
    if (!chatState) return;
    const activeTab = getActiveTab(chatState);
    if (!activeTab) return;

    // Gate the first send to a third-party AI provider on the data-sharing consent.
    if (!(await ensureAiConsentRef.current())) return;

    // Aggregate the watched-terminal scrollback: drain each LIVE watched terminal's
    // buffer (read-once) and prepend one labeled section per terminal, so the AI
    // reasons across every terminal this tab watches. Skip stale (disconnected)
    // and empty buffers. A machine-generated command-output envelope is never
    // re-wrapped (it already carries its own terminal context).
    let prependedContext = '';
    if (!text.startsWith('Terminal Output (Command:')) {
      const currentSessions = sessionsRef.current;
      for (const w of activeTab.linkedSessions) {
        if (currentSessions.get(w.sessionId)?.status !== 'connected') continue;
        const buffer = await takeWatchBufferRef.current(w.sessionId);
        if (!buffer) continue;
        const name = currentSessions.get(w.sessionId)?.displayName || w.sessionId;
        // Redact secrets before this scrollback egresses to the third-party AI.
        prependedContext += `${watchedOutputSection(name)}\n${redactSecrets(buffer)}\n================\n`;
      }
    }

    const finalMessage = prependedContext + text;
    const selectedModel = chatState.selectedModel || 'Unspecified';
    // Append the watched-terminal alias list at send time (per sending tab) so the
    // AI can route a command via `target=<alias>`. Empty for 0–1 watched terminals,
    // leaving the single-watch prompt unchanged.
    const aliasEntries = buildAliasEntries(activeTab.linkedSessions.map((w) => {
      const rec = sessionsRef.current.get(w.sessionId);
      return { sessionId: w.sessionId, displayName: rec?.displayName || w.sessionId, status: rec?.status };
    }));
    const systemInstruction = (chatState.systemInstruction || 'You are a helpful assistant.') + buildWatchTargetsBlock(aliasEntries);

    const prepInfo = `useai-send-prep ${JSON.stringify({
      aiSessionId,
      tabId: activeTab.id,
      finalMessageLen: finalMessage.length,
      imageCount: images?.length ?? 0,
      hasWatchPrefix: prependedContext.length > 0,
    })}`;
    console.debug(`[AIExec/info] ${prepInfo}`);
    tauriService.logDebug('info', 'AIExec', prepInfo)?.catch(() => {});

    tauriService.aiChatSend(aiBackendSessionId(aiSessionId, activeTab.id), finalMessage, selectedModel, systemInstruction, images);
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
        const name = activeSession.displayName || activeTermId;
        prependedContext = `${watchedOutputSection(name)}\n${redactSecrets(buffer)}\n================\n`;
      }
    }

    // Redact secrets from BOTH the watched output and the user's selection before
    // they egress to the third-party AI provider.
    const redactedSelection = selection ? redactSecrets(selection) : selection;
    const finalSelection = prependedContext
      ? (redactedSelection ? `${prependedContext}[Target Text]\n${redactedSelection}` : prependedContext)
      : redactedSelection;

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
      // Ensure the target is watched by the active tab WITHOUT clobbering the other
      // terminals it already watches (Ask AI adds, never replaces).
      if (activeTab && !tabHasSession(activeTab, activeTermId)) {
        addTabLinkRef.current(aiPaneId, activeTab.id, activeTermId);
      }
    }

    const lang = localStorage.getItem(STORAGE_KEYS.GEMINI_LANGUAGE) || 'English';
    const expertiseLabel = existingState?.selectedExpertise;
    const systemInstruction = `${resolvePersonaPrompt(expertiseLabel)}${languageDirective(lang)}`;
    const userPrompt = `${question}\n\n\`\`\`\n${finalSelection}\n\`\`\``;

    updateAiChatStateRef.current(aiPaneId, { systemInstruction });
    // Resolve the active tab from the state we're operating on (aiChatStatesRef is
    // updated in a post-commit effect, so it can be stale right after a create).
    const targetTabId = getActiveTab(existingState)?.id;
    if (targetTabId) enqueuePendingMessageRef.current(aiPaneId, targetTabId, userPrompt);
  }, [resolveTargetTerminal, resolvePersonaPrompt]);

  return {
    aiChatStates,
    updateAiChatState,
    updateActiveTab,
    updateTabById,
    enqueuePendingMessage,
    dequeuePendingMessage,
    enqueuePendingUserMessage,
    dequeuePendingUserMessage,
    addTab,
    closeTab,
    removeAiChatState,
    setActiveTab,
    addTabLink,
    removeTabLink,
    rebindTabLink,
    sendMessage,
    askAi,
  };
}
