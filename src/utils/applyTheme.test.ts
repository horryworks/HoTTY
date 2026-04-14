import { describe, it, expect, beforeEach } from 'vitest';
import { applyTheme, UI_FONT_FAMILY } from './applyTheme';
import type { Theme } from '../types/appTypes';

const fakeTheme: Theme = {
  name: 'Fake',
  variables: {
    'bg-primary': '#111111',
    'text-primary': '#eeeeee',
    'accent-color': '#ff00ff',
  },
  terminal: {
    foreground: '#ffffff',
    background: '#000000',
    backgroundInactive: '#111111',
    paneBackground: '#000000',
  },
};

describe('applyTheme', () => {
  beforeEach(() => {
    const root = document.documentElement;
    root.style.cssText = '';
  });

  it('sets every theme variable as a CSS custom property', () => {
    applyTheme(fakeTheme, 14, 'Menlo');
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--bg-primary')).toBe('#111111');
    expect(root.style.getPropertyValue('--text-primary')).toBe('#eeeeee');
    expect(root.style.getPropertyValue('--accent-color')).toBe('#ff00ff');
  });

  it('sets font-family and font-size-base from args', () => {
    applyTheme(fakeTheme, 16, 'Consolas');
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--font-family')).toBe('Consolas');
    expect(root.style.getPropertyValue('--font-size-base')).toBe('16px');
  });

  it('sets --ui-font-family to the fixed UI stack', () => {
    applyTheme(fakeTheme, 14, 'Consolas');
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--ui-font-family')).toBe(UI_FONT_FAMILY);
  });
});
