import { openExample, addMissionEquipment } from "./learning-helpers";
import { test, expect, type Page } from '@playwright/test';
import { hydraulicStarter } from '../src/simulation/hydraulic-projects';
import { serializeProject } from '../src/simulation/projects';
async function importExperiment(page: Page, mode: Parameters<typeof hydraulicStarter>[0], challenge = false) {
  const p = hydraulicStarter(mode); if (challenge && mode !== 'circulation') p.challenge = mode;
  await page.locator('input[type=file]').setInputFiles({ name: 'hydraulic.physics.json', mimeType: 'application/json', buffer: Buffer.from(serializeProject(p)) });
  await expect(page.locator('[data-component="pump"]')).toBeVisible();
  return p;
}
async function advance(page: Page, seconds: number) {
  return page.evaluate(async seconds => {
    const tool = (window as any).hydraulicTools.advance_lab_simulation;
    return await tool.execute({ seconds });
  }, seconds);
}
async function read(page: Page): Promise<any> {
  return page.evaluate(() => (window as any).hydraulicTools.read_lab_measurements.execute({}));
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).hydraulicTools = {};
    Object.defineProperty(document, 'modelContext', { value: { registerTool(tool: any) { (window as any).hydraulicTools[tool.name] = tool; } } });
  });
  await page.goto('/');
});
test('industrial pumping starter exposes larger motors and calculates uphill flow and shaft work', async ({ page }) => {
  await page.getByLabel('Search component library').fill('traction');
  await expect(page.locator('.library-component').filter({ hasText: 'DC motor' })).toBeVisible();
  await page.getByLabel('Search component library').fill('');
  await openExample(page, 'Industrial pumping station');
  await page.locator('[data-component="motor"]').click();
  await expect(page.getByLabel('Component variant')).toHaveValue('industrial180');
  await expect(page.getByLabel('Component variant').locator('option')).toHaveCount(4);
  await advance(page, 10);
  const state = await read(page), pump = Object.values(state.hydraulics.readings).find((r: any) => r.hydraulicPower > 500) as any;
  expect(state.error).toBeNull(); expect(pump).toBeDefined(); expect(pump.flow * 60000).toBeGreaterThan(100);
  expect(pump.shaftPower).toBeGreaterThanOrEqual(pump.hydraulicPower);
  expect(Math.abs(state.massResidualKg)).toBeLessThan(1e-6);
  await expect(page.getByLabel('Component variant')).toBeDisabled();
  await page.screenshot({ path: '/tmp/physics-industrial-pumping.png' });
});
test('hydraulic starter transfers finite inventory, exposes probes, valve response and fault coasting', async ({ page }) => {
  const p = await importExperiment(page, 'transfer');
  const motor = p.components.find(c => c.kind === 'motor')!, valve = p.components.find(c => c.kind === 'valve')!, tanks = p.components.filter(c => c.kind === 'tank');
  await advance(page, 3); const before = await read(page);
  expect(before.error).toBeNull(); expect(before.tanks[tanks[0].id].mass).toBeLessThan(150); expect(before.tanks[tanks[1].id].mass).toBeGreaterThan(0);
  expect(Math.abs(before.massResidualKg)).toBeLessThan(1e-6);
  await page.locator('[data-component="valve"]').click();
  await page.getByLabel('Valve opening', { exact: true }).fill('5'); await page.getByLabel('Valve opening', { exact: true }).press('Enter');
  await advance(page, 2); const after = await read(page);
  expect(after.hydraulics.readings[valve.id].flow).toBeLessThan(before.hydraulics.readings[valve.id].flow);
  await page.locator('[data-component="pump"]').click(); await expect(page.getByRole('img', { name: /Pump head/ })).toBeVisible();
  await page.locator('[data-component="motor"]').click();
  await page.locator('summary').filter({ hasText: 'Experiment faults' }).click();
  await page.getByLabel('Inject component fault').selectOption('powerLoss');
  await page.getByRole('button', { name: 'Single simulation step' }).click();
  const coast = await read(page); expect(coast.motors[motor.id].omega).toBeGreaterThan(0); expect(coast.motors[motor.id].current).toBe(0);
  await page.getByRole('button', { name: 'Energy balance' }).click(); await expect(page.locator('.energy-panel')).toContainText('Mass residual');
  await page.screenshot({ path: '/tmp/phase2b-hydraulic-workspace.png' });
});
test('saving a live hydraulic experiment restores fluid, motor and fault state', async ({ page }) => {
  await importExperiment(page, 'transfer'); await advance(page, 2); const before = await read(page);
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save project', exact: true }).click(); const file = await download;
  await page.getByRole('button', { name: 'New empty experiment' }).click();
  await page.locator('input[type=file]').setInputFiles((await file.path())!);
  await expect(page.getByRole('status')).toContainText('restored');
  const after = await read(page); expect(after.time).toBe(before.time); expect(after.tanks).toEqual(before.tanks); expect(after.motors).toEqual(before.motors);
  await page.getByRole('button', { name: /Event log/ }).click(); await page.getByRole('button', { name: 'Replay experiment' }).click();
  await expect(page.locator('.event-log')).toContainText('restored by deterministic replay');
});
test('challenge 004 is playable through real hydraulic, shaft and electrical terminal wiring', { tag: '@slow' }, async ({ page }) => {
  test.setTimeout(180000);
  await page.getByRole('button', { name: /Challenges/ }).click(); await page.getByRole('button', { name: 'Start assignment' }).nth(3).click();
  await addMissionEquipment(page, 'transfer');
  for (const [from, to] of [['PS-01:a', 'M-01:a'], ['M-01:b', 'PS-01:b'], ['M-01:shaft', 'P-01:shaft'], ['Source reservoir:fluid', 'P-01:inlet'], ['P-01:outlet', 'PL-01:inlet'], ['PL-01:outlet', 'V-01:inlet'], ['V-01:outlet', 'Destination tank:fluid']]) {
    await page.locator(`[data-port="${from}"]`).click(); if (to === 'Destination tank:fluid') await page.locator(`[data-port="${to}"]`).press('Enter');
    else await page.locator(`[data-port="${to}"]`).click();
  }
  await advance(page, 180); await expect(page.locator('.challenge-strip')).toContainText('stars');
  const state = await read(page); expect(state.error).toBeNull(); expect(Math.abs(state.energyResidualJ)).toBeLessThan(0.5);
});
// The supply assignment's 720 s completion is the same engine computation as `scripts/check-scores.mjs`, which
// checks its completion time and score exactly; the browser path (import, scored advance, challenge strip) is
// exercised here with the pressure assignment.
for (const mode of ['pressure'] as const) test(`challenge ${mode} completes under actual demand and sensor-fault conditions`, { tag: '@slow' }, async ({ page }) => {
  test.setTimeout(240000);
  await importExperiment(page, mode, true);
  await advance(page, 195);
  await expect(page.locator('.challenge-strip')).toContainText('stars');
  const state = await read(page); expect(state.error).toBeNull(); expect(Math.abs(state.massResidualKg)).toBeLessThan(1e-6);
});
