import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    globalSetup: ['./src/test/global-setup.ts'],
    env: { LOG_LEVEL: 'silent' },
  },
});
