import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Separate config for tests — does NOT include Electron plugins,
// which would fail in a jsdom environment.
export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./src/test/setup.ts'],
        include: ['src/**/*.test.{ts,tsx}'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            include: ['src/utils/**', 'src/constants/**', 'src/hooks/**', 'src/components/**'],
            exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**'],
        },
    },
});
