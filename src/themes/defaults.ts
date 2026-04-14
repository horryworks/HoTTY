import darkTheme from '../../resources/dark.json';
import mediumTheme from '../../resources/medium.json';
import lightTheme from '../../resources/light.json';
import type { Theme, BuiltInThemeId } from '../types/appTypes';

export const DEFAULT_THEME_IDS: BuiltInThemeId[] = ['dark', 'medium', 'light'];

export const DEFAULT_THEMES: Record<BuiltInThemeId, Theme> = {
  dark: darkTheme as Theme,
  medium: mediumTheme as Theme,
  light: lightTheme as Theme,
};

export function isBuiltInThemeId(id: string): id is BuiltInThemeId {
  return id === 'dark' || id === 'medium' || id === 'light';
}

export function getTheme(id: string): Theme {
  if (isBuiltInThemeId(id)) return DEFAULT_THEMES[id];
  return DEFAULT_THEMES.dark;
}
