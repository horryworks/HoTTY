import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { i18nReady } from './i18n' // initialize i18next before the app renders
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary'

// Hold the first render until the persisted language's catalog is registered.
// `en` is bundled eagerly, so for English `i18nReady` is already resolved: one
// microtask, no visible gap. For the other seven it costs a single fetch of
// that language's chunk over tauri's embedded asset protocol — a few ms
// locally — and buys a correct first paint instead of a frame of English
// followed by a full re-render. `i18nReady` never rejects.
//
// `.then()` rather than top-level await on purpose: TLA would work in WebView2,
// but it would also make the entry chunk async and tie this file to
// build.target >= es2022 and eslint's ecmaVersion. This costs nothing and
// avoids both constraints.
void i18nReady.then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
})
