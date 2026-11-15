// Signed-out visitors: the homepage, sign-in, private links and shared links.
// Each test starts in a fresh, empty browser (no saved login).
import { test as base, expect } from '@playwright/test';

// Every test fails if the page throws an uncaught error.
const test = base.extend({
  page: async ({ page }, provide) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await provide(page);
    expect(errors, 'uncaught errors in the page').toEqual([]);
  }
});

test('the homepage introduces Groupify and offers sign-in', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/#welcome$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Plan it together');
  await expect(page).toHaveTitle(/Groupify/);
});

test('the sign-in page has email, password, sign up and password reset', async ({ page }) => {
  await page.goto('/#login');
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign Up' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Forgot your password?' })).toBeVisible();
});

for (const link of ['#kanban', '#settings', '#project/00000000-0000-0000-0000-000000000000', '#editor/00000000-0000-0000-0000-000000000000']) {
  test(`opening a private link (${link}) while signed out asks you to sign in`, async ({ page }) => {
    await page.goto(`/${link}`);
    await expect(page).toHaveURL(/#login$/);
    await expect(page.locator('.motion-sidebar')).toHaveCount(0);
  });
}

test('signed out, moving to a private page inside the site (e.g. Back) also asks you to sign in', async ({ page }) => {
  await page.goto('/#login');
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await page.evaluate(() => { window.location.hash = '#settings'; });
  await expect(page).toHaveURL(/#login$/);
  await page.evaluate(() => { window.location.hash = '#dashboard'; });
  await expect(page).toHaveURL(/#welcome$/);
  await expect(page.locator('.motion-sidebar')).toHaveCount(0);
});

test('an invite link opened while signed out is kept for after sign-in', async ({ page }) => {
  await page.goto('/#invite/e2e-test-token');
  await expect(page).toHaveURL(/#login$/);
  expect(await page.evaluate(() => localStorage.getItem('motion-pending-invite'))).toBe('e2e-test-token');
});

test('a broken shared link shows a friendly message', async ({ page }) => {
  await page.goto('/#share/not-a-real-link');
  await expect(page.getByRole('heading', { name: /isn’t available/ })).toBeVisible();
});
