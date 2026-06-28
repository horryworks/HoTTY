import { describe, it, expect } from 'vitest';
import { normalizeUrl, resolveAddress } from './webBrowserUrl';

const SEARCH = 'https://www.google.com/search?q=';

describe('normalizeUrl', () => {
  it('returns empty string for empty / whitespace-only input', () => {
    expect(normalizeUrl('')).toBe('');
    expect(normalizeUrl('   ')).toBe('');
    expect(normalizeUrl('\t\n')).toBe('');
  });

  it('prefixes schemeless host-like input with http://', () => {
    expect(normalizeUrl('example.com')).toBe('http://example.com');
    expect(normalizeUrl('192.168.1.1')).toBe('http://192.168.1.1');
  });

  it('treats host:port as a host (colon followed by a digit is not a scheme)', () => {
    expect(normalizeUrl('localhost:3000')).toBe('http://localhost:3000');
    expect(normalizeUrl('192.168.1.1:8080')).toBe('http://192.168.1.1:8080');
  });

  it('keeps input that already carries an http/https scheme verbatim', () => {
    expect(normalizeUrl('http://example.com')).toBe('http://example.com');
    expect(normalizeUrl('https://example.com/path?q=1')).toBe('https://example.com/path?q=1');
  });

  it('keeps other explicit schemes verbatim so the caller allowlist can reject them', () => {
    // A colon NOT followed by a digit is a scheme — kept as-is, not wrapped in http://.
    expect(normalizeUrl('javascript:alert(1)')).toBe('javascript:alert(1)');
    expect(normalizeUrl('about:blank')).toBe('about:blank');
    expect(normalizeUrl('file:///etc/passwd')).toBe('file:///etc/passwd');
    expect(normalizeUrl('ftp://files.example.com')).toBe('ftp://files.example.com');
  });

  it('trims surrounding whitespace before processing', () => {
    expect(normalizeUrl('  example.com  ')).toBe('http://example.com');
    expect(normalizeUrl('  https://example.com  ')).toBe('https://example.com');
  });
});

describe('resolveAddress', () => {
  it('returns empty string for empty / whitespace-only input', () => {
    expect(resolveAddress('')).toBe('');
    expect(resolveAddress('   ')).toBe('');
  });

  it('keeps explicitly-schemed input verbatim (allowlist decides downstream)', () => {
    expect(resolveAddress('https://example.com')).toBe('https://example.com');
    expect(resolveAddress('http://example.com/x')).toBe('http://example.com/x');
    expect(resolveAddress('javascript:alert(1)')).toBe('javascript:alert(1)');
    expect(resolveAddress('about:blank')).toBe('about:blank');
  });

  it('normalizes host-like input to http://', () => {
    expect(resolveAddress('example.com')).toBe('http://example.com');
    expect(resolveAddress('example.com/path?q=1')).toBe('http://example.com/path?q=1');
    expect(resolveAddress('192.168.1.1')).toBe('http://192.168.1.1');
  });

  it('treats localhost (with or without a port) as a host', () => {
    expect(resolveAddress('localhost')).toBe('http://localhost');
    expect(resolveAddress('localhost:8080')).toBe('http://localhost:8080');
  });

  it('treats a bare host:port as a host', () => {
    expect(resolveAddress('myrouter:8080')).toBe('http://myrouter:8080');
  });

  it('routes free-text / search queries to a Google search', () => {
    expect(resolveAddress('hello world')).toBe(`${SEARCH}hello%20world`);
    expect(resolveAddress('what is rust')).toBe(`${SEARCH}what%20is%20rust`);
  });

  it('treats a bare single word (no dot, no port) as a search', () => {
    expect(resolveAddress('weather')).toBe(`${SEARCH}weather`);
  });

  it('url-encodes special characters in the search query', () => {
    expect(resolveAddress('c++')).toBe(`${SEARCH}c%2B%2B`);
    expect(resolveAddress('a & b')).toBe(`${SEARCH}a%20%26%20b`);
  });

  it('trims surrounding whitespace before processing', () => {
    expect(resolveAddress('  example.com  ')).toBe('http://example.com');
  });
});
