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
  await expect(page.locator('.trace-readouts')).toContainText('Outdoor air');
  await expect(page.locator('.trace-readouts')).toContainText('Outdoor humidity');
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

test('outdoors can be traced in any experiment', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New empty experiment' }).click();
  await page.getByRole('button', { name: 'Manage traces' }).click();
  await page.getByLabel('Trace component').selectOption('environment');
  // Without weather only the air temperature exists.
  await expect(page.getByLabel('Chart measurement').locator('option')).toHaveCount(1);
  await page.getByRole('button', { name: 'Add trace' }).click();
  await expect(page.locator('.trace-readouts')).toContainText('Outdoor air');
  await page.getByLabel('Outdoor conditions', { exact: true }).selectOption('designDay');
  await page.getByLabel('Trace component').selectOption('environment');
  await expect(page.getByLabel('Chart measurement').locator('option')).toHaveCount(4); // air, humidity, sun elevation, global irradiance
});

test('a June day: the panel follows the sun', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await openExample(page, 'Off-grid solar through a June day');
  await expect(page.getByTestId('weather-clock')).toContainText('Day 1 · 06:00');
  await page.getByRole('button', { name: 'Advance 60 s', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Advance 60 s', exact: true })).toBeEnabled({ timeout: 60000 });
  await expect(page.getByTestId('weather-clock')).toContainText('sun');
  await expect(page.getByTestId('weather-now')).toContainText('global horizontal irradiance');
  await expect(page.locator('.trace-readouts')).toContainText('Sun elevation');
  await expect(page.locator('.trace-readouts')).toContainText('Sunlight on the module');
  await page.locator('[data-component="solarPanel"]').click();
  await expect(page.getByLabel('Sunlight and cell temperature', { exact: true })).toHaveValue('weather');
  await expect(page.locator('.inspector')).toContainText('from the weather: sun and outdoor air');
  expect(errors).toEqual([]);
});
