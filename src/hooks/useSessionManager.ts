import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { tauriService } from '../services/tauriService';
import { useSettingsStore } from '../stores/settingsStore';
import { TERMINAL_SEQUENCES } from '../constants/terminalSequences';
import { resolveFixedSize } from '../utils/fixedTerminalSize';
import { logError } from '../utils/logger';
import i18n from '../i18n';
import type {
  ProtocolId,
  SessionRecordStatus,
  SshConnectionConfig,
  TelnetConnectionConfig,
  SerialConnectionConfig,
  WslConnectionConfig,
  LocalConnectionConfig,
} from '../types/appTypes';

export type AnyConfig =
  | SshConnectionConfig
  | TelnetConnectionConfig
  | SerialConnectionConfig
  | WslConnectionConfig
  | LocalConnectionConfig;

// Server-side DECAWM overrides we strip from terminal output so OUR wrap state
// stays authoritative. Hoisted to module scope, and paired with a literal
// `includes` probe below, because the `session-data` handler runs for every
// chunk of terminal output: building two RegExp objects and allocating a full
// copy of the chunk per event — even when there is nothing to strip, which is
// almost always — was pure overhead on the hottest path in the app.
// eslint-disable-next-line no-control-regex
const DECAWM_DISABLE_RE = /\x1b\[\?7l/g;
// eslint-disable-next-line no-control-regex
const DECAWM_ENABLE_RE = /\x1b\[\?7h/g;
const DECAWM_DISABLE = '\x1b[?7l';
const DECAWM_ENABLE = '\x1b[?7h';

/** DEL (0x7f) → BS (0x08) for terminals that expect backspace to send BS. */
const DEL_RE = /\x7f/g;
const DEL = '\x7f';

/** Quiet period after the last selection change before copy-on-select writes
 *  the clipboard. Long enough to collapse a drag into one write, short enough
 *  that the selection is on the clipboard before the user can paste it. */
const SELECTION_COPY_DEBOUNCE_MS = 120;

export interface SessionRecord {
  id: string;
  displayName: string;
  protocol: ProtocolId;
  status: SessionRecordStatus;
  errorMessage?: string;
  term: Terminal;
  fitAddon: FitAddon;
  connectionConfig?: AnyConfig;
  /** Width/height the backend baked into the initial pty-req / NAWS, reported
   *  once per connect via `session-pty-size`. A fixed-size session pins its grid
   *  to `ptyCols`. Undefined until the event arrives. */
  ptyCols?: number;
  ptyRows?: number;
  /** Whether the remote is a device family known to latch its width (from the
   *  same event as ptyCols). Feeds the global 'auto' mode. */
  deviceLatchesWidth?: boolean;
  /** EFFECTIVE "pin the grid to the connect-time width" flag — see
   *  `resolveFixedSize`. Recomputed when the pty-size event lands (that is when
   *  auto-detection becomes known) and when toggled from the tab menu. */
  fixedSize: boolean;
  /** Explicit per-connection choice, if any (`undefined` = follow the global
   *  mode / auto-detection). Set from the connection config at open and by the
   *  tab context-menu toggle, and it always wins over auto-detection. */
  fixedSizeOverride?: boolean;
  /** Host-tree node id this session was opened from, if any — lets a live toggle
   *  persist `fixedTerminalSize` back onto the originating host entry. */
  hostNodeId?: string;
}

export interface OpenRequest {
  displayName: string;
  protocol: ProtocolId;
  config: AnyConfig;
  /** Host-tree node id, when opened from the Host Tree (see SessionRecord). */
  hostNodeId?: string;
}

/**
 * Attach a terminal to a session that ALREADY exists in the backend but has no
 * xterm in this window — an AI worker session being "materialized" into a real
 * tab. Unlike OpenRequest nothing is connected: the record is created in the
 * given status and later status/data events flow into it like any other tab.
 */
export interface AdoptRequest {
  id: string;
  displayName: string;
  protocol: ProtocolId;
  /** Secret-free connection config (host/port/username) so the binding key and
   *  "Save to Host Tree" keep working. */
  config?: AnyConfig;
  status: SessionRecordStatus;
  errorMessage?: string;
  /** Captured output to replay into the new terminal as history (ANSI already
   *  stripped by the watch buffer; LF is normalized to CRLF). */
  initialText?: string;
}

function makeSessionId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Write the DECAWM (+reverse-wraparound) enable/disable sequence to a terminal. */
function applyWrapSequence(term: Terminal, wrap: boolean): void {
  term.write(
    wrap ? TERMINAL_SEQUENCES.LINE_WRAP_ENABLED : TERMINAL_SEQUENCES.LINE_WRAP_DISABLED
  );
}

export interface TerminalKeyHooks {
  getSelection(): string;
  clearSelection(): void;
}

export function handleTerminalKey(
  e: KeyboardEvent,
  term: TerminalKeyHooks,
  onPaste: () => void
): boolean {
  if (e.type !== 'keydown') return true;
  if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return true;
  const k = e.key.toLowerCase();
  if (k === 'v') {
    onPaste();
    return false;
  }
  if (k === 'c' && term.getSelection()) {
    term.clearSelection();
    return false;
  }
  return true;
}

// Delay before a connection-failure tab is auto-removed. Brief enough to feel
// responsive, long enough that the user notices the tab flash to the
// connecting-failure color before it disappears.
export const CONNECT_FAILURE_AUTO_CLOSE_MS = 1500;

// Delay before a tab is auto-removed after the session ends (clean exit, remote
// close, mid-session error). Lets the user see any final output ("logout",
// "Connection closed.") before the tab disappears.
export const SESSION_END_AUTO_CLOSE_MS = 1500;

interface UseSessionManagerOptions {
  onPasteRequest?: (sessionId: string) => void;
  onSessionRemoved?: (sessionId: string) => void;
}

export function useSessionManager(options: UseSessionManagerOptions = {}) {
  const onPasteRequestRef = useRef(options.onPasteRequest);
  const onSessionRemovedRef = useRef(options.onSessionRemoved);
  useEffect(() => {
    onPasteRequestRef.current = options.onPasteRequest;
    onSessionRemovedRef.current = options.onSessionRemoved;
  });

  const [sessions, setSessions] = useState<Map<string, SessionRecord>>(
    () => new Map()
  );
  const sessionsRef = useRef(sessions);

  // Subscribe ONLY to the settings whose change must re-run an effect below.
  // `App` composes this hook, so subscribing to the whole store made every
  // settings write — a font tweak, an AI provider switch — re-render the
  // entire app. Everything else this hook reads is read at call time from
  // `useSettingsStore.getState()`, which needs no subscription at all.
  const loggingEnabled = useSettingsStore((s) => s.loggingEnabled);
  const loggingPath = useSettingsStore((s) => s.loggingPath);
  const lineWrapEnabled = useSettingsStore((s) => s.lineWrapEnabled);

  useEffect(() => {
    sessionsRef.current = sessions;
  });

  // Pending auto-close timers for sessions that failed during initial connect.
  // Keyed by sessionId so duplicate failure paths (catch + onSessionError event)
  // don't schedule two timers for the same id.
  const autoCloseTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Sync logging settings changes to the backend for active sessions.
  //
  // Only fire when the user actually toggles or edits the setting — not on
  // initial mount (where the values come from persisted settings) and not
  // on StrictMode's double effect-invocation. Without this guard the
  // confirm-log-dir dialog would pop up on every app launch.
  const prevLoggingRef = useRef<{ enabled: boolean; path: string } | null>(null);
  useEffect(() => {
    const current = { enabled: loggingEnabled, path: loggingPath };
    const prev = prevLoggingRef.current;
    prevLoggingRef.current = current;
    if (
      prev === null ||
      (prev.enabled === current.enabled && prev.path === current.path)
    ) {
      return;
    }
    (async () => {
      // If logging is being enabled or pointed at a new path, ensure the
      // path is user-approved via a native dialog before propagating the
      // change. Approval is required because `start_logging` rejects
      // unapproved paths on the backend. Approvals are persisted, so this
      // dialog only appears the first time a folder is used.
      let approved = loggingEnabled && !!loggingPath;
      if (approved) {
        try {
          approved = await tauriService.confirmLogDir(loggingPath);
        } catch {
          approved = false;
        }
      }
      try {
        await tauriService.updateSessionLogging(
          approved,
          approved ? loggingPath : '',
        );
      } catch (err) {
        logError('Logging', i18n.t('notifications.errors.sessionLoggingUpdate'), err);
      }
    })();
  }, [loggingEnabled, loggingPath]);

  // Apply Line Wrap setting to all terminals when it changes. Fixed-size sessions
  // stay wrap-ON regardless — their pinned grid must keep wrapping at the device's
  // latched width, so the global toggle doesn't disable wrap for them.
  useEffect(() => {
    for (const rec of sessionsRef.current.values()) {
      const sequence = lineWrapEnabled || rec.fixedSize
        ? TERMINAL_SEQUENCES.LINE_WRAP_ENABLED
        : TERMINAL_SEQUENCES.LINE_WRAP_DISABLED;
      rec.term.write(sequence);
    }
  }, [lineWrapEnabled]);

  // Drop a session record (terminal disposal, map removal) and notify the host
  // app via onSessionRemoved so layout/pane state can be cleaned up.
  const finalizeRemoval = useCallback((id: string) => {
    setSessions((prev) => {
      const next = new Map(prev);
      const rec = next.get(id);
      if (rec) {
        rec.term.dispose();
        next.delete(id);
      }
      return next;
    });
    onSessionRemovedRef.current?.(id);
  }, []);

  // Schedule auto-close for a session — used both for connection-phase failures
  // and for normal/error session end. Idempotent: calling twice for the same id
  // (e.g. duplicate failure paths or repeated `disconnected` events) does not
  // stack timers.
  const scheduleAutoClose = useCallback(
    (id: string, delayMs: number) => {
      if (autoCloseTimersRef.current.has(id)) return;
      const timer = setTimeout(() => {
        autoCloseTimersRef.current.delete(id);
        // Best-effort backend cleanup; if the session already ended on the
        // backend (clean exit, remote close) this becomes a no-op.
        tauriService.disconnectSession(id).catch(() => { /* ignore */ });
        finalizeRemoval(id);
      }, delayMs);
      autoCloseTimersRef.current.set(id, timer);
    },
    [finalizeRemoval]
  );

  // Global event subscriptions — one set for the whole app.
  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    const track = (p: Promise<() => void>) => {
      p.then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisteners.push(fn);
        }
      }).catch((e) => {
        logError('Session', i18n.t('notifications.errors.sessionListener'), e);
      });
    };

    track(
      tauriService.onSessionData(({ sessionId, data }) => {
        const rec = sessionsRef.current.get(sessionId);
        if (!rec) return;
        // Strip server DECAWM overrides so our effective wrap state is authoritative.
        // A fixed-size session is always wrap-ON (its grid is pinned and must wrap
        // at the device's latched width), regardless of the global setting.
        // The `includes` probe keeps the common no-override chunk allocation-free;
        // `replace` copies the whole string even when it matches nothing.
        const wrap = useSettingsStore.getState().lineWrapEnabled || rec.fixedSize;
        const unwanted = wrap ? DECAWM_DISABLE : DECAWM_ENABLE;
        const filtered = data.includes(unwanted)
          ? data.replace(wrap ? DECAWM_DISABLE_RE : DECAWM_ENABLE_RE, '')
          : data;
        rec.term.write(filtered);
      })
    );

    track(
      tauriService.onSessionStatus(({ sessionId, status }) => {
        const prev = sessionsRef.current.get(sessionId);
        setSessions((p) => {
          const next = new Map(p);
          const rec = next.get(sessionId);
          if (rec) next.set(sessionId, { ...rec, status });
          return next;
        });
        // Auto-close on session end (exit, remote close, mid-session error).
        // The 'connecting' → 'disconnected' case is owned by the connect-failure
        // path triggered from onSessionError, so skip it here.
        if (
          status === 'disconnected' &&
          prev &&
          (prev.status === 'connected' || prev.status === 'error')
        ) {
          scheduleAutoClose(sessionId, SESSION_END_AUTO_CLOSE_MS);
        }
      })
    );

    track(
      // The size actually baked into the initial pty-req / NAWS, plus whether the
      // remote fingerprints as a width-latching device. This is the point where
      // auto-detection becomes known, so re-resolve the effective pin flag here
      // (an explicit per-connection/tab override still wins).
      tauriService.onSessionPtySize(({ sessionId, cols, rows, deviceLatchesWidth }) => {
        const rec = sessionsRef.current.get(sessionId);
        if (!rec) return;
        const fixedSize = resolveFixedSize(
          rec.fixedSizeOverride,
          useSettingsStore.getState().fixedTerminalSizeMode,
          deviceLatchesWidth
        );
        // Auto-detection may have just turned pinning on; a pinned grid must be
        // wrap-ON so it wraps at the device's latched width.
        if (fixedSize !== rec.fixedSize) {
          applyWrapSequence(rec.term, fixedSize || useSettingsStore.getState().lineWrapEnabled);
        }
        setSessions((p) => {
          const next = new Map(p);
          const r = next.get(sessionId);
          if (r) {
            next.set(sessionId, {
              ...r,
              ptyCols: cols,
              ptyRows: rows,
              deviceLatchesWidth,
              fixedSize,
            });
          }
          return next;
        });
      })
    );

    track(
      tauriService.onSessionError(({ sessionId, error }) => {
        const rec = sessionsRef.current.get(sessionId);
        if (!rec) return;
        // First-error wins: if the connect-promise catch already transitioned
        // this session to 'error', skip the redundant state update + log.
        if (rec.status === 'error') return;
        // Read displayName before scheduling the state update, since the
        // updater runs asynchronously.
        const displayName = rec.displayName;
        const wasConnecting = rec.status === 'connecting';
        setSessions((prev) => {
          const next = new Map(prev);
          const r = next.get(sessionId);
          if (r) {
            next.set(sessionId, {
              ...r,
              status: 'error',
              errorMessage: error,
            });
          }
          return next;
        });
        logError('Session', displayName ? `${displayName}: ${error}` : error);
        if (wasConnecting) {
          scheduleAutoClose(sessionId, CONNECT_FAILURE_AUTO_CLOSE_MS);
        }
      })
    );

    // Surface known_hosts save failures (accepted host key couldn't be
    // persisted). Without this the key is silently forgotten and the user is
    // re-prompted next connect with no explanation. The backend message is
    // already human-readable English, so display it as-is via the toast store.
    track(
      tauriService.onSshKnownHostsWarning((message) => {
        logError('SSH', message);
      })
    );

    return () => {
      cancelled = true;
      for (const u of unlisteners) u();
    };
  }, [scheduleAutoClose]);

  // Cancel any pending auto-close timers on unmount.
  useEffect(() => {
    const timers = autoCloseTimersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  // Construct the xterm instance (+ fit addon) for a session id, wired for
  // copy-on-select, paste interception and keystroke forwarding. Shared by
  // openSession (fresh connect) and adoptSession (attach to a live backend
  // session that had no terminal yet — an AI worker being materialized).
  const createTerminal = useCallback(
    (id: string, fixedSize: boolean): { term: Terminal; fitAddon: FitAddon } => {
      const s = useSettingsStore.getState();
      const term = new Terminal({
        fontFamily: s.fontFamily,
        fontSize: s.fontSize,
        scrollback: s.scrollback,
        cursorBlink: true,
        rightClickSelectsWord: false,
        allowProposedApi: true,
        theme: {
          foreground: s.terminalForeground,
          background: s.terminalBackground,
        },
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      // Apply initial line wrap state (fixed-size sessions are always wrap-ON)
      applyWrapSequence(term, s.lineWrapEnabled || fixedSize);

      // Copy-on-select. The event fires on every mouse-move of a drag, so a
      // single selection used to issue dozens of clipboard IPC round trips;
      // debouncing collapses a drag into one write of the final selection.
      let selectionCopyTimer: ReturnType<typeof setTimeout> | undefined;
      term.onSelectionChange(() => {
        if (selectionCopyTimer !== undefined) clearTimeout(selectionCopyTimer);
        selectionCopyTimer = setTimeout(() => {
          selectionCopyTimer = undefined;
          // The session may have been closed while the timer was pending.
          if (!sessionsRef.current.has(id)) return;
          const sel = term.getSelection();
          if (sel) {
            tauriService.writeClipboard(sel).catch((err) => {
              // Surface clipboard failures: the user just selected text expecting
              // it to be copied; silent swallow leaves them confused on paste.
              logError('Clipboard', i18n.t('notifications.errors.clipboardCopy'), err);
            });
          }
        }, SELECTION_COPY_DEBOUNCE_MS);
      });

      term.attachCustomKeyEventHandler((e) =>
        handleTerminalKey(e, term, () => onPasteRequestRef.current?.(id))
      );

      term.onData((data) => {
        const converted =
          useSettingsStore.getState().backspaceSendsDel || !data.includes(DEL)
            ? data
            : data.replace(DEL_RE, '\x08');
        // Deliberately one invoke per keystroke: batching input would add
        // latency to the one interaction where it is most felt.
        tauriService.sendInput(id, converted).catch(() => {
          /* swallow — surfaced via session-error */
        });
      });
      return { term, fitAddon };
    },
    []
  );

  const openSession = useCallback(
    (req: OpenRequest): string => {
      const id = makeSessionId();
      const s = useSettingsStore.getState();
      // Provisional pin flag. Auto-detection isn't known until the connect-time
      // pty-size event, which is also the only thing that can start a pin (it
      // carries ptyCols) — so resolving without it here is safe, and the event
      // handler recomputes. A fixed-size session is always wrap-ON.
      const fixedSizeOverride = (req.config as { fixedTerminalSize?: boolean })
        .fixedTerminalSize;
      const fixedSize = resolveFixedSize(fixedSizeOverride, s.fixedTerminalSizeMode, undefined);
      const { term, fitAddon } = createTerminal(id, fixedSize);

      // Fallback display name: if the caller passed an empty/whitespace-only
      // string, the tab strip would render a blank label which is unfriendly.
      // Derive something readable from the protocol so the tab is always
      // identifiable.
      const displayName = (req.displayName ?? '').trim() || i18n.t('sessionDialog.defaultSessionName', { protocol: req.protocol });
      const rec: SessionRecord = {
        id,
        displayName,
        protocol: req.protocol,
        status: 'connecting',
        term,
        fitAddon,
        connectionConfig: req.config,
        fixedSize,
        fixedSizeOverride,
        hostNodeId: req.hostNodeId,
      };
      setSessions((prev) => {
        const next = new Map(prev);
        next.set(id, rec);
        return next;
      });

      // Pre-flight: if logging is enabled, prompt the user via a native
      // dialog to approve the log folder. The backend rejects logging to
      // unapproved folders, so this is the only way a typed (non-Browse)
      // path can take effect — and the dialog is what gives a compromised
      // renderer no way to silently grow the approval set.
      const ensureLoggingApproved = async (): Promise<boolean> => {
        if (!s.loggingEnabled || !s.loggingPath) return false;
        try {
          return await tauriService.confirmLogDir(s.loggingPath);
        } catch {
          return false;
        }
      };

      // Fire-and-forget: caller gets the id immediately so the tab can render
      // in the connecting state. Success transitions to 'connected' via the
      // onSessionStatus listener; failure is handled here and (redundantly via
      // onSessionError) by surfacing a toast and scheduling the auto-close.
      ensureLoggingApproved()
        .then((approved) =>
          tauriService.connectSession(
            id,
            req.protocol,
            req.config,
            approved,
            approved ? s.loggingPath : '',
          ),
        )
        .catch((e) => {
          const errStr = String(e);
          const current = sessionsRef.current.get(id);
          if (!current) {
            // Already cleaned up (manual close, etc.) — nothing to do.
            return;
          }
          // First-error wins: if onSessionError already handled this, skip.
          if (current.status === 'error') return;
          const wasConnecting = current.status === 'connecting';
          setSessions((prev) => {
            const next = new Map(prev);
            const r = next.get(id);
            if (r) {
              next.set(id, {
                ...r,
                status: 'error',
                errorMessage: errStr,
              });
            }
            return next;
          });
          logError('Session', `${req.displayName}: ${errStr}`);
          if (wasConnecting) {
            scheduleAutoClose(id, CONNECT_FAILURE_AUTO_CLOSE_MS);
          }
        });

      return id;
    },
    [scheduleAutoClose, createTerminal]
  );

  // Materialize a backend session that has no terminal in this window (an AI
  // worker session) into a normal tab record. No connect happens — the backend
  // session is already live — so this is synchronous and cannot fail. The
  // caller allocates the pane (usePaneStore.addSession) exactly as after
  // openSession. From here on, status/data/error events reach the record
  // through the global listeners like any other tab.
  const adoptSession = useCallback(
    (req: AdoptRequest): void => {
      if (sessionsRef.current.has(req.id)) return;
      const s = useSettingsStore.getState();
      const fixedSize = resolveFixedSize(undefined, s.fixedTerminalSizeMode, undefined);
      const { term, fitAddon } = createTerminal(req.id, fixedSize);
      if (req.initialText) {
        // The watch buffer is ANSI-stripped plain text with bare LF line ends;
        // xterm needs CRLF or every line would start where the previous ended.
        term.write(req.initialText.replace(/\r?\n/g, '\r\n'));
      }
      const displayName = (req.displayName ?? '').trim() || i18n.t('sessionDialog.defaultSessionName', { protocol: req.protocol });
      const rec: SessionRecord = {
        id: req.id,
        displayName,
        protocol: req.protocol,
        status: req.status,
        errorMessage: req.errorMessage,
        term,
        fitAddon,
        connectionConfig: req.config,
        fixedSize,
      };
      setSessions((prev) => {
        const next = new Map(prev);
        next.set(req.id, rec);
        return next;
      });
    },
    [createTerminal]
  );

  const closeSession = useCallback(async (id: string) => {
    // Cancel any pending auto-close so it doesn't fire after manual close.
    const pending = autoCloseTimersRef.current.get(id);
    if (pending) {
      clearTimeout(pending);
      autoCloseTimersRef.current.delete(id);
    }
    try {
      await tauriService.disconnectSession(id);
    } catch {
      /* ignore — treat as disconnected anyway */
    }
    // Manual close intentionally does not invoke onSessionRemoved — the
    // caller (App.tsx) drives its own pane/store cleanup explicitly. Only
    // the auto-close path (finalizeRemoval) notifies the host. xterm.dispose
    // is idempotent, so the rare race with an in-flight auto-close that
    // disposes first is harmless.
    setSessions((prev) => {
      const next = new Map(prev);
      const rec = next.get(id);
      if (rec) rec.term.dispose();
      next.delete(id);
      return next;
    });
  }, []);

  const getSession = useCallback(
    (id: string | null): SessionRecord | undefined =>
      id ? sessionsRef.current.get(id) : undefined,
    []
  );

  // Toggle a live session's fixed-size pinning (from the tab context menu).
  // Flips `fixedSize`, mirrors it into `connectionConfig` (so a later Save to
  // Host Tree captures it), and re-asserts DECAWM: pinning forces wrap-ON; when
  // unpinning, the effective wrap reverts to the global setting.
  const setSessionFixedSize = useCallback((id: string, on: boolean) => {
    const rec = sessionsRef.current.get(id);
    if (rec) {
      applyWrapSequence(rec.term, on || useSettingsStore.getState().lineWrapEnabled);
    }
    setSessions((prev) => {
      const next = new Map(prev);
      const r = next.get(id);
      if (!r) return prev;
      const connectionConfig = r.connectionConfig
        ? { ...r.connectionConfig, fixedTerminalSize: on }
        : r.connectionConfig;
      // Record it as an explicit override so auto-detection can't undo the
      // user's choice for the rest of this session.
      next.set(id, { ...r, fixedSize: on, fixedSizeOverride: on, connectionConfig });
      return next;
    });
  }, []);

  return { sessions, openSession, adoptSession, closeSession, getSession, setSessionFixedSize };
}
