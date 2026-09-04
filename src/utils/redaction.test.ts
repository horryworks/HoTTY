import { describe, it, expect } from 'vitest';
import { redactSecrets, redactSensitive, MAX_LOG_MESSAGE_LENGTH } from './redaction';

describe('redactSensitive', () => {
  it('redacts password=value', () => {
    expect(redactSensitive('password=hunter2')).toBe('password=<redacted>');
  });

  it('redacts password: "value"', () => {
    expect(redactSensitive('password: "hunter2"')).toBe('password: "<redacted>"');
  });

  it('redacts JSON-style "apiKey":"value"', () => {
    expect(redactSensitive('"apiKey":"sk-abc123"')).toBe('"apiKey":"<redacted>"');
  });

  it('redacts api_key with underscore', () => {
    expect(redactSensitive('api_key=xyz')).toBe('api_key=<redacted>');
  });

  it('redacts api-key with hyphen', () => {
    expect(redactSensitive('api-key=xyz')).toBe('api-key=<redacted>');
  });

  it('redacts secret, token, clientSecret, privateKey, refreshToken', () => {
    expect(redactSensitive('secret=abc')).toBe('secret=<redacted>');
    expect(redactSensitive('token=abc')).toBe('token=<redacted>');
    expect(redactSensitive('clientSecret=abc')).toBe('clientSecret=<redacted>');
    expect(redactSensitive('client_secret=abc')).toBe('client_secret=<redacted>');
    expect(redactSensitive('privateKey=abc')).toBe('privateKey=<redacted>');
    expect(redactSensitive('refresh_token=abc')).toBe('refresh_token=<redacted>');
  });

  it('redacts Bearer tokens', () => {
    expect(redactSensitive('Authorization: Bearer eyJhbGc.payload.sig')).toBe(
      'Authorization: Bearer <redacted>',
    );
  });

  it('is case-insensitive on keys', () => {
    expect(redactSensitive('PASSWORD=abc')).toBe('PASSWORD=<redacted>');
    expect(redactSensitive('Password: "abc"')).toBe('Password: "<redacted>"');
  });

  it('redacts multiple occurrences in one string', () => {
    expect(redactSensitive('password=a token=b')).toBe('password=<redacted> token=<redacted>');
  });

  it('does not redact innocuous fields', () => {
    expect(redactSensitive('username=alice host=example.com port=22')).toBe(
      'username=alice host=example.com port=22',
    );
  });

  it('does not match partial-word matches inside identifiers', () => {
    // "passwordless" should not be redacted (full-word boundary)
    expect(redactSensitive('passwordless=true')).toBe('passwordless=true');
  });

  it('truncates messages longer than the cap and appends marker', () => {
    const long = 'a'.repeat(MAX_LOG_MESSAGE_LENGTH + 100);
    const out = redactSensitive(long);
    expect(out.length).toBe(MAX_LOG_MESSAGE_LENGTH + '...<truncated>'.length);
    expect(out.endsWith('...<truncated>')).toBe(true);
  });

  it('leaves short messages untouched', () => {
    expect(redactSensitive('connecting to example.com')).toBe('connecting to example.com');
  });
});

// Network-device configuration is SPACE-separated, so none of it matches the
// keyed `key: value` / `key=value` rule. It is the dominant secret shape in this
// app's content — a `show running-config` the AI asked for egresses verbatim to a
// third-party provider — so it gets its own rule.
describe('redactSecrets — space-separated device config', () => {
  it('redacts an IOS-style encoded password and secret, keeping the encoding digit', () => {
    expect(redactSecrets(' password 7 08701E1D')).toBe(' password 7 <redacted>');
    expect(redactSecrets('enable secret 5 $1$abc$defghi')).toBe('enable secret 5 <redacted>');
  });

  it('redacts an unencoded password / secret value', () => {
    expect(redactSecrets(' password hunter2')).toBe(' password <redacted>');
    expect(redactSecrets('username alice privilege 15 password s3cr3t')).toContain('password <redacted>');
  });

  it('redacts SNMP community strings but keeps the trailing access mode readable', () => {
    expect(redactSecrets('snmp-server community public RO')).toBe('snmp-server community <redacted> RO');
  });

  it('redacts crypto key material', () => {
    expect(redactSecrets(' key-string myPreSharedKey')).toBe(' key-string <redacted>');
    expect(redactSecrets(' pre-shared-key abc123')).toBe(' pre-shared-key <redacted>');
  });

  // `message-digest-key 1 md5 KEY` puts an id AND a cipher name before the secret.
  // Treating either as the value would redact the wrong token and ship the key.
  it('skips over a key id and a cipher name to redact the actual key', () => {
    expect(redactSecrets(' ip ospf message-digest-key 1 md5 ospfKey'))
      .toBe(' ip ospf message-digest-key 1 md5 <redacted>');
    expect(redactSecrets(' authentication-key sha256 theRealKey'))
      .toBe(' authentication-key sha256 <redacted>');
  });

  it('never reaches across a line break to redact the next line\'s first token', () => {
    expect(redactSecrets('no service password-encryption\nhostname sw-01'))
      .toContain('hostname sw-01');
    expect(redactSecrets(' password\ninterface Vlan1')).toContain('interface Vlan1');
  });

  it('redacts every occurrence in a multi-line config dump', () => {
    const out = redactSecrets(
      'line vty 0 4\n password 7 08701E1D\n transport input ssh\nsnmp-server community private RW\n',
    );
    expect(out).not.toContain('08701E1D');
    expect(out).not.toContain('private');
    expect(out).toContain('transport input ssh');
  });

  it('leaves ordinary prose alone so the model keeps real context', () => {
    expect(redactSecrets('the password is wrong')).toBe('the password is wrong');
    expect(redactSecrets('Your password has expired')).toBe('Your password has expired');
    expect(redactSecrets('% Login invalid, password required')).toBe('% Login invalid, password required');
  });

  it('still redacts a device value even when it looks like a word, given an encoding digit', () => {
    expect(redactSecrets(' password 7 invalid')).toBe(' password 7 <redacted>');
  });

  it('does not double-mangle the keyed form the first rule already handled', () => {
    expect(redactSecrets('password: hunter2')).toBe('password: <redacted>');
    expect(redactSecrets('password = hunter2')).toBe('password = <redacted>');
    expect(redactSecrets('"apiKey": "abc123"')).toBe('"apiKey": "<redacted>"');
  });

  it('does not match a partial word', () => {
    expect(redactSecrets('passwordless auth enabled')).toBe('passwordless auth enabled');
  });
});

describe('redactSecrets — PEM private keys', () => {
  it('collapses a private-key body but keeps the markers', () => {
    const pem = [
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAAB',
      'AAAAMwAAAAtzc2gtZWQyNTUxOQAAACBmYWtlZmFrZWZha2VmYWtl',
      '-----END OPENSSH PRIVATE KEY-----',
    ].join('\n');
    const out = redactSecrets(`before\n${pem}\nafter`);
    expect(out).toContain('-----BEGIN OPENSSH PRIVATE KEY-----');
    expect(out).toContain('-----END OPENSSH PRIVATE KEY-----');
    expect(out).toContain('<redacted>');
    expect(out).not.toContain('b3BlbnNzaC1rZXktdjEA');
    expect(out).toContain('before');
    expect(out).toContain('after');
  });

  it('handles the RSA and EC header variants', () => {
    for (const kind of ['RSA', 'EC', '']) {
      const label = kind ? `${kind} PRIVATE KEY` : 'PRIVATE KEY';
      const out = redactSecrets(`-----BEGIN ${label}-----\nSECRETBODY\n-----END ${label}-----`);
      expect(out, label).not.toContain('SECRETBODY');
    }
  });

  it('leaves a public key alone', () => {
    const pub = '-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQ\n-----END PUBLIC KEY-----';
    expect(redactSecrets(pub)).toBe(pub);
  });
});
