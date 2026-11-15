// Signing in goes straight to Home, with no detour through the welcome page.
// No real password is used: the form is filled with fake values, and the sign-in
// request is answered inside this test browser with the session saved by
// `npm run e2e:login`, so the fake values never reach Supabase.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { AUTH_FILE } from '../playwright.config.js';

function savedSession() {
  const state = JSON.parse(readFileSync(AUTH_FILE, 'utf8'));
  const entry = state.origins.flatMap((origin) => origin.localStorage).find((item) => /^sb-.*-auth-token$/.test(item.name));
  return JSON.parse(entry.value);
}

test('signing in goes straight to Home (no detour to the welcome page)', async ({ page }) => {
  const session = savedSession();
  await page.route('**/auth/v1/token?grant_type=password', (route) => route.fulfill({ status: 200, json: session }));
  // Record every page the app visits after loading.
  await page.addInitScript(() => {
    window.__visited = [];
    window.addEventListener('hashchange', () => window.__visited.push(window.location.hash));
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/#login');
  await page.locator('input[type="email"]').fill('e2e-sign-in@example.test');
  await page.locator('input[type="password"]').fill('not-a-real-password');
  await page.locator('form').getByRole('button', { name: 'Sign In' }).click();

  await expect(page.locator('.motion-sidebar')).toBeVisible();
  await expect(page).toHaveURL(/#dashboard$/);
  await expect(page.locator('.home h1')).toContainText('Hi');
  const visited = await page.evaluate(() => window.__visited);
  expect(visited.filter((hash) => hash.includes('welcome')), `pages visited: ${visited.join(' → ')}`).toEqual([]);
  expect(errors).toEqual([]);
});
