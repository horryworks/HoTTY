import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main/index.ts',
        onstart(args) {
          if (args.startup) args.startup()
        },
        vite: {
          build: {
            outDir: 'dist-electron/main',
            rollupOptions: {
              external: ['electron', 'ssh2', 'telnet-client', 'serialport', '@serialport/bindings-cpp', 'bufferutil', 'utf-8-validate'],
            },
            lib: {
              entry: 'electron/main/index.ts',
              formats: ['cjs'],
            },
          },
        },
      },
      {
        entry: 'electron/preload/index.ts',
        onstart(args) {
          // Notify the Renderer-Process to reload the page when the Preload-Scripts build is complete, 
          // instead of restarting the entire Electron App.
          args.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron/preload',
            rollupOptions: {
              external: ['electron'],
            },
            lib: {
              entry: 'electron/preload/index.ts',
              formats: ['cjs'],
            },
          },
        },
      },
    ]),
    renderer(),
  ],
})
