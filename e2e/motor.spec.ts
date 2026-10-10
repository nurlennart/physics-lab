import { test, expect, type Page } from '@playwright/test';
import { serializeProject } from '../src/simulation/projects';
import { Builder } from '../src/simulation/scaling-validation';
import { openExample } from './learning-helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).labTools = {};
    Object.defineProperty(document, 'modelContext', { value: { registerTool(tool: any) { (window as any).labTools[tool.name] = tool; } } });
  });
  await page.goto('/');
});
const read = (page: Page): Promise<any> => page.evaluate(() => (window as any).labTools.read_lab_measurements.execute({}));
const motorState = async (page: Page) => { const m = (await read(page)).motors; return m[Object.keys(m)[0]] as { omega: number; angle: number }; };
const rpm = async (page: Page) => (await motorState(page)).omega * 30 / Math.PI;
async function advance(page: Page, seconds: number) {
  if (seconds === 60) await page.getByRole('button', { name: 'Advance 60 s', exact: true }).click();
  else await page.getByLabel('Advance by', { exact: true }).selectOption(String(seconds));
  await expect(page.getByRole('button', { name: 'Advance 60 s', exact: true })).toBeEnabled({ timeout: 60000 });
}
async function contactor(page: Page, closed: boolean) {
  await page.locator('[data-component="inductionMotor"]').click();
  const toggle = page.getByRole('button', { name: 'Contactor closed', exact: true });
  if ((await toggle.getAttribute('aria-pressed')) !== String(closed)) await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', String(closed));
}

test('before Run the setup shows no operating values; after Run it does', async ({ page }) => {
  await openExample(page, 'Loaded induction motor');
  await expect(page.locator('.status-footer')).toContainText('Ready to run');
  await page.locator('[data-component="inductionMotor"]').click();
  await expect(page.getByTestId('not-started-hint')).toBeVisible();
  // Winding temperature (a state) stays visible; current and power (operating values) do not.
  await expect(page.locator('.primary-reading')).toContainText('°C');
  await expect(page.locator('.measurement-list')).toContainText('—');
  await expect(page.locator('.wire-chip')).toHaveCount(0);
  await advance(page, 10);
  await expect(page.getByTestId('not-started-hint')).toHaveCount(0);
  await expect(page.locator('.wire-chip').first()).toBeVisible();
  // Direct-on-line starting current is normal and is not reported as a rating violation.
  await page.getByRole('button', { name: 'Event log', exact: true }).click();
  await expect(page.locator('.event-log')).not.toContainText('rated current');
});

test('loaded motor: run, open contactor, decelerate to rest, stay stopped, restart', async ({ page }) => {
  await openExample(page, 'Loaded induction motor');
  await advance(page, 10);
  expect(await rpm(page)).toBeGreaterThan(1400);
  await contactor(page, false);
  await advance(page, 10);
  const stopped = await motorState(page);
  expect(stopped.omega).toBe(0);
  await advance(page, 10);
  const still = await motorState(page);
  expect(still.omega).toBe(0);
  expect(still.angle).toBe(stopped.angle); // the drawn rotor no longer turns
  await contactor(page, true);
  await advance(page, 10);
  expect(await rpm(page)).toBeGreaterThan(1400);
  const state = await read(page);
  expect(state.error).toBeNull();
});

test('zero-load coasting: speed decays without reversing', async ({ page }) => {
  await openExample(page, 'Loaded induction motor');
  await page.locator('[data-component="inductionMotor"]').click();
  const load = page.getByLabel('External shaft load', { exact: true });
  await load.fill('0'); await load.press('Enter');
  await advance(page, 10);
  const running = await rpm(page);
  await contactor(page, false);
  await advance(page, 10);
  const coasting = await rpm(page);
  expect(coasting).toBeGreaterThan(0);
  expect(coasting).toBeLessThan(running);
  await advance(page, 60);
  const later = await rpm(page);
  expect(later).toBeGreaterThan(0);
  expect(later).toBeLessThan(coasting);
});

function pumpProject(upstream: 'inlet' | 'outlet', restrained: boolean) {
  const b = new Builder();
  const pump = b.add('pump', { ratedSpeed: 157, ratedFlow: 0.02, shutoffHead: 25, efficiency: 0.8 }, 'standard', 'Pump');
  const high = b.add('tank', { capacity: 5000, volume: 4000, surfaceArea: 2, elevation: 6, loss: 0 }, 'standard', 'High tank'), low = b.add('tank', { capacity: 5000, volume: 500, surfaceArea: 2, loss: 0 }, 'standard', 'Low tank');
  const p1 = b.add('pipe', { diameter: 0.1, length: 5, inventory: false }), p2 = b.add('pipe', { diameter: 0.1, length: 5, inventory: false });
  const [into, outOf] = upstream === 'inlet' ? [high, low] : [low, high];
  b.wire(into, 'fluid', p1, 'inlet'); b.wire(p1, 'outlet', pump, 'inlet'); b.wire(pump, 'outlet', p2, 'inlet'); b.wire(p2, 'outlet', outOf, 'fluid');
  if (restrained) { const src = b.add('source3'), m = b.add('inductionMotor', { loadTorque: 20, enabled: false }); b.series(src, m); b.wire(m, 'shaft', pump, 'shaft'); }
  b.p.components.forEach((c, i) => { c.x = 80 + (i % 4) * 230; c.y = 80 + Math.floor(i / 4) * 230; });
  return b.p;
}
async function importProject(page: Page, p: ReturnType<typeof pumpProject>) {
  await page.locator('input[type=file]').first().setInputFiles({ name: 'pump.physics.json', mimeType: 'application/json', buffer: Buffer.from(serializeProject(p)) });
  await expect(page.locator('[data-component="pump"]')).toBeVisible();
}

test('elevation-driven flow through a stopped pump: free vs restrained shaft, reverse check', async ({ page }) => {
  await importProject(page, pumpProject('inlet', false));
  await advance(page, 10);
  await page.locator('[data-component="pump"]').click();
  await expect(page.getByTestId('pump-backdrive-note')).toContainText('Free shaft: its speed is not modelled');
  await expect(page.locator('[data-component="pump"]')).toContainText('free shaft');

  await importProject(page, pumpProject('inlet', true));
  await advance(page, 10);
  expect((await motorState(page)).omega).toBe(0);
  await page.locator('[data-component="pump"]').click();
  await expect(page.getByTestId('pump-backdrive-note')).toContainText('Coupled shaft');

  await importProject(page, pumpProject('outlet', false));
  await advance(page, 10);
  await page.locator('[data-component="pump"]').click();
  await expect(page.getByTestId('pump-check-note')).toContainText('Check closed, holding');
  await expect(page.getByTestId('pump-backdrive-note')).toHaveCount(0);
});
