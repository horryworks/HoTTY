import { useCallback, useEffect, useRef, useState } from 'react';
import { tauriService } from '../services/tauriService';
import { logError } from '../utils/logger';
import type { FileServerProtocol } from '../types/appTypes';

const MAX_TRANSFERS = 200;

export type ServerRunState = 'running' | 'stopped';

export interface TransferLogEntry {
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
  const [tftpState, setTftpState] = useState<ServerRunState>('stopped');
  const [sftpState, setSftpState] = useState<ServerRunState>('stopped');
  const [transfers, setTransfers] = useState<TransferLogEntry[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const setup = async () => {
      unlisten = await tauriService.onFileServerEvent((ev) => {
        if (ev.serverId !== serverId) return;

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
          setLastError(ev.message ?? 'Unknown error');
        }
      });
    };

    setup().catch((e) => logError('FileServer', 'Failed to set up listeners', e));

    return () => {
      unlisten?.();
    };
  }, [serverId]);

  const clearTransfers = useCallback(() => setTransfers([]), []);

  return { tftpState, sftpState, transfers, lastError, clearTransfers };
}
