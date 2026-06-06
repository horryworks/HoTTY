import { describe, it, expect } from 'vitest';
import { sessionBindingKey } from './sessionBindingKey';

describe('sessionBindingKey', () => {
  it('derives a stable key from SSH host/port/user (independent of session id)', () => {
    const a = sessionBindingKey({
      protocol: 'ssh',
      displayName: 'router-A',
      connectionConfig: { host: '10.0.0.1', port: 22, username: 'admin' },
    });
    const b = sessionBindingKey({
      protocol: 'ssh',
      displayName: 'router-A (reconnected)',
      connectionConfig: { host: '10.0.0.1', port: 22, username: 'admin' },
    });
    expect(a).toBe('ssh:admin@10.0.0.1:22');
    // Same target → same key even though displayName differs (survives reconnect).
    expect(a).toBe(b);
  });

  it('distinguishes different hosts / users / ports', () => {
    const base = { host: '10.0.0.1', port: 22, username: 'admin' };
    const k = sessionBindingKey({ protocol: 'ssh', displayName: 'x', connectionConfig: base });
    expect(k).not.toBe(sessionBindingKey({ protocol: 'ssh', displayName: 'x', connectionConfig: { ...base, host: '10.0.0.2' } }));
    expect(k).not.toBe(sessionBindingKey({ protocol: 'ssh', displayName: 'x', connectionConfig: { ...base, port: 2222 } }));
    expect(k).not.toBe(sessionBindingKey({ protocol: 'ssh', displayName: 'x', connectionConfig: { ...base, username: 'root' } }));
  });

  it('handles telnet, serial, wsl, and local protocols', () => {
    expect(sessionBindingKey({ protocol: 'telnet', displayName: 't', connectionConfig: { host: 'h', port: 23 } })).toBe('telnet:@h:23');
    expect(sessionBindingKey({ protocol: 'serial', displayName: 's', connectionConfig: { path: 'COM3' } })).toBe('serial:COM3');
    expect(sessionBindingKey({ protocol: 'wsl', displayName: 'w', connectionConfig: { distribution: 'Ubuntu' } })).toBe('wsl:Ubuntu');
    expect(sessionBindingKey({ protocol: 'powershell', displayName: 'p', connectionConfig: { shellType: 'powershell' } })).toBe('local:powershell:');
  });

  it('falls back to protocol:displayName when config is missing or malformed', () => {
    expect(sessionBindingKey({ protocol: 'ssh', displayName: 'router-A' })).toBe('ssh:router-A');
    expect(sessionBindingKey({ protocol: 'ssh', displayName: 'router-A', connectionConfig: {} })).toBe('ssh:router-A');
  });
});
