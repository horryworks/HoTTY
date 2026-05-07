import { describe, it, expect } from 'vitest';
import { redactSensitive, MAX_LOG_MESSAGE_LENGTH } from './redaction';

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
