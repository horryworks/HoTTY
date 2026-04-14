import { useCallback, useEffect, useState } from 'react';
import { tauriService } from '../services/tauriService';
import { DEFAULT_THEMES } from '../themes/defaults';
import type { SaveThemeResult, Theme } from '../types/appTypes';

export interface UseThemesApi {
  themesData: Record<string, Theme>;
  reloadThemes: () => Promise<void>;
  saveTheme: (key: string, data: Theme) => Promise<SaveThemeResult>;
  deleteTheme: (key: string) => Promise<SaveThemeResult>;
}

function mergeWithDefaults(loaded: Record<string, Theme>): Record<string, Theme> {
  return { ...DEFAULT_THEMES, ...loaded };
}

export function useThemes(): UseThemesApi {
  const [themesData, setThemesData] = useState<Record<string, Theme>>(() => ({ ...DEFAULT_THEMES }));

  const reloadThemes = useCallback(async () => {
    try {
      const loaded = await tauriService.getThemes();
      setThemesData(mergeWithDefaults(loaded));
    } catch {
      setThemesData({ ...DEFAULT_THEMES });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async backend load must trigger state after mount
    void reloadThemes();
  }, [reloadThemes]);

  const saveTheme = useCallback(async (key: string, data: Theme): Promise<SaveThemeResult> => {
    const result = await tauriService.saveCustomTheme(key, data);
    if (result.success) {
      await reloadThemes();
    }
    return result;
  }, [reloadThemes]);

  const deleteTheme = useCallback(async (key: string): Promise<SaveThemeResult> => {
    const result = await tauriService.deleteCustomTheme(key);
    if (result.success) {
      await reloadThemes();
    }
    return result;
  }, [reloadThemes]);

  return { themesData, reloadThemes, saveTheme, deleteTheme };
}
