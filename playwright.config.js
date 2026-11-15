// Click-through (end-to-end) tests: a real Chrome drives the app like a person would.
//   npm run e2e          → signed-out pages, plus the signed-in flows if you saved a login
//   npm run e2e:login    → opens a window; YOU sign in once, the session is saved locally
// Uses the dev server on http://localhost:5173 (started for you if it isn't running).
import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

export const AUTH_FILE = 'e2e/.auth/user.json';
const hasLogin = existsSync(AUTH_FILE);

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome']
  },
  projects: [
    { name: 'signed-out', testMatch: /public\.spec\.js/ },
    ...(hasLogin ? [
      { name: 'signed-in', testMatch: /team-flow\.spec\.js/, use: { storageState: AUTH_FILE } },
      { name: 'sign-in', testMatch: /sign-in\.spec\.js/ }
    ] : [])
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000
  }
});
