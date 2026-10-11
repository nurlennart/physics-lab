import { test, expect, type Page } from '@playwright/test';
import { mechanicalStarter } from '../src/simulation/spatial-projects';
import { serializeProject, starter } from '../src/simulation/projects';
import { physicalKinds } from '../src/simulation/spatial-model';
async function advance(page: Page, seconds: number) { return page.evaluate(async seconds => (window as any).spatialTools.advance_lab_simulation.execute({ seconds }), seconds); }
async function read(page: Page): Promise<any> { return page.evaluate(() => (window as any).spatialTools.read_lab_measurements.execute({})); }
async function load(page: Page, mode: Parameters<typeof mechanicalStarter>[0], challenge = false) { const p = mechanicalStarter(mode); if (challenge && ['descent', 'lift', 'rotation'].includes(mode)) p.challenge = mode as 'descent' | 'lift' | 'rotation'; await page.locator('input[type=file]').setInputFiles({ name: 'mechanical.physics.json', mimeType: 'application/json', buffer: Buffer.from(serializeProject(p)) }); await expect(page.getByLabel('Physical world canvas')).toBeVisible(); return p; }
test.beforeEach(async ({ page }) => { await page.addInitScript(() => { (window as any).spatialTools = {}; Object.defineProperty(document, 'modelContext', { value: { registerTool(t: any) { (window as any).spatialTools[t.name] = t; } } }); }); await page.goto('/'); });
test('schematic sandbox equipment appears automatically, keeps placement and shares new additions', async ({ page }) => {
  const p = starter('heat'), equipment = p.components.filter(c => physicalKinds.has(c.kind));
  await page.locator('input[type=file]').setInputFiles({ name: 'sandbox.physics.json', mimeType: 'application/json', buffer: Buffer.from(serializeProject(p)) });
  // Leave one schematic component selected: entering Physical must fit all equipment.
  await page.locator('[data-component="tank"]').click();
  await page.getByRole('button', { name: 'Physical view', exact: true }).click();
  await expect(page.locator('[data-physical-body]')).toHaveCount(equipment.length);
  const canvas = (await page.getByLabel('Physical world canvas').boundingBox())!;
  for (const c of equipment) {
    const body = page.locator(`[data-physical-body="${c.id}"]`);
    await expect(body).toBeVisible();
    const bounds = (await body.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(canvas.x);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(canvas.x + canvas.width);
  }
  const tank = p.components.find(c => c.kind === 'tank')!;
  await page.locator(`[data-physical-body="${tank.id}"]`).click();
  await page.getByLabel('World X', { exact: true }).fill('15'); await page.getByLabel('World X', { exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Schematic view', exact: true }).click();
  await page.locator('.library-component').filter({ has: page.getByText('DC motor', { exact: true }) }).click();
  await page.getByRole('button', { name: 'Physical view', exact: true }).click();
  await expect(page.locator('[data-physical-body]')).toHaveCount(equipment.length + 1);
  await page.locator(`[data-physical-body="${tank.id}"]`).click();
  await expect(page.getByLabel('World X', { exact: true })).toHaveValue('15');
  await advance(page, 1); const live = await read(page);
  expect(live.error).toBeNull();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save project', exact: true }).click();
  const file = await download;
  await page.getByRole('button', { name: 'New empty experiment' }).click();
  await page.locator('input[type=file]').setInputFiles((await file.path())!);
  await expect(page.locator('[data-physical-body]')).toHaveCount(equipment.length + 1);
  expect(await read(page)).toEqual(live);
  await page.locator(`[data-physical-body="${tank.id}"]`).click();
  await expect(page.getByLabel('World X', { exact: true })).toHaveValue('15');
});
test('running schematic equipment remains visible without changing time or live solver state', async ({ page }) => {
  await advance(page, 2); const before = await read(page);
  await page.getByRole('button', { name: 'Physical view', exact: true }).click();
  await expect(page.locator('[data-equipment-preview]')).not.toHaveCount(0);
  expect(await read(page)).toEqual(before);
  await page.getByRole('button', { name: 'Reset simulation', exact: true }).click();
  await expect(page.locator('[data-equipment-preview]')).toHaveCount(0);
  expect((await read(page)).time).toBe(0);
  await page.locator('[data-physical-body]').first().click();
  await expect(page.getByLabel('World X', { exact: true })).toBeEnabled();
});
test('viewing hydraulic challenge equipment preserves locked geometry and challenge physics', async ({ page }) => {
  const p = starter('transfer', true), count = p.components.filter(c => physicalKinds.has(c.kind)).length;
  await page.locator('input[type=file]').setInputFiles({ name: 'challenge.physics.json', mimeType: 'application/json', buffer: Buffer.from(serializeProject(p)) });
  const before = await read(page);
  await page.getByRole('button', { name: 'Physical view', exact: true }).click();
  await expect(page.locator('[data-equipment-preview]')).toHaveCount(count);
  expect(await read(page)).toEqual(before);
  await advance(page, 1); expect((await read(page)).error).toBeNull();
});
test('constructs, transforms, duplicates and undoes spatial geometry', async ({ page }) => {
  await page.getByRole('button', { name: 'New empty experiment' }).click();
  await page.getByRole('button', { name: 'Physical view', exact: true }).click();
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await expect(page.locator('[data-physical-body]')).toHaveCount(1);
  await page.getByLabel('Physical material').selectOption('rubber');
  await page.getByLabel('World X', { exact: true }).fill('2'); await page.getByLabel('World X', { exact: true }).press('Enter');
  await page.getByLabel('Width', { exact: true }).fill('0.5'); await page.getByLabel('Width', { exact: true }).press('Enter');
  await page.getByLabel('Rotate physical selection', { exact: true }).click();
  await expect(page.getByLabel('Rotation', { exact: true })).toHaveValue('14.999999999999998');
  await page.getByLabel('Duplicate physical selection', { exact: true }).click(); await expect(page.locator('[data-physical-body]')).toHaveCount(2);
  await page.keyboard.press('Control+z'); await expect(page.locator('[data-physical-body]')).toHaveCount(1);
  await page.keyboard.press('Space'); expect((await read(page)).time).toBe(0);
  await advance(page, 1); const state = await read(page); expect(Object.values(state.spatial.bodies).every((b: any) => b.vy < -9)).toBe(true);
  // The body has fallen freely; re-fit the view so it is not under the telemetry panel.
  await page.getByLabel('Fit physical world or selection').click();
  await page.locator('[data-physical-body]').click(); await expect(page.getByLabel('Width', { exact: true })).toBeDisabled();
});
test('physical and schematic views preserve shared motor, body, thermal and replay state', async ({ page }) => {
  const p = await load(page, 'rotor'), motor = p.components.find(c => c.kind === 'motor')!, rotor = p.components.find(c => c.name === 'Driven rotor')!;
  await advance(page, 3); const before = await read(page);
  expect(before.spatial.bodies[rotor.id].omega).toBe(before.motors[motor.id].omega);
  await page.locator(`[data-physical-body="${motor.id}"]`).click(); await expect(page.locator('.physical-readings')).toContainText('Shared shaft');
  await page.getByRole('button', { name: 'Schematic view', exact: true }).click(); await expect(page.locator('[data-component="motor"]')).toBeVisible();
  expect((await read(page)).time).toBe(before.time);
  await page.getByRole('button', { name: 'Physical view', exact: true }).click(); expect((await read(page)).spatial.bodies).toEqual(before.spatial.bodies);
  await page.locator(`[data-physical-body="${rotor.id}"]`).click();
  await page.getByLabel('Angular impulse', { exact: true }).fill('0.3'); await page.getByLabel('Angular impulse', { exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Apply accounted impulse' }).click(); await advance(page, 1); const live = await read(page);
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save project', exact: true }).click(); const file = await download;
  await page.getByRole('button', { name: 'New empty experiment' }).click(); await page.locator('input[type=file]').setInputFiles((await file.path())!); await expect(page.getByRole('status')).toContainText('restored', { timeout: 30000 });
  expect((await read(page)).spatial.bodies).toEqual(live.spatial.bodies);
  await page.screenshot({ path: '/tmp/phase3a-physical-rotor.png' });
});
test('constructs a hinge with world anchors, inspects limits and undoes deletion', async ({ page }) => {
  await page.getByRole('button', { name: 'New empty experiment' }).click(); await page.getByRole('button', { name: 'Physical view', exact: true }).click();
  await page.getByRole('button', { name: 'Floor', exact: true }).click(); await page.getByRole('button', { name: 'Beam', exact: true }).click();
  const beam = page.locator('[data-physical-body]').last(), floor = page.locator('[data-physical-body]').first();
  await beam.locator('rect').first().click(); await floor.locator('rect').first().click({ modifiers: ['Shift'] }); await page.getByRole('button', { name: 'Revolute', exact: true }).click();
  const box = (await beam.boundingBox())!; await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('[data-physical-joint]')).toHaveCount(1); await expect(page.locator('.physical-inspector')).toContainText('Revolute constraint');
  await page.getByLabel('Delete physical selection', { exact: true }).click(); await expect(page.locator('[data-physical-joint]')).toHaveCount(0); await page.keyboard.press('Control+z'); await expect(page.locator('[data-physical-joint]')).toHaveCount(1);
  await advance(page, 1); expect((await read(page)).error).toBeNull();
});
for (const mode of ['descent', 'lift', 'rotation'] as const) test(`mechanical assignment ${mode} scores real dynamics`, { tag: '@slow' }, async ({ page }) => { test.setTimeout(180000); await load(page, mode, true); await advance(page, mode === 'rotation' ? 70 : 60); await expect(page.locator('.challenge-strip')).toContainText('stars'); const state = await read(page); expect(state.error).toBeNull(); });
