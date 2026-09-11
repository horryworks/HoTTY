import { describe, it, expect } from 'vitest';
import {
  validateSshKeyName,
  validateSshKeyComment,
  suggestSshKeyName,
  uniqueSshKeyName,
  MAX_SSH_KEY_NAME_LENGTH,
  MAX_SSH_KEY_COMMENT_LENGTH,
} from './sshKeyName';

/**
 * These cases mirror the Rust tests in `services::ssh_keys`. The two validators
 * have to agree — if they drift, the form accepts a name the backend then
 * refuses (or, worse, warns about a name that would have been fine). Changing
 * one side means changing both tables.
 */
describe('validateSshKeyName', () => {
  it('accepts ordinary key names', () => {
    for (const name of ['id_ed25519_hotty', 'id_rsa_hotty', 'router-01_ed25519', 'a', 'key.2026']) {
      expect(validateSshKeyName(name)).toBe(null);
    }
  });

  it('never lets a name be a path', () => {
    // Separators and drive letters sit outside the permitted character set, so
    // they need no rule of their own. This keeps that true if it is widened.
    for (const name of [
      'a/b',
      'a\\b',
      'C:key',
      '../id_rsa',
      '..\\id_rsa',
      'sub/../id_rsa',
      '/etc/passwd',
      '\\\\server\\share',
    ]) {
      expect(validateSshKeyName(name)).not.toBe(null);
    }
  });

  it('rejects empty and overlong names', () => {
    expect(validateSshKeyName('')).toBe('empty');
    expect(validateSshKeyName('a'.repeat(MAX_SSH_KEY_NAME_LENGTH + 1))).toBe('tooLong');
    expect(validateSshKeyName('a'.repeat(MAX_SSH_KEY_NAME_LENGTH))).toBe(null);
  });

  it('applies the dot rules', () => {
    expect(validateSshKeyName('.hidden')).toBe('startsWithDot');
    // Windows silently strips a trailing dot, so this would collide with `id_x`.
    expect(validateSshKeyName('id_x.')).toBe('endsWithDot');
    expect(validateSshKeyName('a..b')).toBe('invalidCharacters');
  });

  it('rejects a public-key name', () => {
    expect(validateSshKeyName('id_ed25519.pub')).toBe('isPublicKey');
    expect(validateSshKeyName('id_ed25519.PUB')).toBe('isPublicKey');
  });

  it('rejects Windows device names with or without an extension', () => {
    for (const name of ['con', 'CON', 'nul', 'com1', 'lpt9', 'nul.txt', 'COM1.key']) {
      expect(validateSshKeyName(name)).toBe('reservedDevice');
    }
  });

  it('rejects non-ASCII names', () => {
    // The third is a zero-width space, written as an escape because an
    // invisible character in source is unreadable — and a lookalike name is
    // exactly the hazard this rule exists for, since the name authorizes a
    // delete.
    for (const name of ['鍵', 'clé', `id_ed25519${String.fromCharCode(0x200b)}`]) {
      expect(validateSshKeyName(name)).toBe('invalidCharacters');
    }
  });
});

describe('validateSshKeyComment', () => {
  it('accepts an ordinary comment', () => {
    expect(validateSshKeyComment('alice@example.com')).toBe(null);
    expect(validateSshKeyComment('')).toBe(null);
    expect(validateSshKeyComment('work laptop')).toBe(null);
  });

  it('rejects anything that would break the authorized_keys line', () => {
    // A newline would split the line and turn the tail into silent garbage on
    // the server.
    expect(validateSshKeyComment(`two${String.fromCharCode(10)}lines`)).toBe('hasLineBreak');
    expect(validateSshKeyComment(`carriage${String.fromCharCode(13)}return`)).toBe('hasLineBreak');
    expect(validateSshKeyComment(`bell${String.fromCharCode(7)}`)).toBe('hasLineBreak');
    expect(validateSshKeyComment(String.fromCharCode(127))).toBe('hasLineBreak');
  });

  it('rejects an overlong comment', () => {
    expect(validateSshKeyComment('a'.repeat(MAX_SSH_KEY_COMMENT_LENGTH + 1))).toBe('tooLong');
  });
});

describe('suggestSshKeyName', () => {
  it('never suggests OpenSSH default name', () => {
    // Suggesting `id_ed25519` would aim every new user at the one file another
    // tool is most likely to have already put there.
    expect(suggestSshKeyName('ed25519')).not.toBe('id_ed25519');
    expect(suggestSshKeyName('rsa-3072')).not.toBe('id_rsa');
  });

  it('names the key after the host when there is one', () => {
    expect(suggestSshKeyName('ed25519', 'router-01')).toBe('router-01_ed25519');
    expect(suggestSshKeyName('rsa-3072', 'sw-01.example.com')).toBe('sw-01.example.com_rsa');
  });

  it('always returns a name the validator accepts', () => {
    for (const host of [
      undefined,
      '',
      'router-01',
      '192.0.2.10',
      'host with spaces',
      'con',
      '...',
      '鍵',
      'a'.repeat(80),
    ]) {
      const name = suggestSshKeyName('ed25519', host);
      expect(validateSshKeyName(name)).toBe(null);
    }
  });
});

describe('uniqueSshKeyName', () => {
  it('returns the base when it is free', () => {
    expect(uniqueSshKeyName('id_ed25519_hotty', [])).toBe('id_ed25519_hotty');
    expect(uniqueSshKeyName('id_ed25519_hotty', ['id_rsa'])).toBe('id_ed25519_hotty');
  });

  it('counts up past a collision', () => {
    expect(uniqueSshKeyName('id_ed25519_hotty', ['id_ed25519_hotty'])).toBe('id_ed25519_hotty-2');
    expect(
      uniqueSshKeyName('id_ed25519_hotty', ['id_ed25519_hotty', 'id_ed25519_hotty-2']),
    ).toBe('id_ed25519_hotty-3');
  });
});
