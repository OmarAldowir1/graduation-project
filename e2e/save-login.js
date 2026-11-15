// npm run e2e:login
// Opens a Chrome window on the sign-in page. Sign in yourself (any test account you
// own, ideally one used only for testing). When Home appears, the session is saved to
// e2e/.auth/user.json so the signed-in click-through tests can reuse it.
// Your password is never stored; only the session, which is git-ignored and expires.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const AUTH_FILE = 'e2e/.auth/user.json';
const BASE = process.env.E2E_BASE_URL || 'http://localhost:5173';

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(`${BASE}/#login`);
console.log('\nSign in in the Chrome window that just opened. Waiting up to 10 minutes…');

try {
  // Signed in = a Supabase session is stored and the app has left the sign-in page.
  await page.waitForFunction(() => {
    const hasSession = Object.keys(localStorage).some((key) => key.startsWith('sb-') && key.endsWith('-auth-token'));
    const page = window.location.hash.replace('#', '').split(/[/?]/)[0];
    return hasSession && !['login', 'welcome', 'reset-password', ''].includes(page);
  }, null, { timeout: 10 * 60_000, polling: 1000 });
  await page.waitForTimeout(2000); // let the app finish loading the team before saving
  mkdirSync(dirname(AUTH_FILE), { recursive: true });
  await context.storageState({ path: AUTH_FILE });
  console.log(`\n✓ Saved your session to ${AUTH_FILE}. Now run: npm run e2e\n`);
} catch {
  console.error('\nDid not see a successful sign-in in time. Run npm run e2e:login again.\n');
  process.exitCode = 1;
} finally {
  await browser.close();
}
