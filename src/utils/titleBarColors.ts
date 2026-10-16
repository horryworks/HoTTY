import type { Theme } from '../types/appTypes';

/**
 * Normalize a theme colour to `#rrggbb` for the native title bar, or null when
 * it is not a plain colour we can read. Alpha is dropped: the title bar is
 * opaque. Accepts #rgb, #rgba, #rrggbb, #rrggbbaa, rgb() and rgba().
 */
export function cssColorToHex(value: string | undefined): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();

  const hex = /^#([0-9a-f]{3,8})$/.exec(v)?.[1];
  if (hex) {
    if (hex.length === 3 || hex.length === 4) {
      return '#' + hex.slice(0, 3).split('').map((c) => c + c).join('');
    }
    if (hex.length === 6 || hex.length === 8) return '#' + hex.slice(0, 6);
    return null;
  }

  const rgb = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/.exec(v);
  if (rgb) {
    const channels = rgb.slice(1, 4).map(Number);
    if (channels.some((n) => n > 255)) return null;
    return '#' + channels.map((n) => n.toString(16).padStart(2, '0')).join('');
  }
  return null;
}

/** Title bar colours for a theme. Custom themes saved before the title bar
 *  became themeable fall back to the panel background and main text colour. */
export function titleBarColors(theme: Theme): { background: string | null; text: string | null } {
  const vars = theme.variables;
  return {
    background: cssColorToHex(vars['titlebar-bg'] ?? vars['bg-secondary']),
    text: cssColorToHex(vars['titlebar-text'] ?? vars['text-primary']),
  };
}
