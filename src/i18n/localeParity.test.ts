import { describe, it, expect } from 'vitest';
import { en } from './locales/en';
import { ja } from './locales/ja';
import { zhCN } from './locales/zh-CN';
import { zhTW } from './locales/zh-TW';
import { ko } from './locales/ko';
import { ru } from './locales/ru';
import { es } from './locales/es';
import { fr } from './locales/fr';

// `en` is the source of truth for translation keys (see locales/en/index.ts).
// Every other language must define the same keys, so the UI never silently falls
// back to English, and carries no stale keys left behind after a rename/removal.
//
// i18next pluralization (CLDR) is handled specially: a pluralized key appears as
// `<base>_<category>`, and the category set differs by language (English uses
// one/other; Russian adds few/many; Japanese/Chinese/Korean use only other).
// We therefore compare non-plural keys exactly, but plural keys only at the
// `<base>` level — so a language carrying the extra `_few`/`_many` forms it
// legitimately needs is not mis-flagged as having stale keys.

type AnyRecord = Record<string, unknown>;

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/** Collect every leaf key path (dot-joined) from a nested catalog. */
function collectKeys(obj: AnyRecord, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...collectKeys(v as AnyRecord, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

/** Split leaf keys into exact (non-plural) keys and the base names of plural keys. */
function partition(keys: string[]): { exact: Set<string>; pluralBases: Set<string> } {
  const exact = new Set<string>();
  const pluralBases = new Set<string>();
  for (const k of keys) {
    if (PLURAL_SUFFIX.test(k)) pluralBases.add(k.replace(PLURAL_SUFFIX, ''));
    else exact.add(k);
  }
  return { exact, pluralBases };
}

const locales: Record<string, AnyRecord> = {
  ja,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  ko,
  ru,
  es,
  fr,
};

const enParts = partition(collectKeys(en as AnyRecord));

describe('i18n locale key parity', () => {
  it('the en source catalog is non-empty', () => {
    expect(enParts.exact.size + enParts.pluralBases.size).toBeGreaterThan(0);
  });

  for (const [lang, catalog] of Object.entries(locales)) {
    const parts = partition(collectKeys(catalog));

    describe(lang, () => {
      it('defines every key present in en (no missing translations)', () => {
        const missingExact = [...enParts.exact].filter((k) => !parts.exact.has(k)).sort();
        const missingPlural = [...enParts.pluralBases].filter((b) => !parts.pluralBases.has(b)).sort();
        expect({ missingExact, missingPlural }).toEqual({ missingExact: [], missingPlural: [] });
      });

      it('defines no keys absent from en (no stale keys)', () => {
        const extraExact = [...parts.exact].filter((k) => !enParts.exact.has(k)).sort();
        const extraPlural = [...parts.pluralBases].filter((b) => !enParts.pluralBases.has(b)).sort();
        expect({ extraExact, extraPlural }).toEqual({ extraExact: [], extraPlural: [] });
      });
    });
  }
});
