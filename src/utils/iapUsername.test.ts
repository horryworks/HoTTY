import { describe, it, expect } from 'vitest';
import { resolveIapUsername } from './iapUsername';

describe('resolveIapUsername', () => {
  it('returns undefined when nothing is set, so the backend auto-detects', () => {
    expect(resolveIapUsername(undefined, undefined)).toBeUndefined();
  });

  it('uses the global setting when the host has none', () => {
    expect(resolveIapUsername(undefined, 'alice')).toBe('alice');
  });

  it('prefers the host entry over the global setting', () => {
    // The host value was chosen for that specific VM; the global one is a
    // machine-wide default.
    expect(resolveIapUsername('vm-specific', 'alice')).toBe('vm-specific');
  });

  it('treats blank and whitespace-only values as unset', () => {
    // A cleared settings field must restore auto-detection, not send '' as an
    // explicit (and invalid) override.
    expect(resolveIapUsername('', '')).toBeUndefined();
    expect(resolveIapUsername('   ', '\t')).toBeUndefined();
    expect(resolveIapUsername('  ', 'alice')).toBe('alice');
  });

  it('trims surrounding whitespace off whichever value wins', () => {
    expect(resolveIapUsername('  vm-specific ', 'alice')).toBe('vm-specific');
    expect(resolveIapUsername(undefined, '  alice  ')).toBe('alice');
  });
});
