import { describe, it, expect, beforeEach, vi } from 'vitest';
import { STORAGE_KEYS } from '../constants/storage';

/**
 * The persist `migrate` function is defined inline inside `create(persist(...))`,
 * so it can only be exercised through a real rehydration: seed localStorage with
 * a persisted payload at the OLD version, then re-import the module fresh
 * (`vi.resetModules()` drops the singleton store so `persist` runs again).
 */
async function rehydrateFrom(persisted: Record<string, unknown>, version: number) {
  localStorage.setItem('hotty-settings', JSON.stringify({ state: persisted, version }));
  vi.resetModules();
  const { useSettingsStore } = await import('./settingsStore');
  return useSettingsStore.getState();
}

describe('settingsStore v29 migration (aiResponseLanguage)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('adopts an explicit legacy localStorage choice', async () => {
    // The pane only ever wrote this key on an explicit dropdown change, so a
    // present value is a deliberate user choice and must survive the move.
    localStorage.setItem(STORAGE_KEYS.GEMINI_LANGUAGE, 'Japanese');
    const s = await rehydrateFrom({ language: 'en' }, 28);
    expect(s.aiResponseLanguage).toBe('Japanese');
  });

  it("maps the legacy '日本語' value to the canonical option value", async () => {
    localStorage.setItem(STORAGE_KEYS.GEMINI_LANGUAGE, '日本語');
    const s = await rehydrateFrom({ language: 'ja' }, 28);
    expect(s.aiResponseLanguage).toBe('Japanese');
  });

  it("defaults to 'Auto' when the legacy key was never written", async () => {
    const s = await rehydrateFrom({ language: 'ja' }, 28);
    expect(s.aiResponseLanguage).toBe('Auto');
  });

  it('leaves the legacy localStorage entry in place (rollback safety)', async () => {
    localStorage.setItem(STORAGE_KEYS.GEMINI_LANGUAGE, 'French');
    await rehydrateFrom({ language: 'en' }, 28);
    expect(localStorage.getItem(STORAGE_KEYS.GEMINI_LANGUAGE)).toBe('French');
  });

  it('does not overwrite an already-migrated value', async () => {
    localStorage.setItem(STORAGE_KEYS.GEMINI_LANGUAGE, 'French');
    const s = await rehydrateFrom({ language: 'en', aiResponseLanguage: 'Korean' }, 29);
    expect(s.aiResponseLanguage).toBe('Korean');
  });
});
