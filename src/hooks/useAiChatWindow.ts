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
 * The transcripts travel through `aiTranscriptStore`: the receiver writes the
 * payload's turns into the store BEFORE it registers the pane, so the pane's
 * very first render shows the conversation (and the Network Expert kickoff
 * never mistakes a moved-in chat for a new one).
 *
 * The payload is re-broadcast on a short interval until the ack arrives,
 * because a freshly created window has not mounted its listener yet. Receiving
 * is idempotent (`importAiChatState` refuses a pane it already holds), so a
 * duplicate costs nothing.
 *
 * ## Only at rest
 * A conversation moves only while it is idle — no stream, no command run, no
 * pending confirmation. That single rule removes the whole class of "which
 * window does this in-flight event belong to" bugs. The pane knows whether it
 * is at rest and says so through its port; `popOut` / `popIn` ask it, so every
 * entry point (the header button, the terminal tab's "Watch in the AI Chat
 * window") is gated the same way.
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
  AI_DIALOG_REQUEST_CHANNEL,
  AI_DIALOG_RESULT_CHANNEL,
  buildAdoptRequest,
  buildWatchRequest,
  buildDialogRequest,
  buildDialogResult,
  parseAdoptRequest,
  parseWatchRequest,
  parseDialogRequest,
  parseDialogResult,
  type AiHandoverPayload,
  type AiDialogRequest,
} from '../utils/aiWindowHandover';
import { aiBackendSessionId, getActiveTab, tabHasSession, type AiChatState } from './useAiChat';
import type { SessionDialogPrefill } from '../types/appTypes';
import { useAiTranscriptStore } from '../stores/aiTranscriptStore';
import { disposePaneStreams } from './useChatStream';

/** Log without raising a toast — `logError` is for things the user must see. */
function debug(message: string): void {
  void tauriService.logDebug('info', 'AIWindow', message).catch(() => {});
}

/**
 * Remember where the AI Chat window is, then close it for good.
 *
 * The close is a `destroy()`, which does not reliably fire `beforeunload`, so
 * the geometry is saved here explicitly — this is the last chance to catch a
 * window closed straight after being dragged. A failed read keeps whatever
 * was remembered before; the close goes ahead either way.
 */
async function saveBoundsAndClose(): Promise<void> {
  if (IS_AI_CHAT_WINDOW) {
    try {
      const rect = await tauriService.getWindowRect();
      useSettingsStore.getState().update('aiWindowBounds', rect);
    } catch {
      /* geometry unavailable — keep whatever was remembered before */
    }
  }
  await tauriService.closeThisWindow();
}

/** How long the sender waits for the receiver's ack before giving up. */
export const HANDOVER_ACK_TIMEOUT_MS = 5000;

/** How often the payload is re-broadcast while waiting for that ack. */
export const HANDOVER_RETRY_MS = 400;

/** What a mounted AI Chat pane tells this hook about itself. */
export interface ChatPanePort {
  /** Whether the conversation is at rest (no stream, run, countdown or card
   *  awaiting an answer) and may therefore change window right now. */
  canMove: () => boolean;
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
  /**
   * Start watching a terminal when this window has no AI Chat yet: creates the
   * pane and a conversation seeded with the terminal (the "AI Monitor" toggle's
   * cold start). Consent-gated like `watchInConversation`.
   */
  watchColdStart: (sessionId: string) => void;
  /** Id of the conversation on screen — where an incoming watch request lands. */
  activeConversationTabId?: string;
  /**
   * Show the connection dialog for an AI request that another window's
   * conversation is waiting on (an AI Chat window has nowhere to put the
   * terminal). The result is reported back through `reportDialogResult`.
   */
  showDialogForRemote: (request: AiDialogRequest) => void;
  /**
   * A session the user connected (or declined) in another window for THIS
   * window's AI request: link it to the waiting conversation and watch for
   * its prompt, or tell the model the user declined.
   */
  onRemoteDialogResult: (paneId: string, tabId: string, key: string, sessionId: string | undefined) => void;
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
   * Publish (or withdraw, with `null`) a mounted AI Chat pane's port. Kept
   * inside the hook rather than handed in as a ref: passing a ref object into
   * a hook call during render costs the whole component its React Compiler
   * optimization.
   */
  registerPanePort: (paneId: string, port: ChatPanePort | null) => void;
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
  /**
   * Ask an ordinary window to show the pre-filled connection dialog for an AI
   * request of this window's conversation. Returns true when this window is an
   * AI Chat window and has delegated it; false means "show it yourself".
   */
  delegateDialog: (paneId: string, tabId: string, key: string, prefill: SessionDialogPrefill) => boolean;
  /**
   * Report what the user did in a dialog shown on another window's behalf:
   * the session they connected, or nothing (they closed it).
   */
  reportDialogResult: (request: AiDialogRequest, sessionId: string | undefined) => void;
}

export function useAiChatWindow(options: UseAiChatWindowOptions): UseAiChatWindowReturn {
  const { activeConversationTitle } = options;
  const [moving, setMoving] = useState(false);
  const [closeRequest, setCloseRequest] = useState<{ conversations: number; workers: number } | null>(null);
  /** Ports of the AI Chat panes mounted in this window. */
  const panePortsRef = useRef(new Map<string, ChatPanePort>());
  const alwaysOnTop = useSettingsStore((s) => s.aiWindowAlwaysOnTop);

  // Latest-value mirrors: the broadcast listener and the retry timer are set up
  // once and must not close over a render's callbacks.
  const optsRef = useRef(options);
  useEffect(() => {
    optsRef.current = options;
  });

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

      const installed = o.importAiChatState(payload.paneId, payload.state);
      if (!installed) {
        // We already hold this pane — the sender is retrying an ack we lost.
        // Re-ack rather than doing the work twice.
        debug(`AI handover: pane ${payload.paneId} already present; re-acknowledging`);
      } else {
        // The transcripts go into the store the pane reads from — BEFORE the
        // pane is put into the layout below, so its first render already shows
        // the conversation (an empty first render is what made the Network
        // Expert identify the device all over again).
        useAiTranscriptStore.getState().importPane(payload.paneId, payload.messages, payload.tokens, payload.outcomes);

        // Re-create the AI's worker terminals in this window's registry. These
        // carry no secrets (the store never held any), only what the tray chip
        // and the duplicate-connection check need.
        const store = useAiWorkerSessionStore.getState();
        for (const w of payload.workers) store.upsert(w);
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
      const transcripts = useAiTranscriptStore.getState().exportPane(paneId);
      const payload = buildHandoverPayload({
        to,
        from: WINDOW_LABEL,
        paneId,
        state,
        messagesByTab: new Map(transcripts.messages),
        tokensByTab: new Map(transcripts.tokens),
        outcomes: transcripts.outcomes,
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

  /**
   * Whether the pane may change window right now. The pane's port is the
   * authority; a pane that has not registered one (not mounted yet) is at
   * rest by definition. A refused move is reported, since the caller may be a
   * context menu with no greyed-out button to explain itself.
   */
  const atRest = useCallback((paneId: string): boolean => {
    const port = panePortsRef.current.get(paneId);
    if (!port || port.canMove()) return true;
    logError('AIWindow', i18n.t('notifications.errors.aiWindowMoveBlocked'));
    return false;
  }, []);

  const popOut = useCallback((afterMove?: (label: string) => void) => {
    if (!IS_TAURI || pendingRef.current) return;
    const paneId = optsRef.current.aiChatPaneId;
    if (!paneId || !atRest(paneId)) return;
    setMoving(true);
    void (async () => {
      try {
        const bounds = useSettingsStore.getState().aiWindowBounds ?? undefined;
        const label = await tauriService.createAiChatWindow(bounds);
        startHandover(paneId, label, (adopted) => {
          const o = optsRef.current;
          // The conversation now lives in the new window: stop this window's
          // polls, drop the state WITHOUT freeing backend history (the other
          // window is still talking to it), and free the pane slot.
          o.clearRunCommandIntervals(paneId);
          o.forgetAiChatState(paneId);
          o.removeAiChatPane(paneId);
          disposePaneStreams(paneId);
          // Only the AI terminals the receiver actually took ownership of leave
          // this window's registry. One it could not adopt is still this
          // window's session: kept here, the idle sweep eventually closes it,
          // whereas forgotten it would run on with no one able to close it.
          const store = useAiWorkerSessionStore.getState();
          const taken = new Set(adopted);
          for (const w of workersForPane(store.workers, paneId)) {
            if (taken.has(w.id)) store.remove(w.id);
          }
          afterMove?.(label);
        });
      } catch (e) {
        setMoving(false);
        logError('AIWindow', i18n.t('notifications.errors.aiWindowOpenFailed'), e);
      }
    })();
  }, [startHandover, atRest]);

  const popOutRef = useRef(popOut);
  useEffect(() => {
    popOutRef.current = popOut;
  });

  const popIn = useCallback(() => {
    if (!IS_TAURI || pendingRef.current) return;
    const paneId = optsRef.current.aiChatPaneId;
    if (!paneId || !atRest(paneId)) return;
    setMoving(true);
    void (async () => {
      try {
        const target = await resolvePopInTarget(originLabelRef.current);
        startHandover(paneId, target, () => {
          const o = optsRef.current;
          o.clearRunCommandIntervals(paneId);
          o.forgetAiChatState(paneId);
          disposePaneStreams(paneId);
          // Closing this window is the point of popping in; its own teardown
          // (WindowEvent::Destroyed) cleans up whatever is left behind.
          void saveBoundsAndClose().catch((e) => {
            debug(`AI handover: could not close the AI window: ${String(e)}`);
          });
        });
      } catch (e) {
        setMoving(false);
        logError('AIWindow', i18n.t('notifications.errors.aiWindowPopInFailed'), e);
      }
    })();
  }, [startHandover, atRest]);

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
          // "Watch in" means watch: a terminal the conversation on screen
          // already watches is left as it is (the picker's toggle-off would
          // otherwise unwatch it) — the window just comes forward.
          const state = o.aiChatPaneId ? o.getAiChatState(o.aiChatPaneId) : undefined;
          if (!tabHasSession(getActiveTab(state), req.sessionId)) {
            o.watchInConversation(req.sessionId, o.activeConversationTabId ?? 'new');
          }
          void tauriService.focusWindow().catch(() => {});
          return;
        }
        if (channel === AI_DIALOG_REQUEST_CHANNEL) {
          const req = parseDialogRequest(payload, WINDOW_LABEL);
          if (!req) return;
          optsRef.current.showDialogForRemote(req);
          void tauriService.focusWindow().catch(() => {});
          return;
        }
        if (channel === AI_DIALOG_RESULT_CHANNEL) {
          const res = parseDialogResult(payload, WINDOW_LABEL);
          if (!res) return;
          optsRef.current.onRemoteDialogResult(res.paneId, res.tabId, res.key, res.sessionId);
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
  // there. Saved on move/resize (debounced), and once more right before each
  // close (see saveBoundsAndClose — `beforeunload` is kept as a fallback, but a
  // destroyed window is not guaranteed to fire it).
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
    const transcripts = paneId ? useAiTranscriptStore.getState().exportPane(paneId).messages : [];
    const conversations = transcripts.filter(([, msgs]) => msgs.length > 0).length;
    const workers = paneId
      ? workersForPane(useAiWorkerSessionStore.getState().workers, paneId).length
      : 0;
    if (!state || (conversations === 0 && workers === 0)) {
      void saveBoundsAndClose().catch(() => {});
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
      disposePaneStreams(paneId);
    }
    void saveBoundsAndClose().catch((e) => {
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
      if (!optsRef.current.aiChatPaneId) {
        // No AI Chat anywhere yet. Start one here, watching this terminal,
        // and move it out once React has it — a pop-out with nothing to move
        // used to be a silent no-op, leaving a menu item that did nothing.
        optsRef.current.watchColdStart(sessionId);
        const ready = await settles(() => {
          const id = optsRef.current.aiChatPaneId;
          return !!id && !!optsRef.current.getAiChatState(id);
        });
        if (!ready) {
          debug('AI watch in window: the conversation did not appear in time');
          return;
        }
        // The conversation already watches the terminal; nothing to ask for.
        popOutRef.current();
        return;
      }
      // No AI Chat window yet. Move the conversation out FIRST and only then ask
      // — asking before the handover would race the new window's listener, and
      // linking here first would race React's commit of the link.
      popOutRef.current((label) => void ask(label));
    })();
  }, []);

  const delegateDialog = useCallback((paneId: string, tabId: string, key: string, prefill: SessionDialogPrefill): boolean => {
    if (!IS_TAURI || !IS_AI_CHAT_WINDOW) return false;
    void (async () => {
      try {
        const target = await resolvePopInTarget(originLabelRef.current);
        await tauriService.broadcastSharedChange(
          AI_DIALOG_REQUEST_CHANNEL,
          JSON.stringify(buildDialogRequest({ to: target, from: WINDOW_LABEL, paneId, tabId, key, prefill })),
        );
      } catch (e) {
        logError('AIWindow', i18n.t('notifications.errors.aiWindowOpenFailed'), e);
        // Nobody will answer: close the request out as declined.
        optsRef.current.onRemoteDialogResult(paneId, tabId, key, undefined);
      }
    })();
    return true;
  }, []);

  const reportDialogResult = useCallback((request: AiDialogRequest, sessionId: string | undefined) => {
    if (!IS_TAURI) return;
    void tauriService
      .broadcastSharedChange(
        AI_DIALOG_RESULT_CHANNEL,
        JSON.stringify(buildDialogResult({ to: request.from, paneId: request.paneId, tabId: request.tabId, key: request.key, sessionId })),
      )
      .catch((e) => debug(`AI dialog result failed: ${String(e)}`));
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

  const registerPanePort = useCallback(
    (paneId: string, port: ChatPanePort | null) => {
      if (port) panePortsRef.current.set(paneId, port);
      else panePortsRef.current.delete(paneId);
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
    delegateDialog,
    reportDialogResult,
    moving,
    alwaysOnTop,
    toggleAlwaysOnTop,
    registerPanePort,
    closeRequest,
    confirmClose,
    cancelClose,
  };
}

/** Poll `check` every 50 ms until it holds, for at most `timeoutMs`. */
async function settles(check: () => boolean, timeoutMs = 2000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return check();
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
