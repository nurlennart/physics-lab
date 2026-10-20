import { test, expect, type Page } from '@playwright/test';
import { openExample } from './learning-helpers';

async function commit(page: Page, label: string, value: string) {
  const field = page.getByLabel(label, { exact: true });
  await field.fill(value);
  await field.press('Enter');
}

test('weather: a design day drives the clock and outdoor air, and switches back to a fixed ambient', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await openExample(page, 'Heat pump through a January day');
  const clock = page.getByTestId('weather-clock');
  await expect(clock).toContainText('Day 1 · 00:00');
  await expect(page.getByLabel('Outdoor conditions', { exact: true })).toHaveValue('designDay');
  await expect(page.getByLabel('Daily minimum', { exact: true })).toHaveValue('-5');
  await page.getByRole('button', { name: 'Advance 60 s', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Advance 60 s', exact: true })).toBeEnabled({ timeout: 60000 });
  await expect(clock).toContainText('Day 1 · 00:01');
  await expect(page.getByTestId('weather-now')).toContainText('% RH outdoors');
  // A drier day: the humidity readout follows the dew point.
  const before = await page.getByTestId('weather-now').innerText();
  await commit(page, 'Dew point', '-12');
  await expect(page.getByTestId('weather-now')).not.toHaveText(before);
  // A dew point above the daily minimum would be supersaturated air: refused.
  await commit(page, 'Dew point', '0');
  await expect(page.getByLabel('Dew point', { exact: true })).toHaveValue('-12');
  await page.getByLabel('Outdoor conditions', { exact: true }).selectOption('fixed');
  await expect(clock).toHaveCount(0);
  await expect(page.getByLabel('Laboratory ambient temperature')).toBeVisible();
  expect(errors).toEqual([]);
});
