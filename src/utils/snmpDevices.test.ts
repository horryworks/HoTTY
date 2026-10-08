import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_SNMP_DEVICE, MAX_SAVED_DEVICES, importLegacySnmpTargets, removeDevice, upsertDevice } from './snmpDevices';

const dev = (host: string, port = 161) => ({ ...DEFAULT_SNMP_DEVICE, host, port });

describe('snmpDevices', () => {
  beforeEach(() => localStorage.clear());

  it('puts a device first and drops the older copy of the same host and port', () => {
    const list = upsertDevice([dev('192.0.2.1'), dev('192.0.2.2')], dev('192.0.2.2'));
    expect(list.map((d) => d.host)).toEqual(['192.0.2.2', '192.0.2.1']);
  });

  it('treats another port as another device', () => {
    expect(upsertDevice([dev('192.0.2.1')], dev('192.0.2.1', 1161))).toHaveLength(2);
  });

  it('keeps the list short', () => {
    let list = [dev('192.0.2.100')];
    for (let i = 0; i < 20; i++) list = upsertDevice(list, dev(`192.0.2.${i}`));
    expect(list).toHaveLength(MAX_SAVED_DEVICES);
  });

  it('removes a device', () => {
    expect(removeDevice([dev('192.0.2.1'), dev('192.0.2.2')], dev('192.0.2.1')).map((d) => d.host)).toEqual(['192.0.2.2']);
  });

  it('folds the old per-pane entries into one list and deletes them', () => {
    localStorage.setItem('hotty_snmp_target_if-a', JSON.stringify({ host: '192.0.2.1', port: 161, version: 'v2c', remember: true, community: '[SAFE]x' }));
    localStorage.setItem('hotty_snmp_target_if-b', JSON.stringify({ host: '192.0.2.1', port: 161, version: 'v2c', remember: false }));
    localStorage.setItem('hotty_snmp_target_if-c', JSON.stringify({ host: '192.0.2.2', port: 161, version: 'v2c', remember: false, community: '[SAFE]y' }));
    localStorage.setItem('hotty_snmp_target_if-d', 'not json');
    localStorage.setItem('hotty_other', 'kept');
    const list = importLegacySnmpTargets();
    expect(list.map((d) => d.host).sort()).toEqual(['192.0.2.1', '192.0.2.2']);
    // A secret kept while "remember" was off is not carried over.
    expect(list.find((d) => d.host === '192.0.2.2')?.community).toBeUndefined();
    expect(Object.keys(localStorage).filter((k) => k.startsWith('hotty_snmp_target_'))).toEqual([]);
    expect(localStorage.getItem('hotty_other')).toBe('kept');
  });
});
