/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['backend/**/*.test.ts', 'frontend/**/*.test.{ts,tsx}', 'src/**/*.test.ts'],
    globals: true,
    // Backend tests run in node (testcontainers); frontend tests in jsdom.
    environmentMatchGlobs: [['frontend/**', 'jsdom']],
    setupFiles: ['./frontend/test-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: {
      DOCKER_HOST: 'npipe:////./pipe/dockerDesktopLinuxEngine',
    },
  },
});
