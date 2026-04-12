import type { Theme } from '../types/appTypes';

export function applyTheme(theme: Theme, fontSize: number, fontFamily: string): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.variables)) {
    root.style.setProperty(`--${key}`, value);
  }
  root.style.setProperty('--font-family', fontFamily);
  root.style.setProperty('--font-size-base', `${fontSize}px`);
}
