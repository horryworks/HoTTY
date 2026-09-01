import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tauriService } from '../services/tauriService';
import { logError } from '../utils/logger';
import i18n from '../i18n';
import type { FileServerProtocol } from '../types/appTypes';

const MAX_TRANSFERS = 200;

type ServerRunState = 'running' | 'stopped';

interface TransferLogEntry {
  id: number;
  protocol: FileServerProtocol;
  client: string;
  filename: string;
  direction: 'download' | 'upload';
  bytes?: number;
  timestamp: number;
}

interface FileServerEventData {
  tftpState: ServerRunState;
  sftpState: ServerRunState;
  /** Most recent transfers first. */
  transfers: TransferLogEntry[];
  lastError: string | null;
  clearTransfers: () => void;
}

/**
 * Subscribes to backend `file-server-event`s for a given pane (`serverId`) and
 * exposes per-protocol run state plus a rolling transfer log.
 */
export function useFileServerEvents(serverId: string): FileServerEventData {
  const { t } = useTranslation();
  const [tftpState, setTftpState] = useState<ServerRunState>('stopped');
  const [sftpState, setSftpState] = useState<ServerRunState>('stopped');
  const [transfers, setTransfers] = useState<TransferLogEntry[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    const setup = async () => {
      const fn = await tauriService.onFileServerEvent((ev) => {
        if (cancelled || ev.serverId !== serverId) return;

        if (ev.kind === 'status') {
          const apply = ev.protocol === 'tftp' ? setTftpState : setSftpState;
          if (ev.status === 'running') apply('running');
          else if (ev.status === 'stopped') apply('stopped');
          // 'client-connected' is informational only.
        } else if (ev.kind === 'transfer') {
          setTransfers((prev) => {
            const entry: TransferLogEntry = {
              id: (seqRef.current += 1),
              protocol: ev.protocol,
              client: ev.client ?? '',
              filename: ev.filename ?? '',
              direction: ev.direction ?? 'download',
              bytes: ev.bytes,
              timestamp: ev.timestamp,
            };
            const next = [entry, ...prev];
            if (next.length > MAX_TRANSFERS) next.length = MAX_TRANSFERS;
            return next;
          });
        } else if (ev.kind === 'error') {
          setLastError(ev.message ?? t('panes.fileServer.unknownError'));
        }
      });
      // If the effect was torn down while this subscribe was in flight,
      // unlisten immediately instead of leaking the listener.
      if (cancelled) fn();
      else unlisten = fn;
    };

    setup().catch((e) => logError('FileServer', i18n.t('notifications.errors.fileServerListener'), e));

    return () => {
      cancelled = true;
      unlisten?.();
    };
    // `t` is included so the fallback resolves in the current language; its
    // identity only changes on a language switch, so re-subscribing then is fine.
  }, [serverId, t]);

  const clearTransfers = useCallback(() => setTransfers([]), []);

  return { tftpState, sftpState, transfers, lastError, clearTransfers };
}
