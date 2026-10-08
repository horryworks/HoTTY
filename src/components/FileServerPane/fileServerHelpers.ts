// Pure helpers for the File Server pane, kept out of the component so they can
// be unit-tested and the component module exports only a component.

import type { FileServerProtocol, LocalAddress } from '../../types/appTypes';

/**
 * The address a device should use to reach the server. A specific bind address
 * is the only one that works; on 0.0.0.0 it is the one the user picked, else
 * the first (the one on the default route).
 */
export function reachableAddress(bindAddr: string, addresses: readonly LocalAddress[], picked: string | null): string | null {
  const bind = bindAddr.trim();
  if (bind && bind !== '0.0.0.0') return bind;
  if (picked && addresses.some((a) => a.address === picked)) return picked;
  return addresses[0]?.address ?? null;
}

/** What to type on the device: the TFTP URL of the folder, or the SFTP command line. */
export function deviceCommand(protocol: FileServerProtocol, address: string, port: number, username: string): string {
  if (protocol === 'tftp') {
    return port === 69 ? `tftp://${address}/` : `tftp://${address}:${port}/`;
  }
  const user = username.trim() || 'user';
  return port === 22 ? `sftp ${user}@${address}` : `sftp -P ${port} ${user}@${address}`;
}
