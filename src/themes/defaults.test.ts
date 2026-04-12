import { describe, it, expect } from 'vitest';
import { DEFAULT_THEMES, DEFAULT_THEME_IDS, getTheme } from './defaults';

describe('default themes', () => {
  it('exposes dark, medium, light in that order', () => {
    expect(DEFAULT_THEME_IDS).toEqual(['dark', 'medium', 'light']);
  });

  it('each default theme has name, variables, and terminal colors', () => {
    for (const id of DEFAULT_THEME_IDS) {
      const theme = DEFAULT_THEMES[id];
      expect(typeof theme.name).toBe('string');
      expect(theme.name.length).toBeGreaterThan(0);
      expect(Object.keys(theme.variables).length).toBeGreaterThan(0);
      expect(typeof theme.terminal.foreground).toBe('string');
      expect(typeof theme.terminal.background).toBe('string');
      expect(typeof theme.terminal.backgroundInactive).toBe('string');
      expect(typeof theme.terminal.paneBackground).toBe('string');
    }
  });

  it('getTheme falls back to dark for unknown ids', () => {
    expect(getTheme('dark')).toBe(DEFAULT_THEMES.dark);
    // @ts-expect-error intentionally bad id
    expect(getTheme('bogus')).toBe(DEFAULT_THEMES.dark);
  });
});
