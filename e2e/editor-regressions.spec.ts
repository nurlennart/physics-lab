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
