import { describe, it, expect } from 'vitest';
import { deviceCommand, reachableAddress } from './fileServerHelpers';

const addrs = [
  { name: 'Ethernet', address: '192.0.2.15' },
  { name: 'Wi-Fi', address: '198.51.100.7' },
];

describe('fileServerHelpers', () => {
  it('uses a specific bind address as the only reachable one', () => {
    expect(reachableAddress('203.0.113.4', addrs, '198.51.100.7')).toBe('203.0.113.4');
  });

  it('on 0.0.0.0 uses the picked address, else the first', () => {
    expect(reachableAddress('0.0.0.0', addrs, '198.51.100.7')).toBe('198.51.100.7');
    expect(reachableAddress('0.0.0.0', addrs, null)).toBe('192.0.2.15');
    expect(reachableAddress('', addrs, '203.0.113.9')).toBe('192.0.2.15');
    expect(reachableAddress('0.0.0.0', [], null)).toBeNull();
  });

  it('writes the TFTP URL, with the port only when it is not 69', () => {
    expect(deviceCommand('tftp', '192.0.2.15', 69, 'x')).toBe('tftp://192.0.2.15/');
    expect(deviceCommand('tftp', '192.0.2.15', 6969, 'x')).toBe('tftp://192.0.2.15:6969/');
  });

  it('writes the SFTP command line, with -P only when the port is not 22', () => {
    expect(deviceCommand('sftp', '192.0.2.15', 2222, 'hotty')).toBe('sftp -P 2222 hotty@192.0.2.15');
    expect(deviceCommand('sftp', '192.0.2.15', 22, 'hotty')).toBe('sftp hotty@192.0.2.15');
  });
});
