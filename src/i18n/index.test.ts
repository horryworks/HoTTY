import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import i18n, { SUPPORTED_LANGUAGES, loadCatalog, changeLanguage } from './index';
import { en } from './locales/en';
import { ja } from './locales/ja';

// Only `en` is registered at init() — the other seven catalogs are lazily
// imported chunks in production (see the CATALOG_LOADERS comment in ./index).
// Register them all up front so the parity assertions below still see the full
// set; this also exercises the loader itself, which the old inline `resources`
// map could not.
beforeAll(async () => {
  const results = await Promise.all(SUPPORTED_LANGUAGES.map(({ id }) => loadCatalog(id)));
  expect(results.every(Boolean), 'every catalog chunk loads').toBe(true);
});

/** Flatten a nested catalog object into dot-joined leaf keys. */
function flattenKeys(obj: unknown, prefix = '', out: string[] = []): string[] {
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object') flattenKeys(v, key, out);
      else out.push(key);
    }
  }
  return out;
}

describe('i18n', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('initializes with English as the default/fallback language', () => {
    expect(i18n.language).toBe('en');
    expect(i18n.t('settings.general.languageSection')).toBe(en.settings.general.languageSection);
  });

  it('returns Japanese strings after switching language', async () => {
    await changeLanguage('ja');
    expect(i18n.t('settings.general.languageSection')).toBe(ja.settings!.general!.languageSection);
    expect(i18n.t('common.save')).toBe(ja.common!.save);
  });

  it('falls back to English for a key missing in the active language', async () => {
    // Add a synthetic key to English only, then confirm Japanese falls back to it
    // (rather than returning the raw key) — this stays valid as the ja catalog fills in.
    i18n.addResource('en', 'translation', 'test.fallbackOnly', 'English only');
    await changeLanguage('ja');
    expect(i18n.t('test.fallbackOnly' as never)).toBe('English only');
  });

  it('resolves nested keys via the dot separator', () => {
    expect(i18n.t('settings.tabs.general')).toBe(en.settings.tabs.general);
  });
});

describe('i18n language parity', () => {
  const EXPECTED_IDS = ['en', 'ja', 'zh-CN', 'zh-TW', 'ko', 'ru', 'es', 'fr'];
  const enKeys = flattenKeys(en);

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('exposes exactly the expected set of supported languages', () => {
    expect(SUPPORTED_LANGUAGES.map((l) => l.id)).toEqual(EXPECTED_IDS);
  });

  it('registers a non-empty resource bundle for every supported language', () => {
    for (const { id } of SUPPORTED_LANGUAGES) {
      const bundle = i18n.getResourceBundle(id, 'translation');
      expect(bundle, `missing bundle for ${id}`).toBeTruthy();
      expect(flattenKeys(bundle).length, `empty bundle for ${id}`).toBeGreaterThan(0);
    }
  });

  it('translates a sample key in every non-English language (not the raw key)', () => {
    const sample = 'settings.general.languageSection';
    for (const { id } of SUPPORTED_LANGUAGES) {
      const fixedT = i18n.getFixedT(id);
      const value = fixedT(sample);
      expect(value, `untranslated sample for ${id}`).not.toBe(sample);
      expect(typeof value).toBe('string');
      if (id !== 'en') {
        expect(value, `${id} sample equals English`).not.toBe(en.settings.general.languageSection);
      }
    }
  });

  it('covers every English key in every language (no silent gaps)', () => {
    const report: Record<string, string> = {};
    const incomplete: string[] = [];
    for (const { id } of SUPPORTED_LANGUAGES) {
      const bundle = i18n.getResourceBundle(id, 'translation');
      const present = new Set(flattenKeys(bundle));
      const missing = enKeys.filter((k) => !present.has(k));
      const pct = Math.round(((enKeys.length - missing.length) / enKeys.length) * 100);
      report[id] = `${pct}% (${enKeys.length - missing.length}/${enKeys.length})`;
      if (missing.length > 0) incomplete.push(`${id}: missing ${missing.length} (e.g. ${missing.slice(0, 5).join(', ')})`);
    }
    // Surface the per-language completeness so gaps are visible, not silent.
    console.info('i18n completeness:', report);
    expect(incomplete, incomplete.join('\n')).toEqual([]);
  });
});
