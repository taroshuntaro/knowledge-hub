import { defineConfig, devices } from '@playwright/test';

const WEB_URL = 'http://localhost:54173';
const API_URL = 'http://localhost:53000';

export default defineConfig({
  testDir: '.',
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /setup\/.*\.setup\.ts/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'chromium',
      testMatch: /specs\/.*\.spec\.ts/,
      testIgnore: /specs\/sso\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: '.auth/admin.json' },
    },
    // SSO はローカル限定（Keycloak 未起動なら spec 内で skip）。storageState なしの素の状態で走る。
    { name: 'sso', testMatch: /specs\/sso\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'pnpm --dir ../../apps/server start:e2e',
      url: `${API_URL}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'pnpm --dir ../../apps/web exec vite preview --port 54173 --strictPort',
      url: WEB_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { API_PROXY_TARGET: API_URL },
    },
  ],
});
