import { test, expect, type Page } from '@playwright/test';
import { starter, serializeProject } from '../src/simulation/projects';
import { makeComponent, uid } from '../src/simulation/model';
import { examples } from '../src/simulation/learning';
import { openExample } from './learning-helpers';

async function advance(page: Page, seconds = 60) {
  if (seconds === 60) await page.getByRole('button', { name: 'Advance 60 s', exact: true }).click();
  else await page.getByLabel('Advance by', { exact: true }).selectOption(String(seconds));
  await expect(page.getByRole('button', { name: 'Advance 60 s', exact: true })).toBeEnabled({ timeout: 60000 });
}
async function add(page: Page, name: string) {
  await page.getByLabel('Search component library').fill(name);
  await page.locator('.library-component').filter({ has: page.getByText(name, { exact: true }) }).click();
  await page.getByLabel('Search component library').fill('');
}
for (const example of examples) test(`UI starter: ${example.title} runs, resets and reloads`, async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await openExample(page, example.title);
  if (['mechanism', 'rotor', 'descent', 'lift', 'rotation'].includes(example.mode)) await page.getByRole('button', { name: 'Physical view', exact: true }).click();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  if (example.mode === 'automated') { await advance(page, 600); await advance(page, 600); await advance(page, 600); }
  else if (example.mode === 'circulation' || example.mode === 'pressure') { for (let i = 0; i < (example.mode === 'circulation' ? 5 : 3); i++) await advance(page); }
  else await advance(page, example.mode === 'supply' ? 600 : 60);
  await page.getByRole('button', { name: 'Live telemetry', exact: true }).click();
  await expect(page.locator('.trace-readouts')).not.toContainText('invalid');
  const expected = {
    acRlc: ['AC-01 power', 90, 110], induction: ['IM-01 rpm', 1400, 1500], light: ['L-01 power', 20, 25], heat: ['TK-01 water', 22, 24], automated: ['TK-01 water', 77, 83], transfer: ['Delivery flow', 30, 60], pressure: ['Delivery pressure', 0.34, 0.36], supply: ['Destination level', 25, 96], circulation: ['Destination water', 40, 60], industrial: ['Hydraulic power', 500, 1200], exchanger: ['Recovered heat', 100000, 500000], mechanism: ['Spring position', 2, 5], rotor: ['Rotor speed', 100, 140], descent: ['Load height', 1, 1.1], lift: ['Lift height', 2.99, 3.01], rotation: ['Rotor speed', 124, 127],
  }[example.mode] as [string, number, number];
  const value = parseFloat(await page.locator('.trace-readouts label').filter({ hasText: new RegExp('^' + expected[0] + '\\s*[-0-9]') }).locator('strong').textContent() ?? 'NaN');
  expect(value).toBeGreaterThan(expected[1]); expect(value).toBeLessThan(expected[2]);
  await page.getByRole('button', { name: 'Event log', exact: true }).click();
  await expect(page.locator('.event-log')).not.toContainText('ERROR');
  await expect(page.locator('.event-log')).not.toContainText('protection tripped');
  const time = await page.locator('.simulation-clock strong').textContent();
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save project', exact: true }).click();
  const saved = await pending;
  await page.getByRole('button', { name: 'New empty experiment', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles((await saved.path())!);
  await expect(page.locator('.simulation-clock strong')).toHaveText(time!, { timeout: 60000 });
  await page.getByRole('button', { name: 'Reset simulation', exact: true }).click();
  await expect(page.locator('.simulation-clock strong')).toHaveText('00:00:00.00');
  expect(errors).toEqual([]);
});
test('pipe fluid sensor: select, trace, fault, clear, remove target and reload', async ({ page }) => {
  await page.goto('/'); await openExample(page, 'Heat on the move');
  await add(page, 'Temperature sensor');
  const target = page.getByLabel('Thermal target', { exact: true });
  const pipe = await target.locator('option').filter({ hasText: 'Pipe' }).first().getAttribute('value');
  expect(pipe).toBeTruthy(); await target.selectOption(pipe!);
  await page.getByLabel('Measured quantity', { exact: true }).selectOption('fluidTemperature');
  await page.getByRole('button', { name: /Add trace for TS-/ }).click();
  await advance(page, 10);
  await expect(page.locator('.primary-reading')).not.toContainText('—');
  await page.locator('summary').filter({ hasText: 'EXPERIMENT FAULTS' }).click();
  await page.getByLabel('Inject component fault').selectOption('sensorFault');
  await expect(page.locator('.primary-reading')).toContainText('—');
  await page.getByLabel('Inject component fault').selectOption('');
  await expect(page.locator('.primary-reading')).not.toContainText('—');
  await page.getByRole('button', { name: 'Reset simulation', exact: true }).click();
  await page.locator('[data-component="pipe"]').first().click();
  await page.getByRole('button', { name: 'Delete component', exact: true }).click();
  await page.locator('[data-component="sensor"]').click();
  await expect(target).toHaveValue('');
  await expect(page.locator('.primary-reading')).toContainText('—');
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save project', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles((await (await pending).path())!);
  await page.locator('[data-component="sensor"]').click();
  await expect(target).toHaveValue('');
});
test('induction supply trip explains startup and recovers with catalog variant', async ({ page }) => {
  await page.goto('/'); await openExample(page, 'Loaded induction motor');
  await page.locator('[data-component="source3"]').click();
  await page.getByLabel('Component variant', { exact: true }).selectOption('standard');
  await page.getByRole('button', { name: 'Single simulation step', exact: true }).click();
  await expect(page.locator('.inspector')).toContainText('RMS line');
  await expect(page.locator('.inspector')).toContainText('startup');
  await page.getByRole('button', { name: 'Reset simulation', exact: true }).click();
  await page.getByLabel('Component variant', { exact: true }).selectOption('industrial250');
  await advance(page, 10);
  await expect(page.locator('.inspector')).not.toContainText('Output protection tripped');
  await page.locator('[data-component="inductionMotor"]').click();
  const load = page.getByLabel('External shaft load', { exact: true });
  await load.fill('40'); await load.press('Enter'); await advance(page, 10);
  await page.getByRole('button', { name: 'Live telemetry', exact: true }).click();
  await expect(page.locator('.trace-readouts')).not.toContainText('invalid');
});

test('overflow is routed through real terminals; explicit level guards prevent filling overflow', async ({ page }) => {
  const p = starter('transfer'), dest = p.components.find(c => c.name === 'Destination tank')!;
  dest.props.volume = 119;
  const catchTank = makeComponent('tank', 800, 620, p.components);
  catchTank.props = { ...catchTank.props, capacity: 500, volume: 0, elevation: -1, surfaceArea: 1 };
  p.components.push(catchTank);
  const drain = makeComponent('pipe', 600, 620, p.components);
  drain.props = { ...drain.props, diameter: 0.05, length: 2, inventory: false };
  p.components.push(drain);
  p.probes = [{ id: uid(), name: 'Collected overflow level', component: catchTank.id, measurement: 'level', color: '#59b99b', visible: true }];
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({ name: 'overflow.physics.json', mimeType: 'application/json', buffer: Buffer.from(serializeProject(p)) });
  await page.getByRole('button', { name: 'Fit experiment', exact: true }).click();
  await page.locator(`[data-port="${dest.name}:overflow"]`).click();
  await page.locator(`[data-port="${drain.name}:inlet"]`).click();
  await page.locator(`[data-port="${drain.name}:outlet"]`).click();
  await page.locator(`[data-port="${catchTank.name}:fluid"]`).click();
  await expect(page.locator('.status-footer')).toContainText(`${p.connections.length + 2} connections`);
  await advance(page, 10);
  await page.getByRole('button', { name: 'Live telemetry', exact: true }).click();
  const collected = page.locator('.trace-readouts label').filter({ hasText: 'Collected overflow level' });
  await expect(collected).not.toContainText('0.00');
  await expect(collected).not.toContainText('invalid');
  await openExample(page, 'The self-filling tank');
  await advance(page, 600);
  // Guarded filling must stop the motor before the receiving vessel spills.
  await page.getByRole('button', { name: 'Event log', exact: true }).click();
  await expect(page.locator('.event-log')).not.toContainText('overflowing');
  await expect(page.locator('.event-log')).not.toContainText('ERROR');
});

test('shaft-speed sensor targets motor identity even with a static physical housing', async ({ page }) => {
  await page.goto('/'); await openExample(page, 'Spin up');
  await page.getByRole('button', { name: 'Schematic view', exact: true }).click();
  await add(page, 'Shaft speed sensor');
  const target = page.getByLabel('Physical target', { exact: true });
  const motor = await target.locator('option').filter({ hasText: 'DC motor' }).first().getAttribute('value');
  await target.selectOption(motor!);
  await advance(page, 10);
  expect(parseFloat(await page.locator('.primary-reading span').textContent() ?? 'NaN')).toBeGreaterThan(1000);
  await expect(page.locator('.primary-reading')).toContainText('RPM');
});

test('exchanger temperature and flow sensors select both modeled streams with SI units', async ({ page }) => {
  await page.goto('/'); await openExample(page, 'Heat exchanger lab');
  await add(page, 'Temperature sensor');
  const target = page.getByLabel('Thermal target', { exact: true });
  const exchanger = await target.locator('option').filter({ hasText: 'Heat exchanger' }).getAttribute('value');
  await target.selectOption(exchanger!);
  await page.getByLabel('Exchanger stream', { exact: true }).selectOption('cold');
  await advance(page, 10);
  const cold = parseFloat(await page.locator('.primary-reading span').textContent() ?? 'NaN');
  expect(cold).toBeGreaterThan(10); expect(cold).toBeLessThan(40);
  await page.getByRole('button', { name: 'Reset simulation', exact: true }).click();
  await page.getByLabel('Exchanger stream', { exact: true }).selectOption('hot');
  await advance(page, 10);
  expect(parseFloat(await page.locator('.primary-reading span').textContent() ?? 'NaN')).toBeGreaterThan(cold);
  await page.getByRole('button', { name: 'Reset simulation', exact: true }).click();
  await add(page, 'Flow sensor');
  const flowTarget = page.getByLabel('Physical target', { exact: true });
  await flowTarget.selectOption(exchanger!);
  await page.getByLabel('Exchanger stream', { exact: true }).selectOption('cold');
  await advance(page, 10);
  expect(parseFloat(await page.locator('.primary-reading span').textContent() ?? 'NaN')).toBeGreaterThan(0.005);
  await expect(page.locator('.primary-reading')).toContainText('m³/s');
});

test('zero-inventory pipe temperature stays unavailable until real flow establishes it', async ({ page }) => {
  const p = starter('transfer'), pipe = p.components.find(c => c.kind === 'pipe')!;
  pipe.props.inventory = false;
  const sensor = makeComponent('sensor', 40, 650, p.components);
  sensor.props.target = pipe.id; p.components.push(sensor);
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({ name: 'zero-inventory.physics.json', mimeType: 'application/json', buffer: Buffer.from(serializeProject(p)) });
  await page.getByRole('button', { name: 'Fit experiment', exact: true }).click();
  await page.locator('[data-component="sensor"]').click();
  await expect(page.locator('.primary-reading')).toContainText('—');
  await expect(page.locator('.inspector')).toContainText('unavailable');
  await advance(page, 10);
  await expect(page.locator('.primary-reading')).not.toContainText('—');
  await page.getByRole('button', { name: 'Reset simulation', exact: true }).click();
  await expect(page.locator('.primary-reading')).toContainText('—');
});
