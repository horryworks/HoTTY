// Backoff delays (ms) between model-list fetch attempts after sign-in. Startup
// can race transient conditions (network not yet up after resume, backend token
// refresh still in flight), so an empty/failed fetch is retried before the
// "Failed to retrieve the AI model list" banner is shown — a one-shot fetch
// used to pin that spurious error until the app was restarted.
// (Own module rather than AIChatPane.tsx: react-refresh requires component
// files to export only components; tests also import this.)
export const MODEL_LOAD_RETRY_DELAYS_MS = [1000, 3000, 8000];
