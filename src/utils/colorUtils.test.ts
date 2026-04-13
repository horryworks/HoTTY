import { describe, it, expect } from 'vitest';
import { getTransparentColor } from './colorUtils';

describe('getTransparentColor', () => {
  it('returns the hex color unchanged', () => {
    expect(getTransparentColor('#ff0000')).toBe('#ff0000');
  });

  it('handles 3-char hex', () => {
    expect(getTransparentColor('#abc')).toBe('#abc');
  });

  it('handles empty string', () => {
    expect(getTransparentColor('')).toBe('');
  });
});
