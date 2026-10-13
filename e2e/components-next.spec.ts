import { test, expect } from '@playwright/test';
import { openExample } from './learning-helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).labTools = {};
    Object.defineProperty(document, 'modelContext', { value: { registerTool(tool: any) { (window as any).labTools[tool.name] = tool; } } });
  });
  await page.goto('/');
});
for (const [kind, title, label] of [
  ['electricBoiler', 'Bosch boiler and ALPHA2 heating loop', 'Manufacturer specifications'],
  ['panelRadiator', 'Bosch boiler, ALPHA2 and Kermi radiator', 'Manufacturer data (Kermi Technik)'],
  ['battery', 'Finite battery discharge', 'state of charge'],
  ['capacitor', 'Charging a capacitor', 'stored field energy'],
  ['inductor', 'Switching an inductor', 'stored field energy'],
  ['contactor', 'Powering a contactor', 'DC coil current'],
  ['transformer', 'Isolated AC conversion', 'secondary RMS voltage'],
  ['radiator', 'Cooling water with a fan', 'fan electrical power'],
  ['circulator', 'Circulating heat with an electric pump', 'Model basis'],
]) test(`${kind}: example runs, exposes real measurements and resets`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openExample(page, title);
  await expect(page.locator(`[data-component="${kind}"]`)).toHaveCount(1);
  await page.getByLabel('Advance by', { exact: true }).selectOption('1');
  await expect(page.getByRole('button', { name: 'Advance 60 s', exact: true })).toBeEnabled();
  await page.locator(`[data-component="${kind}"]`).click();
  await expect(page.locator('.inspector')).toContainText(label);
  const state = await page.evaluate(() => (window as any).labTools.read_lab_measurements.execute({}));
  expect(state.error).toBeNull(); expect(state.time).toBeCloseTo(1, 8);
  const readings = Object.values(state.readings) as any[];
  if (kind === 'electricBoiler') { await expect(page.getByTestId('boiler-status')).toContainText('Heating'); await expect(page.getByRole('img', { name: 'Boiler water, element and target temperature history' })).toBeVisible(); expect(readings.some(r => r.heatingPower > 2999)).toBe(true); }
  if (kind === 'panelRadiator') {
    await expect(page.getByTestId('panel-status')).toContainText('Heating the room');
    await expect(page.getByRole('img', { name: /EN 442 characteristic/ })).toBeVisible();
    await expect(page.getByTestId('panel-basis-fitted')).toContainText('Kermi Profil-K line');
    expect((Object.values(state.hydraulics.readings) as any[]).some(r => r.duty > 0 && r.supplyTemperature > r.returnTemperature)).toBe(true);
  }
  if (kind === 'battery') expect(state.devices.batteries[Object.keys(state.devices.batteries)[0]]).toBeLessThan(0.8);
  if (kind === 'capacitor') expect(Object.values(state.devices.capacitors)[0]).toBeCloseTo(12 * 10 / 11 * -Math.expm1(-1 / 0.9091), 3);
  // Steady winding current: 12 V through 10.01 Ω into 0.5 Ω ∥ 100 Ω, reached after 1 s ≈ 10 τ.
  if (kind === 'inductor') { const shunt = 0.5 * 100 / 100.5; expect(Object.values(state.devices.inductors)[0]).toBeCloseTo(12 * shunt / (10.01 + shunt) / 0.5, 3); }
  if (kind === 'contactor') expect(readings.some(r => r.coilCurrent > 0)).toBe(true);
  if (kind === 'transformer') expect(readings.some(r => r.secondaryVoltage > 23 && r.secondaryVoltage < 24)).toBe(true);
  if (kind === 'radiator') expect(readings.some(r => Math.abs(r.fanPower - 30) < 1e-8)).toBe(true);
  // On the soft-start ramp after 1 s: the electronics draw more than their standby power and stay within P1,max.
  if (kind === 'circulator') { expect(readings.some(r => r.power > 2.5 && r.power <= 34 + 1e-9)).toBe(true); await expect(page.getByTestId('eei-note')).toContainText('not an efficiency'); }
  await page.getByRole('button', { name: 'Reset simulation', exact: true }).click();
  const reset = await page.evaluate(() => (window as any).labTools.read_lab_measurements.execute({}));
  expect(reset.time).toBe(0); expect(reset.error).toBeNull(); expect(errors).toEqual([]);
});
