import { describe, it, expect } from 'vitest';
import { buildHostEntryFromConfig } from './buildHostEntry';
import type {
  SshConnectionConfig,
  TelnetConnectionConfig,
} from '../../types/appTypes';

const sshConfig = (overrides: Partial<SshConnectionConfig> = {}): SshConnectionConfig => ({
  host: 'example.com',
  port: 22,
  username: 'alice',
  encoding: 'utf8',
  keepaliveIntervalSecs: 30,
  connectTimeoutSecs: 10,
  ...overrides,
});

const telnetConfig = (overrides: Partial<TelnetConnectionConfig> = {}): TelnetConnectionConfig => ({
  host: 'example.com',
  port: 23,
  encoding: 'utf8',
  keepaliveIntervalSecs: 30,
  connectTimeoutSecs: 10,
  ...overrides,
});

describe('buildHostEntryFromConfig', () => {
  it('returns null when protocol is null', () => {
    expect(buildHostEntryFromConfig(null, sshConfig())).toBeNull();
  });

  it('returns null when config is undefined', () => {
    expect(buildHostEntryFromConfig('ssh', undefined)).toBeNull();
  });

  it('returns null for unsupported protocols', () => {
    expect(buildHostEntryFromConfig('serial', sshConfig())).toBeNull();
    expect(buildHostEntryFromConfig('wsl', sshConfig())).toBeNull();
    expect(buildHostEntryFromConfig('gcloud-iap', sshConfig())).toBeNull();
  });

  describe('ssh', () => {
    it('maps all ssh fields', () => {
      const entry = buildHostEntryFromConfig('ssh', sshConfig({
        password: 'secret',
        privateKeyPath: '/keys/id_rsa',
        privateKeyPassphrase: 'phrase',
      }));
      expect(entry).toEqual({
        protocol: 'ssh',
        host: 'example.com',
        port: 22,
        username: 'alice',
        password: 'secret',
        privateKeyPath: '/keys/id_rsa',
        privateKeyPassphrase: 'phrase',
      });
    });

    it('coerces empty optional strings to undefined', () => {
      const entry = buildHostEntryFromConfig('ssh', sshConfig({
        username: '',
        password: '',
        privateKeyPath: '',
        privateKeyPassphrase: '',
      }));
      expect(entry).toEqual({
        protocol: 'ssh',
        host: 'example.com',
        port: 22,
        username: undefined,
        password: undefined,
        privateKeyPath: undefined,
        privateKeyPassphrase: undefined,
      });
    });
  });

  describe('telnet', () => {
    it('maps telnet fields', () => {
      const entry = buildHostEntryFromConfig('telnet', telnetConfig({
        username: 'bob',
        password: 'pw',
      }));
      expect(entry).toEqual({
        protocol: 'telnet',
        host: 'example.com',
        port: 23,
        username: 'bob',
        password: 'pw',
      });
    });

    it('does not carry ssh-only key fields', () => {
      const entry = buildHostEntryFromConfig('telnet', telnetConfig());
      expect(entry).not.toHaveProperty('privateKeyPath');
      expect(entry).not.toHaveProperty('privateKeyPassphrase');
    });

    it('coerces empty optional strings to undefined', () => {
      const entry = buildHostEntryFromConfig('telnet', telnetConfig({
        username: '',
        password: '',
      }));
      expect(entry).toEqual({
        protocol: 'telnet',
        host: 'example.com',
        port: 23,
        username: undefined,
        password: undefined,
      });
    });
  });
});
