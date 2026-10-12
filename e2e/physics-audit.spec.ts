import { test, expect } from '@playwright/test';
import { Builder } from '../src/simulation/scaling-validation';
import { serializeProject } from '../src/simulation/projects';

test('DC capacitor and AC normally closed contact display physical currents and powers', async ({ page }) => {
  const b = new Builder(), dc = b.add('source', { voltage: 24 }), cap = b.add('capacitor'), dcLoad = b.add('resistor', { resistance: 10 });
  b.series(dc, cap, dcLoad);
  const ac = b.add('sourceAC', { voltage: 24 }), relay = b.add('relay', { resistance: 0.1 }), acLoad = b.add('resistor', { resistance: 10 });
  b.wire(ac, 'a', relay, 'a'); b.wire(relay, 'nc', acLoad, 'a'); b.wire(acLoad, 'b', ac, 'b');
  b.p.probes = [
    { id: 'leakage', name: 'Capacitor leakage', component: cap.id, measurement: 'current', color: '#59b99b', visible: true },
    { id: 'contact', name: 'NC contact heat', component: relay.id, measurement: 'power', color: '#ef9975', visible: true },
  ];
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({ name: 'audit.physics.json', mimeType: 'application/json', buffer: Buffer.from(serializeProject(b.p)) });
  await page.getByRole('button', { name: 'Advance 60 s', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Advance 60 s', exact: true })).toBeEnabled();
  await expect(page.locator('.solver-error')).toHaveCount(0);
  await page.getByRole('button', { name: 'Live telemetry', exact: true }).click();
  const leakage = parseFloat(await page.locator('.trace-readouts label').filter({ hasText: 'Capacitor leakage' }).locator('strong').textContent() ?? 'NaN');
  const heat = parseFloat(await page.locator('.trace-readouts label').filter({ hasText: 'NC contact heat' }).locator('strong').textContent() ?? 'NaN');
  expect(leakage).toBeCloseTo(24 / (1e9 + 10), 11);
  expect(heat).toBeCloseTo((24 / 10.1) ** 2 * 0.1, 2);
});

test('induction power loss coasts, recovers and survives save/load', async ({ page }) => {
  const { openExample } = await import('./learning-helpers');
  await page.goto('/'); await openExample(page, 'Loaded induction motor');
  const advance = async () => {
    await page.getByLabel('Advance by', { exact: true }).selectOption('10');
    await expect(page.getByRole('button', { name: 'Advance 60 s', exact: true })).toBeEnabled({ timeout: 60000 });
  };
  await advance();
  await page.locator('[data-component="inductionMotor"]').click();
  await page.locator('summary').filter({ hasText: 'Experiment faults' }).click();
  await page.getByLabel('Inject component fault').selectOption('powerLoss');
  await advance();
  await expect(page.locator('.solver-error')).toHaveCount(0);
  await page.getByRole('button', { name: 'Live telemetry', exact: true }).click();
  const speed = page.locator('.trace-readouts label').filter({ hasText: /^IM-01 rpm\s*[-0-9]/ }).locator('strong');
  expect(Math.abs(parseFloat(await speed.textContent() ?? 'NaN'))).toBeLessThan(1);
  await page.getByLabel('Inject component fault').selectOption('');
  await advance();
  await expect(page.locator('.solver-error')).toHaveCount(0);
  const rpm = parseFloat(await speed.textContent() ?? 'NaN');
  expect(rpm).toBeGreaterThan(1400);
  await page.locator('[data-component="source3"]').click();
  const output = page.getByRole('button', { name: 'Output enabled', exact: true });
  await expect(output).toHaveAttribute('aria-pressed', 'true');
  await output.click();
  await expect(output).toHaveAttribute('aria-pressed', 'false');
  await advance();
  await expect(page.locator('.solver-error')).toHaveCount(0);
  expect(Math.abs(parseFloat(await speed.textContent() ?? 'NaN'))).toBeLessThan(1);
  await output.click();
  await expect(output).toHaveAttribute('aria-pressed', 'true');
  await advance();
  expect(parseFloat(await speed.textContent() ?? 'NaN')).toBeGreaterThan(1400);
  const time = await page.locator('.simulation-clock strong').textContent();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  const path = await (await pending).path();
  await page.getByRole('button', { name: 'New empty experiment', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles(path!);
  await expect(page.locator('.simulation-clock strong')).toHaveText(time!, { timeout: 60000 });
  await expect(page.locator('.solver-error')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reset simulation', exact: true }).click();
  await expect(page.locator('.simulation-clock strong')).toHaveText('00:00:00.00');
});

test('supplied blank configuration loads, advances, saves and resets', async ({ page }) => {
  const { resolve } = await import('node:path');
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles(resolve('examples/blank.physics.json'));
  await page.getByRole('button', { name: 'Advance 60 s', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Advance 60 s', exact: true })).toBeEnabled();
  await expect(page.locator('.solver-error')).toHaveCount(0);
  const time = await page.locator('.simulation-clock strong').textContent();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles((await (await pending).path())!);
  await expect(page.locator('.simulation-clock strong')).toHaveText(time!);
  await page.getByRole('button', { name: 'Reset simulation', exact: true }).click();
  await expect(page.locator('.simulation-clock strong')).toHaveText('00:00:00.00');
});
