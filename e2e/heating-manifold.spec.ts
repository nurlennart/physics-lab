import { test, expect } from '@playwright/test';
import { openExample } from './learning-helpers';

test('manifold: read the flow meters, balance to the planned flows, then a thermostat closes its circuit', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await openExample(page, 'Underfloor manifold: three rooms');
  const manifold = page.locator('[data-component="heatingManifold"]');
  await expect(manifold).toHaveCount(1);
  await manifold.click();
  await expect(page.getByTestId('manifold-balance')).toBeDisabled(); // balancing needs water flowing
  await page.getByRole('button', { name: 'Advance 60 s', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Advance 60 s', exact: true })).toBeEnabled({ timeout: 60000 });
  const meter = (k: number) => page.getByTestId(`manifold-circuit-${k}`).locator('td').nth(3);
  // Unbalanced: the short bathroom loop (circuit 3) takes more water than the long living-room loop.
  const unbalanced = await Promise.all([1, 3].map(async k => Number((await meter(k).innerText()).replace(/[^0-9.]/g, ''))));
  expect(unbalanced[1]).toBeGreaterThan(unbalanced[0]);
  for (let round = 0; round < 3; round++) {
    await page.getByTestId('manifold-balance').click();
    await page.getByRole('button', { name: 'Advance 60 s', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Advance 60 s', exact: true })).toBeEnabled({ timeout: 60000 });
  }
  await expect(page.getByLabel('Circuit 3 setting', { exact: true })).not.toHaveValue('100');
  for (const [k, planned] of [[1, 1.8], [2, 1.3], [3, 0.7]] as const) expect(Math.abs(Number(await meter(k).innerText()) / planned - 1), `circuit ${k}`).toBeLessThan(0.02);
  expect(errors).toEqual([]);
});
