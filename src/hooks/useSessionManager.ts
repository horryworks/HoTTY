import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { tauriService } from '../services/tauriService';
import { useSettingsStore } from '../stores/settingsStore';
import { TERMINAL_SEQUENCES } from '../constants/terminalSequences';
import { logError } from '../utils/logger';
import type {
  ProtocolId,
  SessionRecordStatus,
  SshConnectionConfig,
  TelnetConnectionConfig,
  SerialConnectionConfig,
  WslConnectionConfig,
  LocalConnectionConfig,
} from '../types/appTypes';

export interface SessionRecord {
  id: string;
  displayName: string;
  protocol: ProtocolId;
  status: SessionRecordStatus;
  errorMessage?: string;
  term: Terminal;
  fitAddon: FitAddon;
}

type AnyConfig =
  | SshConnectionConfig
  | TelnetConnectionConfig
  | SerialConnectionConfig
  | WslConnectionConfig
  | LocalConnectionConfig;

export interface OpenRequest {
  displayName: string;
  protocol: ProtocolId;
  config: AnyConfig;
}

function makeSessionId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

  const settings = useSettingsStore();
  const settingsRef = useRef(settings);

  useEffect(() => {
    sessionsRef.current = sessions;
    settingsRef.current = settings;
  });

  // Pending auto-close timers for sessions that failed during initial connect.
  // Keyed by sessionId so duplicate failure paths (catch + onSessionError event)
  // don't schedule two timers for the same id.
  const autoCloseTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Sync logging settings changes to the backend for active sessions.
  const loggingEnabled = settings.loggingEnabled;
  const loggingPath = settings.loggingPath;
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    tauriService.updateSessionLogging(loggingEnabled, loggingPath).catch((err) => {
      // Surface so users notice when their logging-toggle silently fails to
      // take effect (e.g. log dir not writable).
      logError('Logging', 'failed to update session logging', err);
    });
  }, [loggingEnabled, loggingPath]);

  // Apply Line Wrap setting to all terminals when it changes
  const lineWrapEnabled = settings.lineWrapEnabled;
  useEffect(() => {
    const sequence = lineWrapEnabled
      ? TERMINAL_SEQUENCES.LINE_WRAP_ENABLED
      : TERMINAL_SEQUENCES.LINE_WRAP_DISABLED;
    for (const rec of sessionsRef.current.values()) {
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
        logError('Session', 'Failed to set up session event listener', e);
      });
    };

    track(
      tauriService.onSessionData(({ sessionId, data }) => {
        const rec = sessionsRef.current.get(sessionId);
        if (!rec) return;
        // Strip server DECAWM overrides so our lineWrapEnabled setting is authoritative
        const wrap = settingsRef.current.lineWrapEnabled;
        // eslint-disable-next-line no-control-regex
        const disableWrap = /\x1b\[\?7l/g;
        // eslint-disable-next-line no-control-regex
        const enableWrap = /\x1b\[\?7h/g;
        const filtered = wrap
          ? data.replace(disableWrap, '')   // remove disable when wrap is ON
          : data.replace(enableWrap, '');   // remove enable when wrap is OFF
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

  const openSession = useCallback(
    (req: OpenRequest): string => {
      const id = makeSessionId();
      const s = settingsRef.current;
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

      // Apply initial line wrap state
      term.write(s.lineWrapEnabled ? TERMINAL_SEQUENCES.LINE_WRAP_ENABLED : TERMINAL_SEQUENCES.LINE_WRAP_DISABLED);

      term.onSelectionChange(() => {
        const sel = term.getSelection();
        if (sel) {
          tauriService.writeClipboard(sel).catch((err) => {
            // Surface clipboard failures: the user just selected text expecting
            // it to be copied; silent swallow leaves them confused on paste.
            logError('Clipboard', 'failed to copy selection', err);
          });
        }
      });

      term.attachCustomKeyEventHandler((e) =>
        handleTerminalKey(e, term, () => onPasteRequestRef.current?.(id))
      );

      term.onData((data) => {
        const converted = settingsRef.current.backspaceSendsDel
          ? data
          : data.replace(/\x7f/g, '\x08');
        tauriService.sendInput(id, converted).catch(() => {
          /* swallow — surfaced via session-error */
        });
      });

      const rec: SessionRecord = {
        id,
        displayName: req.displayName,
        protocol: req.protocol,
        status: 'connecting',
        term,
        fitAddon,
      };
      setSessions((prev) => {
        const next = new Map(prev);
        next.set(id, rec);
        return next;
      });

      // Fire-and-forget: caller gets the id immediately so the tab can render
      // in the connecting state. Success transitions to 'connected' via the
      // onSessionStatus listener; failure is handled here and (redundantly via
      // onSessionError) by surfacing a toast and scheduling the auto-close.
      tauriService
        .connectSession(
          id,
          req.protocol,
          req.config,
          s.loggingEnabled,
          s.loggingPath,
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
    [scheduleAutoClose]
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

  return { sessions, openSession, closeSession, getSession };
}
