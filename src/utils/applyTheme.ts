import type { Theme } from '../types/appTypes';

const UI_FONT_FAMILY =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export function applyTheme(theme: Theme, fontSize: number, fontFamily: string): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.variables)) {
    root.style.setProperty(`--${key}`, value);
  }
  root.style.setProperty('--font-family', fontFamily);
  root.style.setProperty('--ui-font-family', UI_FONT_FAMILY);
  root.style.setProperty('--font-size-base', `${fontSize}px`);
}
