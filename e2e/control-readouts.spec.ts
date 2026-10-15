import { test, expect } from '@playwright/test';

test('control faces reflect edited thermostat and hysteresis settings', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New empty experiment', exact: true }).click();
  const search = page.getByLabel('Search component library');
  await search.fill('Thermostat');
  await page.locator('.library-component').filter({ has: page.getByText('Thermostat', { exact: true }) }).click();
  for (const [label, value] of [['Setpoint', '21'], ['Hysteresis band', '0.5']]) {
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByLabel(label, { exact: true }).press('Enter');
  }
  const thermostat = page.locator('[data-component="thermostat"] .face-state');
  await expect(thermostat).toContainText('21 °C');
  await expect(thermostat).toContainText('0.5 K band');
  await expect(thermostat).not.toContainText('80');

  await search.fill('Hysteresis controller');
  await page.locator('.library-component').filter({ hasText: 'Hysteresis controller' }).click();
  for (const [label, value] of [['ON below', '20.5'], ['OFF at or above', '21']]) {
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByLabel(label, { exact: true }).press('Enter');
  }
  await expect(page.locator('[data-component="hysteresis"] .face-state')).toHaveText('20.5 / 21');
});
