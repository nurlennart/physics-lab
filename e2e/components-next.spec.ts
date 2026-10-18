import { test, expect } from '@playwright/test';
import { openExample } from './learning-helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).labTools = {};
    Object.defineProperty(document, 'modelContext', { value: { registerTool(tool: any) { (window as any).labTools[tool.name] = tool; } } });
  });
  await page.goto('/');
});
test('off-grid MPPT resumes after night through live Inspector edits', async ({ page }) => {
  await openExample(page, 'Off-grid solar system');
  await page.locator('[data-component="solarPanel"]').click();
  const irradiance = page.getByLabel('Irradiance', { exact: true });
  await irradiance.fill('0'); await irradiance.press('Enter');
  await page.getByLabel('Advance by', { exact: true }).selectOption('1');
  await expect(page.getByRole('button', { name: 'Advance 60 s', exact: true })).toBeEnabled();
  const night = await page.evaluate(() => (window as any).labTools.read_lab_measurements.execute({}));
  expect(night.error).toBeNull();
  expect((Object.values(night.readings) as any[]).some(r => r.solar?.mode === 'insufficient PV voltage')).toBe(true);
  await irradiance.fill('1000'); await irradiance.press('Enter');
  await page.getByLabel('Advance by', { exact: true }).selectOption('1');
  await expect(page.getByRole('button', { name: 'Advance 60 s', exact: true })).toBeEnabled();
  const day = await page.evaluate(() => (window as any).labTools.read_lab_measurements.execute({}));
  expect(day.error).toBeNull(); expect(day.time).toBeCloseTo(2, 8);
  expect((Object.values(day.readings) as any[]).some(r => r.solar?.mode === 'bulk' && r.solar.outputPower > 200)).toBe(true);
});
for (const [kind, title, label] of [
  ['gridInverter', 'Grid-tied solar inverter', 'Grid & conversion state'],
  ['hybridInverter', 'Grid-connected hybrid storage', 'grid-connected reserve'],
  ['gridMeter', 'Grid-connected hybrid storage', 'Wh imported'],
  ['solarPanel', 'Basic solar charging', 'Model provenance & limitations'],
  ['lfpBattery', 'Basic solar charging', 'state of charge'],
  ['mpptController', 'Basic solar charging', 'MPP tracking efficiency'],
  ['inverter', 'Off-grid solar system', 'DC/AC Inverter'],
  ['batteryProtection', 'Off-grid solar system', 'conducting'],
  ['electricBoiler', 'Bosch boiler and ALPHA2 heating loop', 'Manufacturer specifications'],
  ['panelRadiator', 'Bosch boiler, ALPHA2 and Kermi radiator', 'Manufacturer data (Kermi Technik)'],
  ['heatPump', 'Heat pump and underfloor heating', 'Bosch Compress 6800i AW 7 OR-S'],
  ['underfloorHeating', 'Heat pump and underfloor heating', 'Manufacturer data (FLOORTEC)'],
  ['storageTank', 'Sealed boiler circuit: expansion vessel and safety valve', 'Stratified storage tank'],
  ['expansionVessel', 'Sealed boiler circuit: expansion vessel and safety valve', 'Membrane expansion vessel'],
  ['safetyValve', 'Sealed boiler circuit: expansion vessel and safety valve', 'Safety valve · 3.0 bar'],
  ['divertingValve', 'Heat pump and underfloor heating', 'position (0 % = A, 100 % = B)'],
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
  // Bosch: 2-minute power-on check; meanwhile 15 W controls and the 75 W crankcase heater on a cold compressor shell.
  if (kind === 'heatPump') {
    await expect(page.getByTestId('heat-pump-status')).toContainText('Power-on check');
    await expect(page.getByRole('img', { name: /Heat pump flow, return and target temperature/ })).toBeVisible();
    await expect(page.getByTestId('heat-pump-section')).toContainText('Model basis');
    // Collapsed panels mount (and compute) nothing; opening mounts the cached tables, closing unmounts them again.
    await expect(page.getByTestId('heat-pump-reference')).toHaveCount(0); await expect(page.getByTestId('heat-pump-characteristic')).toHaveCount(0);
    await page.getByTestId('heat-pump-basis-panel').locator('summary').click(); await expect(page.getByTestId('heat-pump-reference')).toContainText('A7/W35 maximum');
    await page.getByTestId('heat-pump-characteristic-panel').locator('summary').click(); await expect(page.getByTestId('heat-pump-characteristic')).toContainText('A-7');
    await page.getByTestId('heat-pump-basis-panel').locator('summary').click(); await expect(page.getByTestId('heat-pump-reference')).toHaveCount(0);
    expect(readings.some(r => Math.abs(r.compressorPower - 90) < 1e-6)).toBe(true);
  }
  if (kind === 'storageTank') {
    await expect(page.getByRole('img', { name: /Temperature profile over the height of the tank/ })).toBeVisible();
    await expect(page.getByTestId('storage-basis-manufacturer')).toContainText('BH 120-5 1 B');
  }
  // During the heat pump's power-on check the 27 °C screed heats the house on its own stored heat.
  if (kind === 'underfloorHeating') {
    await expect(page.getByTestId('underfloor-status')).toContainText('W to the 20.0 °C room');
    await expect(page.getByRole('img', { name: /EN 1264 characteristic/ })).toBeVisible();
    await expect(page.getByTestId('underfloor-basis-fitted')).toContainText('6.754');
    expect((Object.values(state.hydraulics.readings) as any[]).some(r => r.duty > 1000 && r.downwardLoss > 0 && r.screedTemperature > 300)).toBe(true);
  }
  if (kind === 'expansionVessel') {
    await expect(page.getByTestId('vessel-status')).toContainText('bar');
    await expect(page.getByRole('img', { name: /Cushion pressure versus water-side volume/ })).toBeVisible();
    expect((Object.values(state.hydraulics.readings) as any[]).some(r => r.pressure > 1.79e5 && r.pressure < 1.9e5)).toBe(true);
  }
  if (kind === 'safetyValve') await expect(page.getByTestId('valve-status')).toContainText('Closed');
  if (kind === 'panelRadiator') {
    await expect(page.getByTestId('panel-status')).toContainText('Heating the room');
    await expect(page.getByRole('img', { name: /EN 442 characteristic/ })).toBeVisible();
    await expect(page.getByTestId('panel-basis-fitted')).toContainText('Kermi Profil-K line');
    expect((Object.values(state.hydraulics.readings) as any[]).some(r => r.duty > 0 && r.supplyTemperature > r.returnTemperature)).toBe(true);
  }
  if (kind === 'solarPanel') { await expect(page.getByRole('img', { name: 'PV I-V and P-V curves with operating point and maximum power point' })).toBeVisible(); expect(readings.some(r => r.solar?.outputPower > 200)).toBe(true); }
  if (kind === 'inverter') expect(readings.some(r => r.solar?.inputPower > 100 && r.solar?.outputPower === 100)).toBe(true);
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

test('hybrid isolates the utility during an outage and restores synchronized transfer', async ({ page }) => {
  await openExample(page, 'Grid outage and backup');
  await page.getByLabel('Advance by', { exact: true }).selectOption('1');
  await expect(page.getByRole('button', { name: 'Advance 60 s', exact: true })).toBeEnabled();
  await page.locator('[data-component="sourceAC"]').click();
  await page.getByLabel('Enabled', { exact: true }).click();
  await page.getByLabel('Advance by', { exact: true }).selectOption('1');
  await expect(page.getByRole('button', { name: 'Advance 60 s', exact: true })).toBeEnabled();
  const off = await page.evaluate(() => (window as any).labTools.read_lab_measurements.execute({}));
  expect(off.error).toBeNull();
  expect((Object.values(off.readings) as any[]).some(r => r.hybrid?.backupAvailable && !r.hybrid.connected)).toBe(true);
  await page.getByLabel('Enabled', { exact: true }).click();
  await page.getByLabel('Advance by', { exact: true }).selectOption('1');
  await expect(page.getByRole('button', { name: 'Advance 60 s', exact: true })).toBeEnabled();
  const restored = await page.evaluate(() => (window as any).labTools.read_lab_measurements.execute({}));
  expect(restored.error).toBeNull();
  expect((Object.values(restored.readings) as any[]).some(r => r.hybrid?.connected && r.hybrid.backupAvailable)).toBe(true);
  const csv = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  expect((await csv).suggestedFilename()).toContain('measurements.csv');
});
