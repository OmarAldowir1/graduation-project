// Signed-in click-through test of a real team workflow, in a throwaway project.
// Needs a saved login (npm run e2e:login). The project and everything in it is
// deleted at the end, even when a step fails.
import { test, expect } from '@playwright/test';

const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const PROJECT = `E2E test project ${stamp}`;
const TASK = `E2E task ${stamp}`;
const MILESTONE = `E2E milestone ${stamp}`;

function dateInDays(days) {
  const date = new Date(Date.now() + days * 86400000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function submitDialog(page, fields, submitLabel) {
  const form = page.locator('.modal-backdrop form');
  await expect(form).toBeVisible();
  for (const [name, value] of Object.entries(fields)) {
    const control = form.locator(`[name="${name}"]`);
    if (await control.evaluate((el) => el.tagName === 'SELECT')) await control.selectOption(value);
    else await control.fill(value);
  }
  await form.getByRole('button', { name: submitLabel }).click();
  await expect(form).toHaveCount(0);
}

async function confirm(page) {
  await page.locator('.modal-backdrop').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);
}

test('a team member can run a project: create it, add and finish a task, set a milestone, share a file', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  let projectId = null;

  try {
    await test.step('Home loads for a signed-in member', async () => {
      await page.goto('/#dashboard');
      await expect(page.locator('.motion-sidebar')).toBeVisible();
      await expect(page.locator('.home h1')).toContainText('Hi');
    });

    await test.step('Create a project', async () => {
      await page.locator('[data-new-project]').first().click();
      await submitDialog(page, { title: PROJECT, template: 'blank' }, 'Create project');
      await expect(page).toHaveURL(/#project\/[0-9a-f-]{36}$/);
      projectId = page.url().split('#project/')[1];
      await expect(page.locator('.project-bar-title')).toContainText(PROJECT);
    });

    await test.step('Add a task and tick it off', async () => {
      await page.locator('[data-add-task]').click();
      await submitDialog(page, { title: TASK }, 'Create task');
      const row = page.locator('.project-task', { hasText: TASK });
      await expect(row).toBeVisible();
      await row.locator('.project-task-check').click();
      await expect(page.locator('.project-task', { hasText: TASK })).toHaveCount(0);
      await expect(page.locator('.project-progress small')).toContainText('1/1 tasks done');
    });

    await test.step('Set a milestone and see the deadline health', async () => {
      const card = page.locator('.project-milestones');
      await card.locator('[data-add-milestone]').click();
      await submitDialog(page, { title: MILESTONE, date: dateInDays(14) }, 'Add milestone');
      await expect(card.locator('.milestone-list')).toContainText(MILESTONE);
      // The only task is done (100%), so the project is ahead of schedule.
      await expect(card.locator('.deadline-health')).toContainText('On track');
    });

    await test.step('Upload a file to the Library, then delete it', async () => {
      await page.locator('.project-tabs').getByRole('link', { name: /Library/ }).click();
      await expect(page).toHaveURL(new RegExp(`#project/${projectId}/pages$`));
      const resources = page.locator('.project-resources');
      await expect(resources.locator('[data-upload-file]')).toBeVisible();
      await resources.locator('[data-file-input]').setInputFiles({ name: 'e2e-notes.txt', mimeType: 'text/plain', buffer: Buffer.from(`Click-through test ${stamp}\n`) });
      await submitDialog(page, { tag: 'E2E' }, 'Upload');
      const card = resources.locator('.resource-card', { hasText: 'e2e-notes' });
      await expect(card).toBeVisible();
      await expect(card).toContainText('e2e-notes.txt');
      await card.locator('[data-delete-resource]').click();
      await confirm(page);
      await expect(resources.locator('.resource-card', { hasText: 'e2e-notes' })).toHaveCount(0);
    });

    expect(pageErrors, 'uncaught errors in the page').toEqual([]);
  } finally {
    // Clean up: delete the throwaway project (its tasks and milestones go with it).
    if (projectId) {
      const left = await page.evaluate(async (id) => {
        const { supabase } = await import('/src/lib/supabase.js');
        await supabase.from('pages').delete().eq('id', id);
        const { count } = await supabase.from('pages').select('id', { count: 'exact', head: true }).eq('id', id);
        return count;
      }, projectId);
      expect(left, 'the test project should be deleted').toBe(0);
    }
  }
});
