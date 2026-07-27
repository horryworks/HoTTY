import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
