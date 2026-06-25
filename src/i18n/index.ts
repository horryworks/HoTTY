import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './locales/en';
import { ja } from './locales/ja';
import { zhCN } from './locales/zh-CN';
import { zhTW } from './locales/zh-TW';
import { ko } from './locales/ko';
import { ru } from './locales/ru';
import { es } from './locales/es';
import { fr } from './locales/fr';
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

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ja: { translation: ja },
    'zh-CN': { translation: zhCN },
    'zh-TW': { translation: zhTW },
    ko: { translation: ko },
    ru: { translation: ru },
    es: { translation: es },
    fr: { translation: fr },
  },
  // The settings store hydrates synchronously from localStorage, so the persisted
  // language is available here. App.tsx keeps this in sync on later changes.
  lng: useSettingsStore.getState().language,
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React already escapes
  returnNull: false,
  react: { useSuspense: false }, // resources are inline/synchronous — no Suspense needed
});

export default i18n;
