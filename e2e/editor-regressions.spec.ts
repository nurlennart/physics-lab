import { test, expect } from '@playwright/test';
import { openExample } from './learning-helpers';

test('Delete while a wire is pending from a terminal removes the module without crashing', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await openExample(page, 'Loaded induction motor');
  // Clicking a terminal starts a wire and selects its module; Delete then removes the module.
  await page.locator('[data-component="inductionMotor"] [data-port]').first().click();
  await expect(page.locator('.canvas-hint')).toContainText('Select a matching terminal');
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-component="inductionMotor"]')).toHaveCount(0);
  await expect(page.locator('.canvas-hint')).toContainText('Drag to move');
  expect(errors).toEqual([]);
});
test('a rendering error in one pane shows a recoverable message; project and simulation survive', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await openExample(page, 'Loaded induction motor');
  const modules = await page.locator('[data-component]').count();
  await page.getByLabel('Advance by', { exact: true }).selectOption('1');
  await expect(page.getByRole('button', { name: 'Advance 60 s', exact: true })).toBeEnabled();
  const time = await page.locator('.simulation-clock strong').textContent();
  // While running, the next workspace render throws.
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.evaluate(() => { window.__physicsLabRenderFault = 'workspace'; });
  const fallback = page.getByTestId('render-error-workspace');
  await expect(fallback).toContainText('The workspace could not be displayed');
  // The rest of the application stays usable and the run was paused, not lost.
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();
  await expect(page.locator('.inspector')).toBeVisible();
  await fallback.getByRole('button', { name: 'Try again' }).click();
  await expect(fallback).toHaveCount(0);
  await expect(page.locator('[data-component]')).toHaveCount(modules);
  expect(await page.locator('.simulation-clock strong').textContent()).not.toBe('00:00:00.00');
  expect(time).not.toBe('00:00:00.00');
  expect(errors).toEqual([]);
});
