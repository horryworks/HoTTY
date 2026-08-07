import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // The only runtime this app ever ships to is the Windows WebView2 Evergreen
    // Runtime — an auto-updating Chromium. Vite 8's default
    // ('baseline-widely-available') resolves to
    // ['chrome111','edge111','firefox114','safari16.4','ios16.4'], so it also
    // constrains output for two engines this app cannot run in. Naming Chromium
    // directly drops those constraints WITHOUT raising the floor (chrome111 is
    // exactly the Chromium half of Vite's default), and `cssTarget` follows
    // `target`, so the CSS loses its Safari/Firefox-only prefixes too.
    target: 'chrome111',

    // Vite 8.0.16's default minifier is already 'oxc' (the bundler is rolldown).
    // Stated explicitly so a future default change shows up as a diff instead of
    // a silent size regression. terser is deliberately NOT used: ~2-3% smaller
    // output in exchange for a new devDependency (supply-chain policy) and a
    // much slower build, on a bundle that gets brotli-compressed into the
    // binary's .rdata anyway.
    minify: 'oxc',

    // Never emit source maps for a shipped build: everything under dist/ is
    // baked wholesale into the binary by tauri's asset codegen, and maps are
    // ~2x the size of the code they describe. Flip to true only for a local
    // bundle investigation, then flip it back.
    sourcemap: false,

    // WebView2 supports <link rel="modulepreload"> natively, so the ~1 KB
    // polyfill Vite injects by default is dead weight in a Chromium-only app.
    modulePreload: { polyfill: false },

    // Keep Vite's per-chunk raw + gzip table in the build log. With no bundle
    // analyzer installed (by supply-chain policy), that table IS this project's
    // bundle-size regression check.
    reportCompressedSize: true,

    // Entry-chunk budget, set just above the post-split entry chunk. Its job is
    // to catch the regression where an `import type` is accidentally written as
    // a value import and drags a lazy pane back into the entry chunk.
    chunkSizeWarningLimit: 1100,

    // `rollupOptions.output.manualChunks` is deliberately NOT configured.
    // Manual vendor/app splitting exists to exploit long-lived HTTP caches
    // across deploys; here every asset is embedded in the exe and re-shipped
    // whole on every release, so there is no cache to hit — and each extra
    // chunk costs one more custom-protocol round trip plus a brotli decode
    // during startup. The only splits that pay for themselves are the dynamic
    // import()s in src/i18n/index.ts and App.tsx, which rolldown derives on its
    // own. `cssCodeSplit` is likewise left at its default (true): Vite's
    // preload helper injects and AWAITS each chunk's stylesheet before
    // resolving the module promise, so a lazy modal cannot paint before its CSS
    // lands.
  },
  server: {
    watch: {
      // Vite's default watcher covers the whole project root, which here means
      // `src-tauri/target/` — 18 GB and ~12k files that cargo rewrites
      // continuously while `tauri dev` runs. Every one of those writes read as a
      // source change and triggered a full page reload: the window flickered,
      // the watcher churned over the whole tree, and any open feature pane
      // vanished (feature panes live in App.tsx's `featurePanes` useState, and
      // paneStore persists only layoutMode/activePaneId, so a reload wipes them
      // all at once).
      //
      // Rust changes are picked up by `tauri dev`'s own cargo watcher, so Vite
      // has no reason to look inside src-tauri. Mirrors Tauri's Vite template.
      ignored: ['**/src-tauri/**'],
    },
  },
})
