import { STORAGE_KEYS } from '../constants/storage';
import type { SnmpSavedDevice } from '../types/appTypes';

/** How many devices the Interface Traffic pane keeps on its "used before" row. */
export const MAX_SAVED_DEVICES = 8;

export const DEFAULT_SNMP_INTERVAL_MS = 10000;

export const DEFAULT_SNMP_DEVICE: SnmpSavedDevice = {
  host: '',
  port: 161,
  version: 'v2c',
  username: '',
  securityLevel: 'authPriv',
  authProtocol: 'sha256',
  privProtocol: 'aes128',
  contextName: '',
  intervalMs: DEFAULT_SNMP_INTERVAL_MS,
  remember: false,
};

/** One device per host and port. */
export function deviceKey(d: Pick<SnmpSavedDevice, 'host' | 'port'>): string {
  return `${d.host.trim().toLowerCase()}:${d.port}`;
}

/** Put `device` first, drop any older entry for the same host and port, keep the list short. */
export function upsertDevice(list: readonly SnmpSavedDevice[], device: SnmpSavedDevice): SnmpSavedDevice[] {
  const key = deviceKey(device);
  return [device, ...list.filter((d) => deviceKey(d) !== key)].slice(0, MAX_SAVED_DEVICES);
}

export function removeDevice(list: readonly SnmpSavedDevice[], device: Pick<SnmpSavedDevice, 'host' | 'port'>): SnmpSavedDevice[] {
  const key = deviceKey(device);
  return list.filter((d) => deviceKey(d) !== key);
}

/**
 * Read the old per-pane entries (`hotty_snmp_target_<paneId>`) into one device
 * list and delete them. A pane id is new every time, so those entries could
 * never be read back; this is the only chance to keep what they hold.
 */
export function importLegacySnmpTargets(storage: Storage = localStorage): SnmpSavedDevice[] {
  const prefix = STORAGE_KEYS.LEGACY_SNMP_TARGET_PREFIX;
  let devices: SnmpSavedDevice[] = [];
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k?.startsWith(prefix)) keys.push(k);
    }
    for (const k of keys) {
      try {
        const raw = storage.getItem(k);
        const parsed = raw ? (JSON.parse(raw) as Partial<SnmpSavedDevice>) : null;
        if (parsed && typeof parsed.host === 'string' && parsed.host.trim()) {
          const device: SnmpSavedDevice = { ...DEFAULT_SNMP_DEVICE, ...parsed, host: parsed.host.trim() };
          if (!device.remember) {
            delete device.community;
            delete device.authPassword;
            delete device.privPassword;
          }
          if (!devices.some((d) => deviceKey(d) === deviceKey(device))) {
            devices = [...devices, device].slice(0, MAX_SAVED_DEVICES);
          }
        }
      } catch {
        // A damaged entry is dropped with the rest.
      }
      storage.removeItem(k);
    }
  } catch {
    // Storage unavailable: start with an empty list.
  }
  return devices;
}
