import { describe, it, expect } from 'vitest';
import { nameToKey } from './nameToKey';

describe('nameToKey', () => {
  it('lowercases and trims input', () => {
    expect(nameToKey('  Hello  ')).toBe('hello');
  });

  it('replaces whitespace runs with underscores', () => {
    expect(nameToKey('My Custom Theme')).toBe('my_custom_theme');
    expect(nameToKey('a   b\tc')).toBe('a_b_c');
  });

  it('strips characters outside [a-z0-9_-]', () => {
    expect(nameToKey('Solar!Flare@2024')).toBe('solarflare2024');
    expect(nameToKey('café.dark')).toBe('cafdark');
  });

  it('preserves underscores and hyphens', () => {
    expect(nameToKey('dark-mode_v2')).toBe('dark-mode_v2');
  });

  it('returns empty string for empty or whitespace input', () => {
    expect(nameToKey('')).toBe('');
    expect(nameToKey('   ')).toBe('');
  });
});
