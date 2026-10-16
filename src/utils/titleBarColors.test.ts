import { describe, expect, it } from 'vitest';
import { cssColorToHex, titleBarColors } from './titleBarColors';
import { DEFAULT_THEMES } from '../themes/defaults';
import type { Theme } from '../types/appTypes';

describe('cssColorToHex', () => {
  it('passes #rrggbb through, lowercased', () => {
    expect(cssColorToHex('#25252A')).toBe('#25252a');
  });

  it('expands short hex and drops alpha', () => {
    expect(cssColorToHex('#888')).toBe('#888888');
    expect(cssColorToHex('#8888')).toBe('#888888');
    expect(cssColorToHex('#11223344')).toBe('#112233');
  });

  it('reads rgb() and rgba()', () => {
    expect(cssColorToHex('rgb(255, 0, 16)')).toBe('#ff0010');
    expect(cssColorToHex('rgba(0, 0, 0, 0.5)')).toBe('#000000');
    expect(cssColorToHex('rgb(1 2 3 / 50%)')).toBe('#010203');
  });

  it('rejects what it cannot read', () => {
    expect(cssColorToHex(undefined)).toBeNull();
    expect(cssColorToHex('')).toBeNull();
    expect(cssColorToHex('red')).toBeNull();
    expect(cssColorToHex('#12345')).toBeNull();
    expect(cssColorToHex('rgb(300, 0, 0)')).toBeNull();
    expect(cssColorToHex('var(--bg-secondary)')).toBeNull();
  });
});

describe('titleBarColors', () => {
  it('uses the theme title bar colours', () => {
    expect(titleBarColors(DEFAULT_THEMES.dark)).toEqual({ background: '#252526', text: '#e0e0e0' });
    expect(titleBarColors(DEFAULT_THEMES.light)).toEqual({ background: '#f8f8f8', text: '#000000' });
  });

  it('falls back for custom themes saved without them', () => {
    const old: Theme = {
      ...DEFAULT_THEMES.dark,
      variables: { 'bg-secondary': '#101010', 'text-primary': '#fafafa' },
    };
    expect(titleBarColors(old)).toEqual({ background: '#101010', text: '#fafafa' });
  });

  it('every built-in theme defines both colours', () => {
    for (const theme of Object.values(DEFAULT_THEMES)) {
      expect(theme.variables['titlebar-bg']).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.variables['titlebar-text']).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
