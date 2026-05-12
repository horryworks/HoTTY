import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // vitest 4.1.4 + jsdom races on worker init in parallel mode, causing
    // every test file to fail collection with "Cannot read properties of
    // undefined (reading 'config')". Run files sequentially until upstream
    // fixes it.
    fileParallelism: false,
  },
});
