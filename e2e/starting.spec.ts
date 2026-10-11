import { test, expect, type Page } from '@playwright/test';
import { openExample } from './learning-helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).labTools = {};
    Object.defineProperty(document, 'modelContext', { value: { registerTool(tool: any) { (window as any).labTools[tool.name] = tool; } } });
  });
  await page.goto('/');
});
async function advance(page: Page, seconds: number) {
  await page.getByLabel('Advance by', { exact: true }).selectOption(String(seconds));
  await expect(page.getByRole('button', { name: 'Advance 60 s', exact: true })).toBeEnabled({ timeout: 60000 });
}
const select = (page: Page, kind: string) => page.locator(`[data-component="${kind}"]`).first().click();

test('starting a motor three ways: star-delta, soft starter and drive through the UI', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openExample(page, 'Starting a motor three ways');
  await expect(page.locator('[data-component="vfd"]')).toHaveCount(1);
  await advance(page, 1);
  // One second in: star-delta still in star, soft starter ramping, drive accelerating.
  await select(page, 'starDeltaStarter');
  await expect(page.getByTestId('starter-note')).toContainText('Star: windings at V/√3');
  await select(page, 'softStarter');
  await expect(page.getByTestId('starter-note')).toContainText(/Ramping — target \d+ % of line voltage/);
  await select(page, 'vfd');
  await expect(page.getByTestId('drive-note')).toContainText(/Output \d+\.\d\d Hz/);
  await advance(page, 10);
  await select(page, 'starDeltaStarter');
  await expect(page.getByTestId('starter-note')).toContainText('Delta: full voltage');
  await select(page, 'softStarter');
  await expect(page.getByTestId('starter-note')).toContainText('Bypass contactor closed');
  await select(page, 'vfd');
  await expect(page.getByTestId('drive-note')).toContainText('Output 50.00 Hz · 400 V');
  // All three motors at full speed against the same load.
  const motors = (await page.evaluate(() => (window as any).labTools.read_lab_measurements.execute({}))).motors as Record<string, { omega: number }>;
  const speeds = Object.values(motors).map(m => m.omega * 30 / Math.PI);
  expect(speeds).toHaveLength(3);
  for (const speed of speeds) expect(speed).toBeGreaterThan(1480);
  // Stop the drive from the inspector: it ramps down and switches its output off.
  await page.getByRole('button', { name: 'Run command', exact: true }).click();
  await advance(page, 10);
  await expect(page.getByTestId('drive-note')).toContainText('Output off');
  await page.getByRole('button', { name: 'Event log', exact: true }).click();
  await expect(page.locator('.event-log')).not.toContainText('tripped');
  expect(errors).toEqual([]);
});
