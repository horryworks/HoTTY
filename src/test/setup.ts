// Vitest global setup. Importing the i18n module initializes i18next (synchronously,
// English by default) so any component using useTranslation()/<Trans> renders real
// strings instead of raw keys during tests.
import '../i18n';
