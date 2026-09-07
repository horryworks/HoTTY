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

describe('settingsStore v30 migration (AI-initiated terminal sessions)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('seeds the safe defaults for a pre-v30 install', async () => {
    const s = await rehydrateFrom({ language: 'en', aiResponseLanguage: 'Auto' }, 29);
    expect(s.aiConnectPolicy).toBe('ask');
    expect(s.aiConnectReuseCredentials).toBe(false);
    expect(s.aiMaxWorkerSessionsPerTab).toBe(5);
    expect(s.aiWorkerIdleTimeoutMins).toBe(10);
    expect(s.aiLocalShellType).toBe('powershell');
  });

  // Security: an upgrade must never silently grant the AI permission to open a
  // shell on the user's PC. `aiConnectPolicy` is assigned unconditionally (not
  // `??=`) so a stray pre-v30 value cannot carry auto-open across the upgrade.
  it('forces aiConnectPolicy to ask on upgrade, even if a pre-v30 payload carried one', async () => {
    const s = await rehydrateFrom({ language: 'en', aiConnectPolicy: 'local-auto' }, 29);
    expect(s.aiConnectPolicy).toBe('ask');
  });

  it('leaves the other v30 keys alone when a pre-v30 payload already had them', async () => {
    const s = await rehydrateFrom(
      { language: 'en', aiConnectReuseCredentials: true, aiMaxWorkerSessionsPerTab: 2 },
      29,
    );
    expect(s.aiConnectReuseCredentials).toBe(true);
    expect(s.aiMaxWorkerSessionsPerTab).toBe(2);
  });

  it('keeps values that are already present', async () => {
    const s = await rehydrateFrom(
      { language: 'en', aiConnectPolicy: 'ask', aiConnectReuseCredentials: true, aiMaxWorkerSessionsPerTab: 2, aiWorkerIdleTimeoutMins: 0, aiLocalShellType: 'cmd' },
      30,
    );
    expect(s.aiConnectPolicy).toBe('ask');
    expect(s.aiConnectReuseCredentials).toBe(true);
    expect(s.aiMaxWorkerSessionsPerTab).toBe(2);
    expect(s.aiWorkerIdleTimeoutMins).toBe(0);
    expect(s.aiLocalShellType).toBe('cmd');
  });
});

describe('settingsStore v32 migration (NetBox)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('seeds the whole NetBox config for a pre-v32 install', async () => {
    const s = await rehydrateFrom({ language: 'en' }, 31);
    expect(s.netbox).toEqual({
      baseUrl: '',
      siteIdField: '',
      syncOnStartup: true,
      lastSyncAt: null,
      lastSyncError: null,
    });
  });

  it('leaves an existing NetBox config alone', async () => {
    const existing = {
      baseUrl: 'https://netbox.example.com',
      siteIdField: 'cf:site_code',
      syncOnStartup: false,
      lastSyncAt: '2026-01-01T00:00:00.000Z',
      lastSyncError: null,
    };
    const s = await rehydrateFrom({ language: 'en', netbox: existing }, 31);
    expect(s.netbox).toEqual(existing);
  });

  it('does not disturb settings from earlier versions', async () => {
    // The migration ladder is cumulative: a v18 install runs 19..32 in order.
    const s = await rehydrateFrom({ language: 'ja', theme: 'dark' }, 18);
    expect(s.language).toBe('ja');
    expect(s.netbox.baseUrl).toBe('');
    expect(s.fileServerConfig).toBeDefined();
  });
});
