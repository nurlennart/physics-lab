import { test, expect } from '@playwright/test';
import { openExample } from './learning-helpers';

test('TRV dial updates its face and persists room association without control wiring', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await openExample(page, 'Thermostatic radiator room');
  const valve = page.locator('[data-component="thermostaticValve"]'); await valve.click();
  await expect(page.getByLabel('Assigned Thermal Space', { exact: true })).not.toHaveValue('');
  await expect(valve.locator('[data-port]')).toHaveCount(2);
  await expect(valve.locator('.face-state')).toContainText('≈20 °C');
  await page.getByLabel('Thermostat dial', { exact: true }).fill('4');
  await page.getByLabel('Thermostat dial', { exact: true }).press('Enter');
  await expect(valve.locator('.face-state')).toContainText('≈23 °C');
  await page.getByLabel('Thermostat dial', { exact: true }).fill('0');
  await page.getByLabel('Thermostat dial', { exact: true }).press('Enter');
  await expect(valve.locator('.face-state')).toContainText('❄ · ≈7 °C');
  await page.locator('.file-menu > summary').click();
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export scenario configuration', exact: true }).click();
  const download = await pending; await page.locator('input[type=file]').first().setInputFiles((await download.path())!);
  await valve.click(); await expect(page.getByLabel('Thermostat dial', { exact: true })).toHaveValue('0');
  await expect(page.getByLabel('Assigned Thermal Space', { exact: true })).not.toHaveValue('');
  await page.getByRole('button', { name: 'Advance 60 s', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Advance 60 s', exact: true })).toBeEnabled();
  await expect(valve.locator('.face-value')).toHaveText('0 % Kv');
  expect(errors).toEqual([]);
});

test('self-acting valve is available from the hydraulic component library', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'New empty experiment', exact: true }).click();
  await page.getByLabel('Search component library').fill('Thermostatic radiator valve');
  await page.locator('.library-component').filter({ hasText: 'Thermostatic radiator valve' }).click();
  await expect(page.locator('[data-component="thermostaticValve"]')).toHaveCount(1);
  await expect(page.getByLabel('Thermostat dial', { exact: true })).toHaveValue('3');
});
