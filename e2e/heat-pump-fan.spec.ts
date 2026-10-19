import { test, expect } from '@playwright/test';
import { openExample } from './learning-helpers';

test('heat pump: the outdoor fan turns while the compressor runs', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await openExample(page, 'Heat pump and underfloor heating');
  const fan = page.getByTestId('heat-pump-fan');
  await expect(fan).toHaveAttribute('data-airflow', '0.00'); // not started
  const advance = async () => {
    await page.getByRole('button', { name: 'Advance 60 s', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Advance 60 s', exact: true })).toBeEnabled({ timeout: 60000 });
  };
  const blade = () => fan.locator('path').first().getAttribute('transform');
  await advance();
  await expect(fan).toHaveAttribute('data-airflow', '0.00'); // 2 min power-on check: compressor and fan still
  await advance(); await advance();
  expect(Number(await fan.getAttribute('data-airflow'))).toBeGreaterThan(0.3);
  const before = await blade();
  await advance();
  expect(await blade()).not.toBe(before);
  expect(errors).toEqual([]);
});
