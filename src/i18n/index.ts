import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './locales/en';
import { useSettingsStore } from '../stores/settingsStore';
import type { LanguageId } from '../types/appTypes';

/** Languages offered in the Settings → General selector. Each label is shown in
 *  its own script and is intentionally NOT run through the translation layer. */
export const SUPPORTED_LANGUAGES: { id: LanguageId; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'ja', label: '日本語' },
  { id: 'zh-CN', label: '简体中文' },
  { id: 'zh-TW', label: '繁體中文' },
  { id: 'ko', label: '한국어' },
  { id: 'ru', label: 'Русский' },
  { id: 'es', label: 'Español' },
  { id: 'fr', label: 'Français' },
];

/** Dynamic catalog loaders — `en` is deliberately absent.
 *
 *  `en` stays a STATIC import above so it is always in the entry chunk: it is
 *  the fallbackLng, and `i18n.t(...)` is also called imperatively outside React
 *  (useSessionManager) where there is nothing to await. The other seven are
 *  ~690 KB of source that a given user never reads, so each `import()` below
 *  becomes its own lazily fetched chunk. Rollup/rolldown derives those chunks
 *  from these calls alone — no `manualChunks` entry is required. */
const CATALOG_LOADERS: Record<Exclude<LanguageId, 'en'>, () => Promise<object>> = {
  ja: () => import('./locales/ja').then((m) => m.ja),
  'zh-CN': () => import('./locales/zh-CN').then((m) => m.zhCN),
  'zh-TW': () => import('./locales/zh-TW').then((m) => m.zhTW),
  ko: () => import('./locales/ko').then((m) => m.ko),
  ru: () => import('./locales/ru').then((m) => m.ru),
  es: () => import('./locales/es').then((m) => m.es),
  fr: () => import('./locales/fr').then((m) => m.fr),
};

/** Catalogs already registered with i18next. `en` is registered at init(). */
const loaded = new Set<LanguageId>(['en']);
/** In-flight loads, so concurrent callers share one import(). */
const inFlight = new Map<LanguageId, Promise<boolean>>();

/**
 * Fetch a catalog chunk and register it with i18next. Idempotent.
 *
 * Resolves `false` when the chunk cannot be loaded (corrupt install, aborted
 * asset request) so callers can decline to switch rather than land on a
 * language whose strings are all missing.
 */
export function loadCatalog(lng: LanguageId): Promise<boolean> {
  if (loaded.has(lng)) return Promise.resolve(true);
  const existing = inFlight.get(lng);
  if (existing) return existing;
  const load = CATALOG_LOADERS[lng as Exclude<LanguageId, 'en'>];
  if (!load) return Promise.resolve(false);
  const p = load()
    .then((catalog) => {
      // deep + overwrite reproduce the previous inline `resources` map exactly:
      // one 'translation' namespace per language.
      i18n.addResourceBundle(lng, 'translation', catalog, true, true);
      loaded.add(lng);
      return true;
    })
    .catch(() => false)
    .finally(() => {
      inFlight.delete(lng);
    });
  inFlight.set(lng, p);
  return p;
}

/**
 * Fetch-then-switch. Always use this instead of `i18n.changeLanguage` directly:
 * i18next has no backend configured here, so switching to a language whose
 * bundle has not been added yet would render every string through the English
 * fallback. On a failed fetch this is a no-op and the UI stays where it was.
 */
export async function changeLanguage(lng: LanguageId): Promise<void> {
  if (!(await loadCatalog(lng))) return;
  await i18n.changeLanguage(lng);
}

// i18next initializes SYNCHRONOUSLY when `resources` are inline and no backend
// is configured, so `i18n.t(...)` is usable on the very next statement. That is
// what useSessionManager's imperative call and src/test/setup.ts rely on, and
// it is why `en` is eager. Start on 'en'; the persisted language is applied by
// `i18nReady` below, so `i18n.language` never names a bundle that is absent.
i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React already escapes
  returnNull: false,
  react: { useSuspense: false }, // catalogs are registered imperatively, not via Suspense
});

/**
 * Resolves once the persisted language is active. `main.tsx` defers the first
 * render until then, so a ja/ru/zh/… user never sees a frame of English.
 *
 * The settings store hydrates synchronously from localStorage, so the persisted
 * language is readable here. This promise NEVER rejects — a failed catalog
 * fetch leaves the app on English rather than blocking startup (and would
 * otherwise surface as an unhandled rejection under Vitest).
 */
const persisted = useSettingsStore.getState().language;
export const i18nReady: Promise<void> =
  persisted === 'en' ? Promise.resolve() : changeLanguage(persisted).catch(() => {});

export default i18n;
