/**
 * Moving the AI Chat pane between this window and a dedicated AI Chat window.
 *
 * One conversation set exists in exactly one window. Popping out opens a
 * `win-ai-N` window and hands the conversations over; popping in hands them
 * back and closes that window. The wire format and its validation live in
 * `utils/aiWindowHandover.ts`; this hook owns the choreography.
 *
 * ## The handover is two-phase, on purpose
 * The sender keeps everything until the receiver acknowledges. Dropping first
 * would lose the conversation outright if the receiving window never came up,
 * and — less obviously — the backend watch buffer is reference-counted by
 * window: releasing the last watcher discards the buffered terminal output the
 * AI has not read yet. So the receiver subscribes, THEN acks, and only then
 * does the sender let go.
 *
 * The payload is re-broadcast on a short interval until the ack arrives,
 * because a freshly created window has not mounted its listener yet. Receiving
 * is idempotent (`importAiChatState` refuses a pane it already holds), so a
 * duplicate costs nothing.
 *
 * ## Only at rest
 * The caller gates the move on the conversation being idle — no stream, no
 * command run, no pending confirmation. That single rule removes the whole
 * class of "which window does this in-flight event belong to" bugs.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { tauriService } from '../services/tauriService';
import { useSettingsStore } from '../stores/settingsStore';
import {
  useAiWorkerSessionStore,
  workersForPane,
  type AiWorkerSession,
} from '../stores/aiWorkerSessionStore';
import { logError } from '../utils/logger';
import i18n from '../i18n';
import { AI_WINDOW_PREFIX, IS_AI_CHAT_WINDOW, IS_TAURI, WINDOW_LABEL } from '../utils/windowLabel';
import {
  AI_HANDOVER_ACK_CHANNEL,
  AI_HANDOVER_CHANNEL,
  buildHandoverAck,
  buildHandoverPayload,
  parseHandoverAck,
  parseHandoverPayload,
  workerIdsOf,
  AI_ADOPT_SESSION_CHANNEL,
  AI_WATCH_REQUEST_CHANNEL,
  buildAdoptRequest,
  buildWatchRequest,
  parseAdoptRequest,
  parseWatchRequest,
  type AiHandoverPayload,
  type HandoverMessages,
  type HandoverTokens,
} from '../utils/aiWindowHandover';
import { aiBackendSessionId, type AiChatState } from './useAiChat';

/** Log without raising a toast — `logError` is for things the user must see. */
function debug(message: string): void {
  void tauriService.logDebug('info', 'AIWindow', message).catch(() => {});
}

/** How long the sender waits for the receiver's ack before giving up. */
export const HANDOVER_ACK_TIMEOUT_MS = 5000;

/** How often the payload is re-broadcast while waiting for that ack. */
export const HANDOVER_RETRY_MS = 400;

/** A mounted AI Chat pane's transcripts, which live inside the pane, not App. */
export interface ChatTranscriptPort {
  export: () => { messages: HandoverMessages; tokens: HandoverTokens };
  import: (messages: HandoverMessages, tokens: HandoverTokens) => void;
}

export interface UseAiChatWindowOptions {
  /** The AI Chat pane in THIS window, if it has one. */
  aiChatPaneId: string | undefined;
  getAiChatState: (paneId: string) => AiChatState | undefined;
  importAiChatState: (paneId: string, state: AiChatState) => boolean;
  forgetAiChatState: (paneId: string) => void;
  /** Register an AI Chat pane under a known id (bypasses the singleton gate). */
  registerAiChatPane: (paneId: string) => string;
  /** Swap this window's AI Chat pane for one arriving from elsewhere. */
  replaceAiChatPane: (oldId: string, newId: string) => void;
  /** Drop a pane from the layout entirely (the sender, after a successful move). */
  removeAiChatPane: (paneId: string) => void;
  /** Stop a pane's poll intervals / sleep timers. */
  clearRunCommandIntervals: (paneId: string) => void;
  /** Title of the conversation on screen, shown in the AI window's title bar. */
  activeConversationTitle?: string;
  /**
   * Start watching a terminal in a conversation ('new' = a fresh one). Used when
   * another window asks this AI Chat window to pick a terminal up; it carries
   * the data-sharing consent gate and the single-owner move, so this hook never
   * has to reimplement either.
   */
  watchInConversation: (sessionId: string, target: string | 'new') => void;
  /** Id of the conversation on screen — where an incoming watch request lands. */
  activeConversationTabId?: string;
  /**
   * Give one of the AI's terminals a real tab in THIS window, on behalf of an
   * AI Chat window that has no tab strip. `history` is the scrollback read from
   * the backend watch buffer.
   */
  adoptRemoteSession: (worker: AiWorkerSession, history: string) => void;
}

export interface UseAiChatWindowReturn {
  /** Move this window's AI Chat conversations into a dedicated AI Chat window. */
  popOut: () => void;
  /** Move this AI Chat window's conversations back into an ordinary window. */
  popIn: () => void;
  /** A handover is in flight; the move button stays disabled until it settles. */
  moving: boolean;
  /** Whether this AI Chat window is pinned above other applications. */
  alwaysOnTop: boolean;
  toggleAlwaysOnTop: () => void;
  /**
   * Publish (or withdraw, with `null`) a mounted AI Chat pane's transcript
   * accessors. The pane owns its message state, so this is how a handover
   * reaches it. Kept inside the hook rather than handed in as a ref: passing a
   * ref object into a hook call during render costs the whole component its
   * React Compiler optimization.
   */
  registerTranscriptPort: (paneId: string, port: ChatTranscriptPort | null) => void;
  /**
   * What closing this AI Chat window would throw away, or `null` when nothing
   * is being closed. Non-null means the user pressed X and there is something
   * to lose — App renders the confirmation from it.
   */
  closeRequest: { conversations: number; workers: number } | null;
  /** Go ahead and close (ends the conversations for good). */
  confirmClose: () => void;
  /** Keep the window open. */
  cancelClose: () => void;
  /**
   * Have the AI Chat window watch this terminal: hand it to the window if one is
   * open, otherwise move AI Chat out into one and hand it over there.
   */
  watchInAiWindow: (sessionId: string) => void;
  /**
   * Ask an ordinary window to give this AI-opened terminal a tab. Returns true
   * when this window is an AI Chat window and has taken the request on; false
   * means "not my job — adopt it yourself".
   */
  handOffMaterialize: (worker: AiWorkerSession) => boolean;
}

export function useAiChatWindow(options: UseAiChatWindowOptions): UseAiChatWindowReturn {
  const { activeConversationTitle } = options;
  const [moving, setMoving] = useState(false);
  const [closeRequest, setCloseRequest] = useState<{ conversations: number; workers: number } | null>(null);
  /** Transcript accessors of the AI Chat panes mounted in this window. */
  const transcriptPortsRef = useRef(new Map<string, ChatTranscriptPort>());
  const alwaysOnTop = useSettingsStore((s) => s.aiWindowAlwaysOnTop);

  // Latest-value mirrors: the broadcast listener and the retry timer are set up
  // once and must not close over a render's callbacks.
  const optsRef = useRef(options);
  useEffect(() => {
    optsRef.current = options;
  });

  /**
   * Transcripts that arrived before their pane finished mounting.
   *
   * The pane owns its message state, so it can only be filled once it has
   * registered a port. The handover deliberately does NOT wait for that — the
   * ack has to go out promptly — so the payload parks here and the port drains
   * it on registration.
   */
  const pendingTranscriptsRef = useRef(new Map<string, { messages: HandoverMessages; tokens: HandoverTokens }>());

  /** The window a pop-in should return to, learned from the payload that arrived. */
  const originLabelRef = useRef<string | null>(null);

  /** The handover this window is currently waiting to be acknowledged. */
  const pendingRef = useRef<{
    paneId: string;
    to: string;
    raw: string;
    timer: ReturnType<typeof setInterval> | null;
    deadline: number;
    onAck: (adopted: string[]) => void;
  } | null>(null);

  const finishPending = useCallback(() => {
    const p = pendingRef.current;
    if (p?.timer) clearInterval(p.timer);
    pendingRef.current = null;
    setMoving(false);
  }, []);

  // ── Receiving ────────────────────────────────────────────────────────────

  const receive = useCallback(
    async (payload: AiHandoverPayload) => {
      const o = optsRef.current;
      // Take ownership of the AI's worker terminals FIRST. If this window then
      // fails to install the conversation, the sender never sees an ack and
      // keeps it — whereas workers left owned by a window that is about to
      // close would be disconnected out from under a live conversation.
      let adopted: string[] = [];
      const wantWorkers = workerIdsOf(payload);
      if (wantWorkers.length > 0) {
        try {
          adopted = await tauriService.adoptSessions(wantWorkers);
        } catch (e) {
          // Not fatal: the conversation is still worth moving, and the sender's
          // window may simply not be closing. Log and carry on.
          debug(`AI handover: could not adopt worker sessions: ${String(e)}`);
        }
      }

      // In an AI Chat window, the conversation replaces the empty pane the
      // window opened with. Elsewhere it is an additional pane — deliberately
      // bypassing the one-AI-Chat-per-window rule, because refusing here would
      // strand a conversation that has nowhere else to go.
      const existing = o.aiChatPaneId;
      if (existing && existing !== payload.paneId && IS_AI_CHAT_WINDOW) {
        o.replaceAiChatPane(existing, payload.paneId);
      } else {
        o.registerAiChatPane(payload.paneId);
      }

      const installed = o.importAiChatState(payload.paneId, payload.state);
      if (!installed) {
        // We already hold this pane — the sender is retrying an ack we lost.
        // Re-ack rather than doing the work twice.
        debug(`AI handover: pane ${payload.paneId} already present; re-acknowledging`);
      } else {
        pendingTranscriptsRef.current.set(payload.paneId, {
          messages: payload.messages,
          tokens: payload.tokens,
        });
        drainTranscripts(payload.paneId, transcriptPortsRef, pendingTranscriptsRef);

        // Re-create the AI's worker terminals in this window's registry. These
        // carry no secrets (the store never held any), only what the tray chip
        // and the duplicate-connection check need.
        const store = useAiWorkerSessionStore.getState();
        for (const w of payload.workers) store.upsert(w);
      }

      originLabelRef.current = payload.from;
      await tauriService.broadcastSharedChange(
        AI_HANDOVER_ACK_CHANNEL,
        JSON.stringify(
          buildHandoverAck({
            to: payload.from,
            from: WINDOW_LABEL,
            paneId: payload.paneId,
            adopted,
          }),
        ),
      );
      debug(
        `AI handover: received ${payload.paneId} from ${payload.from} ` +
          `(${payload.state.tabs.length} conversation(s), ${adopted.length} worker(s))`,
      );
    },
    [],
  );

  // ── Sending ──────────────────────────────────────────────────────────────

  const startHandover = useCallback(
    (paneId: string, to: string, onAck: (adopted: string[]) => void) => {
      const o = optsRef.current;
      const state = o.getAiChatState(paneId);
      if (!state) {
        debug(`AI handover: nothing to move for pane ${paneId}`);
        setMoving(false);
        return;
      }
      const port = transcriptPortsRef.current?.get(paneId);
      const transcripts = port ? port.export() : { messages: [], tokens: [] };
      const payload = buildHandoverPayload({
        to,
        from: WINDOW_LABEL,
        paneId,
        state,
        messagesByTab: new Map(transcripts.messages),
        tokensByTab: new Map(transcripts.tokens),
        workers: workersForPane(useAiWorkerSessionStore.getState().workers, paneId),
      });
      const raw = JSON.stringify(payload);

      const send = () => {
        void tauriService.broadcastSharedChange(AI_HANDOVER_CHANNEL, raw).catch((e) => {
          debug(`AI handover: broadcast failed: ${String(e)}`);
        });
      };

      // Re-broadcast until acknowledged: a window created moments ago has not
      // mounted its listener yet, and receiving is idempotent.
      const timer = setInterval(() => {
        const p = pendingRef.current;
        if (!p) return;
        if (Date.now() >= p.deadline) {
          clearInterval(timer);
          pendingRef.current = null;
          setMoving(false);
          logError('AIWindow', i18n.t('notifications.errors.aiWindowHandoverTimedOut'));
          return;
        }
        send();
      }, HANDOVER_RETRY_MS);

      pendingRef.current = {
        paneId,
        to,
        raw,
        timer,
        deadline: Date.now() + HANDOVER_ACK_TIMEOUT_MS,
        onAck,
      };
      setMoving(true);
      send();
    },
    [],
  );

  const popOut = useCallback((afterMove?: (label: string) => void) => {
    if (!IS_TAURI || pendingRef.current) return;
    const paneId = optsRef.current.aiChatPaneId;
    if (!paneId) return;
    setMoving(true);
    void (async () => {
      try {
        const bounds = useSettingsStore.getState().aiWindowBounds ?? undefined;
        const label = await tauriService.createAiChatWindow(bounds);
        startHandover(paneId, label, () => {
          const o = optsRef.current;
          // The conversation now lives in the new window: stop this window's
          // polls, drop the state WITHOUT freeing backend history (the other
          // window is still talking to it), and free the pane slot.
          o.clearRunCommandIntervals(paneId);
          o.forgetAiChatState(paneId);
          o.removeAiChatPane(paneId);
          const store = useAiWorkerSessionStore.getState();
          for (const w of workersForPane(store.workers, paneId)) store.remove(w.id);
          afterMove?.(label);
        });
      } catch (e) {
        setMoving(false);
        logError('AIWindow', i18n.t('notifications.errors.aiWindowOpenFailed'), e);
      }
    })();
  }, [startHandover]);

  const popOutRef = useRef(popOut);
  useEffect(() => {
    popOutRef.current = popOut;
  });

  const popIn = useCallback(() => {
    if (!IS_TAURI || pendingRef.current) return;
    const paneId = optsRef.current.aiChatPaneId;
    if (!paneId) return;
    setMoving(true);
    void (async () => {
      try {
        const target = await resolvePopInTarget(originLabelRef.current);
        startHandover(paneId, target, () => {
          const o = optsRef.current;
          o.clearRunCommandIntervals(paneId);
          o.forgetAiChatState(paneId);
          // Closing this window is the point of popping in; its own teardown
          // (WindowEvent::Destroyed) cleans up whatever is left behind.
          void tauriService.closeThisWindow().catch((e) => {
            debug(`AI handover: could not close the AI window: ${String(e)}`);
          });
        });
      } catch (e) {
        setMoving(false);
        logError('AIWindow', i18n.t('notifications.errors.aiWindowPopInFailed'), e);
      }
    })();
  }, [startHandover]);

  // ── Wiring ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!IS_TAURI) return;
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void tauriService
      .onSharedStoreChanged(({ channel, payload, origin }) => {
        if (origin === WINDOW_LABEL) return;
        if (channel === AI_HANDOVER_CHANNEL) {
          const parsed = parseHandoverPayload(payload, WINDOW_LABEL);
          if (parsed) void receive(parsed);
          return;
        }
        if (channel === AI_ADOPT_SESSION_CHANNEL) {
          const req = parseAdoptRequest(payload, WINDOW_LABEL);
          if (!req) return;
          void (async () => {
            // Take ownership first: this window is about to render the terminal,
            // and the AI window it came from may close at any time.
            await tauriService.adoptSessions([req.worker.id]).catch(() => []);
            const history = await tauriService.getWatchBuffer(req.worker.id).catch(() => '');
            optsRef.current.adoptRemoteSession(req.worker, history);
            void tauriService.focusWindow().catch(() => {});
          })();
          return;
        }
        if (channel === AI_WATCH_REQUEST_CHANNEL) {
          const req = parseWatchRequest(payload, WINDOW_LABEL);
          if (!req) return;
          const o = optsRef.current;
          o.watchInConversation(req.sessionId, o.activeConversationTabId ?? 'new');
          void tauriService.focusWindow().catch(() => {});
          return;
        }
        if (channel === AI_HANDOVER_ACK_CHANNEL) {
          const p = pendingRef.current;
          if (!p) return;
          const ack = parseHandoverAck(payload, WINDOW_LABEL, p.paneId);
          if (!ack) return;
          const onAck = p.onAck;
          finishPending();
          onAck(ack.adopted);
        }
      })
      .then((un) => {
        if (disposed) un();
        else unlisten = un;
      })
      .catch(() => {
        /* listen() unavailable (tests) — handover stays a no-op */
      });
    return () => {
      disposed = true;
      if (unlisten) unlisten();
      const p = pendingRef.current;
      if (p?.timer) clearInterval(p.timer);
    };
  }, [receive, finishPending]);

  // Drain any transcripts that arrived before their pane mounted. Runs on every
  // commit because that is exactly when a newly mounted pane has registered its
  // port; it is a cheap map lookup when there is nothing waiting.
  useEffect(() => {
    if (pendingTranscriptsRef.current.size === 0) return;
    for (const paneId of Array.from(pendingTranscriptsRef.current.keys())) {
      drainTranscripts(paneId, transcriptPortsRef, pendingTranscriptsRef);
    }
  });

  // Apply the pinned-on-top preference, and re-apply it whenever it changes.
  // Only an AI Chat window is ever pinned — doing it to a terminal window would
  // put the user's own work permanently over everything else.
  useEffect(() => {
    if (!IS_TAURI || !IS_AI_CHAT_WINDOW) return;
    void tauriService.setAlwaysOnTop(alwaysOnTop).catch((e) => {
      debug(`AI Chat window: could not set always-on-top: ${String(e)}`);
    });
  }, [alwaysOnTop]);

  // Remember where the user left the AI Chat window, so the next one opens
  // there. Saved on move/resize (debounced) and once more on unload, which is
  // the only chance to catch a window closed straight after being dragged.
  useEffect(() => {
    if (!IS_TAURI || !IS_AI_CHAT_WINDOW) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const save = () => {
      void tauriService
        .getWindowRect()
        .then((rect) => useSettingsStore.getState().update('aiWindowBounds', rect))
        .catch(() => {
          /* geometry unavailable — keep whatever was remembered before */
        });
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(save, 400);
    };
    window.addEventListener('resize', schedule);
    window.addEventListener('beforeunload', save);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('beforeunload', save);
    };
  }, []);

  // Show the AI Chat window's conversation in its title bar, so several of them
  // are still tellable apart in the taskbar.
  useEffect(() => {
    if (!IS_TAURI || !IS_AI_CHAT_WINDOW) return;
    const base = 'HoTTY AI Chat';
    void tauriService
      .setWindowTitle(activeConversationTitle ? `${base} — ${activeConversationTitle}` : base)
      .catch(() => {
        /* title is cosmetic — never worth surfacing */
      });
  }, [activeConversationTitle]);

  /**
   * Closing an AI Chat window ends its conversations — this is the one exit
   * that discards them, so it asks first when there is anything to lose. An
   * empty chat closes without a dialog: interrupting someone to confirm the
   * disposal of nothing is just noise.
   */
  const requestClose = useCallback(() => {
    const o = optsRef.current;
    const paneId = o.aiChatPaneId;
    const state = paneId ? o.getAiChatState(paneId) : undefined;
    const ports = paneId ? transcriptPortsRef.current.get(paneId) : undefined;
    const transcripts = ports?.export().messages ?? [];
    const conversations = transcripts.filter(([, msgs]) => msgs.length > 0).length;
    const workers = paneId
      ? workersForPane(useAiWorkerSessionStore.getState().workers, paneId).length
      : 0;
    if (!state || (conversations === 0 && workers === 0)) {
      void tauriService.closeThisWindow().catch(() => {});
      return;
    }
    setCloseRequest({ conversations, workers });
  }, []);

  const cancelClose = useCallback(() => setCloseRequest(null), []);

  const confirmClose = useCallback(() => {
    setCloseRequest(null);
    const o = optsRef.current;
    const paneId = o.aiChatPaneId;
    if (paneId) {
      o.clearRunCommandIntervals(paneId);
      // Free each conversation's backend history. The AI's worker terminals need
      // no explicit teardown: this window owns them after the handover, and
      // `cleanup_window_sessions` disconnects a closing window's sessions.
      const state = o.getAiChatState(paneId);
      for (const tab of state?.tabs ?? []) {
        void tauriService.aiChatClear(aiBackendSessionId(paneId, tab.id)).catch(() => {});
      }
    }
    void tauriService.closeThisWindow().catch((e) => {
      debug(`AI Chat window: close failed: ${String(e)}`);
    });
  }, []);

  // Intercept the title-bar X so the confirmation can be an in-app modal that
  // matches the rest of the UI (focus-trapped, Escape = keep the window).
  useEffect(() => {
    if (!IS_TAURI || !IS_AI_CHAT_WINDOW) return;
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void tauriService
      .onCloseRequested(() => requestClose())
      .then((un) => {
        if (disposed) un();
        else unlisten = un;
      })
      .catch(() => {
        /* without the hook the window just closes — acceptable, not silent data loss:
           the backend still tears the sessions down. */
      });
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, [requestClose]);

  const watchInAiWindow = useCallback((sessionId: string) => {
    if (!IS_TAURI) return;
    void (async () => {
      const labels = await tauriService.listWindowLabels().catch(() => [] as string[]);
      const aiLabel = labels.find((l) => l.startsWith(AI_WINDOW_PREFIX) && l !== WINDOW_LABEL);
      const ask = (to: string) =>
        tauriService
          .broadcastSharedChange(AI_WATCH_REQUEST_CHANNEL, JSON.stringify(buildWatchRequest(to, sessionId)))
          .catch((e) => debug(`AI watch request failed: ${String(e)}`));
      if (aiLabel) {
        await ask(aiLabel);
        return;
      }
      // No AI Chat window yet. Move the conversation out FIRST and only then ask
      // — asking before the handover would race the new window's listener, and
      // linking here first would race React's commit of the link.
      popOutRef.current((label) => void ask(label));
    })();
  }, []);

  const handOffMaterialize = useCallback((worker: AiWorkerSession): boolean => {
    if (!IS_TAURI || !IS_AI_CHAT_WINDOW) return false;
    void (async () => {
      try {
        const target = await resolvePopInTarget(originLabelRef.current);
        await tauriService.broadcastSharedChange(
          AI_ADOPT_SESSION_CHANNEL,
          JSON.stringify(buildAdoptRequest(target, worker)),
        );
      } catch (e) {
        logError('AIWindow', i18n.t('notifications.errors.aiWindowOpenAsTabFailed'), e);
      }
    })();
    return true;
  }, []);

  const registerTranscriptPort = useCallback(
    (paneId: string, port: ChatTranscriptPort | null) => {
      if (port) transcriptPortsRef.current.set(paneId, port);
      else transcriptPortsRef.current.delete(paneId);
    },
    [],
  );

  const toggleAlwaysOnTop = useCallback(() => {
    const cur = useSettingsStore.getState().aiWindowAlwaysOnTop;
    useSettingsStore.getState().update('aiWindowAlwaysOnTop', !cur);
  }, []);

  return {
    popOut,
    popIn,
    watchInAiWindow,
    handOffMaterialize,
    moving,
    alwaysOnTop,
    toggleAlwaysOnTop,
    registerTranscriptPort,
    closeRequest,
    confirmClose,
    cancelClose,
  };
}

/** Hand parked transcripts to a pane that has since registered its port. */
function drainTranscripts(
  paneId: string,
  portsRef: React.RefObject<Map<string, ChatTranscriptPort>>,
  pendingRef: React.RefObject<Map<string, { messages: HandoverMessages; tokens: HandoverTokens }>>,
) {
  const parked = pendingRef.current?.get(paneId);
  if (!parked) return;
  const port = portsRef.current?.get(paneId);
  if (!port) return;
  port.import(parked.messages, parked.tokens);
  pendingRef.current?.delete(paneId);
}

/**
 * Which window a pop-in should hand the conversation to.
 *
 * Prefers the window it came from. That window may have been closed since, so
 * fall back to any other ordinary window; and if this AI window is the last one
 * standing, open a fresh window to move into rather than refusing.
 */
async function resolvePopInTarget(originLabel: string | null): Promise<string> {
  const labels = await tauriService.listWindowLabels();
  if (originLabel && labels.includes(originLabel)) return originLabel;
  const ordinary = labels.filter((l) => l !== WINDOW_LABEL && !l.startsWith(AI_WINDOW_PREFIX));
  if (ordinary.length > 0) return ordinary[0];
  return tauriService.createWindow();
}

/** Re-exported for the pane, which needs the worker shape when it lists chips. */
export type { AiWorkerSession };
