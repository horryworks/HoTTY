// Vitest global setup. Importing the i18n module initializes i18next (synchronously,
// English by default) so any component using useTranslation()/<Trans> renders real
// strings instead of raw keys during tests.
import '../i18n';

// jsdom ships no ResizeObserver, but WebView2 (Chromium) has had it for years.
// Without this stub any component that observes its own size throws on mount in
// tests only — a failure that says nothing about the code under test. The stub
// never fires: tests that care about resize behaviour drive it directly.
if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
    } as unknown as typeof ResizeObserver;
}
