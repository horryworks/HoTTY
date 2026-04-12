import darkTheme from '../../resources/dark.json';
import mediumTheme from '../../resources/medium.json';
import lightTheme from '../../resources/light.json';
import type { Theme, ThemeId } from '../types/appTypes';

export const DEFAULT_THEME_IDS: ThemeId[] = ['dark', 'medium', 'light'];

export const DEFAULT_THEMES: Record<ThemeId, Theme> = {
  dark: darkTheme as Theme,
  medium: mediumTheme as Theme,
  light: lightTheme as Theme,
};

export function getTheme(id: ThemeId): Theme {
  return DEFAULT_THEMES[id] ?? DEFAULT_THEMES.dark;
}
