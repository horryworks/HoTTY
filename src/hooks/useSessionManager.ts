import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { tauriService } from '../services/tauriService';
import { useSettingsStore } from '../stores/settingsStore';
import type {
  ProtocolId,
  SessionStatus,
  SshConnectionConfig,
  TelnetConnectionConfig,
} from '../types/appTypes';

export interface SessionRecord {
  id: string;
  displayName: string;
  protocol: ProtocolId;
  status: SessionStatus | 'connecting' | 'error';
  errorMessage?: string;
  term: Terminal;
  fitAddon: FitAddon;
}

type AnyConfig = SshConnectionConfig | TelnetConnectionConfig;

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

export interface UseSessionManagerOptions {
  onPasteRequest?: (sessionId: string) => void;
}

export function useSessionManager(options: UseSessionManagerOptions = {}) {
  const onPasteRequestRef = useRef(options.onPasteRequest);
  onPasteRequestRef.current = options.onPasteRequest;

  const [sessions, setSessions] = useState<Map<string, SessionRecord>>(
    () => new Map()
  );
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  const settings = useSettingsStore();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

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
      });
    };

    track(
      tauriService.onSessionData(({ sessionId, data }) => {
        const rec = sessionsRef.current.get(sessionId);
        if (rec) rec.term.write(data);
      })
    );

    track(
      tauriService.onSessionStatus(({ sessionId, status }) => {
        setSessions((prev) => {
          const next = new Map(prev);
          const rec = next.get(sessionId);
          if (rec) next.set(sessionId, { ...rec, status });
          return next;
        });
      })
    );

    track(
      tauriService.onSessionError(({ sessionId, error }) => {
        setSessions((prev) => {
          const next = new Map(prev);
          const rec = next.get(sessionId);
          if (rec) {
            next.set(sessionId, {
              ...rec,
              status: 'error',
              errorMessage: error,
            });
            rec.term.write(`\r\n\x1b[31m[error] ${error}\x1b[0m\r\n`);
          }
          return next;
        });
      })
    );

    return () => {
      cancelled = true;
      for (const u of unlisteners) u();
    };
  }, []);

  const openSession = useCallback(
    async (req: OpenRequest): Promise<string> => {
      const id = makeSessionId();
      const s = settingsRef.current;
      const term = new Terminal({
        fontFamily: s.fontFamily,
        fontSize: s.fontSize,
        scrollback: s.scrollback,
        cursorBlink: true,
        rightClickSelectsWord: false,
        theme: {
          foreground: s.terminalForeground,
          background: s.terminalBackground,
        },
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      term.onSelectionChange(() => {
        const sel = term.getSelection();
        if (sel) {
          tauriService.writeClipboard(sel).catch(() => {
            /* clipboard errors are non-fatal */
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

      try {
        await tauriService.connectSession(id, req.protocol, req.config);
      } catch (e) {
        setSessions((prev) => {
          const next = new Map(prev);
          const r = next.get(id);
          if (r)
            next.set(id, {
              ...r,
              status: 'error',
              errorMessage: String(e),
            });
          return next;
        });
      }
      return id;
    },
    []
  );

  const closeSession = useCallback(async (id: string) => {
    try {
      await tauriService.disconnectSession(id);
    } catch {
      /* ignore — treat as disconnected anyway */
    }
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
