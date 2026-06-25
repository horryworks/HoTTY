import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // vitest 4.1.4 + jsdom races on worker init in the default thread pool,
    // causing every test file to fail collection with "Cannot read properties
    // of undefined (reading 'config')". The fork pool sidesteps the race.
    pool: 'forks',
  },
});
