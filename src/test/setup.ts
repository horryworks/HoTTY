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

// Pointer capture is likewise missing from jsdom while WebView2 has had it for
// years. `useDialogGeometry` relies on it to keep a dialog drag alive once the
// pointer leaves the window, and guards the call anyway — but without the stub
// every geometry test would exercise the fallback path instead of the real one.
if (typeof Element !== 'undefined' && !Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = function (): void {};
    Element.prototype.releasePointerCapture = function (): void {};
    Element.prototype.hasPointerCapture = function (): boolean {
        return false;
    };
}
