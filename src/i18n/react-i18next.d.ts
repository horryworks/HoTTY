// Augment react-i18next with our catalog shape so t('...') keys are type-checked
// and autocompleted. `en` is the source of truth; `ja` is a partial of it.
import 'react-i18next';
import type { en } from './locales/en';

declare module 'react-i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
  }
}
