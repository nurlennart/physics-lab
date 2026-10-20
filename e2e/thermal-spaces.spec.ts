import { test, expect } from '@playwright/test';
import { openExample } from './learning-helpers';

test('draw, edit, resize, undo and chart a physical thermal room', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await page.getByRole('button', { name: 'New empty experiment', exact: true }).click();
  const canvas = page.locator('.construction-canvas'), box = (await canvas.boundingBox())!;
  await page.getByRole('button', { name: 'Draw Thermal Space', exact: true }).click();
  await page.mouse.move(box.x + 100, box.y + 110); await page.mouse.down(); await page.mouse.move(box.x + 500, box.y + 410, { steps: 8 }); await page.mouse.up();
  await expect(page.getByTestId('thermal-space')).toHaveCount(1);
  await expect(page.getByLabel('Room width', { exact: true })).toHaveValue('4');
  await page.getByLabel('Room width', { exact: true }).fill('5'); await page.getByLabel('Room width', { exact: true }).press('Enter');
  await expect(page.getByLabel('Room width', { exact: true })).toHaveValue('5');
  await page.getByLabel('Internal heat gain', { exact: true }).fill('1000'); await page.getByLabel('Internal heat gain', { exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Chart roomTemperature', exact: true }).click();
  const resize = page.getByRole('button', { name: 'Resize Room 1', exact: true }), r = (await resize.boundingBox())!;
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await page.mouse.down(); await page.mouse.move(r.x + r.width / 2 - 40, r.y + r.height / 2, { steps: 5 }); await page.mouse.up();
  await expect(page.getByLabel('Room width', { exact: true })).not.toHaveValue('5');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Select Room 1', exact: true }).click();
  await expect(page.getByLabel('Room width', { exact: true })).toHaveValue('5');
  await page.getByRole('button', { name: 'Advance 60 s', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Advance 60 s', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Room width', { exact: true })).toBeDisabled();
  await expect(page.locator('.room-temperature strong')).not.toContainText('20.00');
  await expect(page.locator('.trace-readouts')).toContainText('roomTemperature');
  expect(errors).toEqual([]);
});

test('native heating example retains wiring and room assignment through configuration save/load', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await openExample(page, 'Heated living room');
  await expect(page.getByTestId('thermal-space')).toHaveCount(1);
  await page.locator('[data-component="panelRadiator"]').click();
  await expect(page.getByLabel('Assigned Thermal Space', { exact: true })).not.toHaveValue('');
  const ports = page.locator('[data-component="panelRadiator"] [data-port]');
  await ports.first().click(); await page.keyboard.press('Escape');
  await expect(page.locator('[data-component="panelRadiator"]')).toBeVisible();
  await page.getByRole('button', { name: 'Select Living Room', exact: true }).click();
  await expect(page.getByLabel('Initial air temperature', { exact: true })).toHaveValue('15');
  await page.screenshot({ path: '/tmp/thermal-spaces-preview.png' });
  await page.getByLabel('Outdoor temperature', { exact: true }).fill('-5'); await page.getByLabel('Outdoor temperature', { exact: true }).press('Enter');
  await page.locator('.file-menu > summary').click();
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export scenario configuration', exact: true }).click();
  const download = await pending, path = (await download.path())!;
  await page.locator('input[type=file]').first().setInputFiles(path);
  await expect(page.getByTestId('thermal-space')).toHaveCount(1);
  await page.getByRole('button', { name: 'Select Living Room', exact: true }).click();
  await expect(page.getByLabel('Outdoor temperature', { exact: true })).toHaveValue('-5');
  await page.locator('[data-component="panelRadiator"]').click();
  await expect(page.getByLabel('Assigned Thermal Space', { exact: true })).not.toHaveValue('');
  expect(errors).toEqual([]);
});

test('reverse drawing uses metres consistently after canvas zoom', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'New empty experiment', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  const canvas = page.locator('.construction-canvas'), box = (await canvas.boundingBox())!;
  const transform = (await canvas.locator(':scope > g').first().getAttribute('transform'))!;
  const scale = Number(transform.match(/scale\(([^)]+)\)/)![1]);
  await page.getByRole('button', { name: 'Draw Thermal Space', exact: true }).click();
  await page.mouse.move(box.x + 400, box.y + 330); await page.mouse.down(); await page.mouse.move(box.x + 100, box.y + 130, { steps: 8 }); await page.mouse.up();
  expect(Number(await page.getByLabel('Room width', { exact: true }).inputValue())).toBeCloseTo(3 / scale, 6);
  expect(Number(await page.getByLabel('Room length', { exact: true }).inputValue())).toBeCloseTo(2 / scale, 6);
  const caption = (await page.getByRole('button', { name: 'Select Room 1', exact: true }).boundingBox())!;
  const beforePan = await canvas.locator(':scope > g').first().getAttribute('transform');
  await page.keyboard.down('Space'); await page.mouse.move(caption.x + 20, caption.y + 20); await page.mouse.down(); await page.mouse.move(caption.x + 60, caption.y + 40, { steps: 5 }); await page.mouse.up(); await page.keyboard.up('Space');
  expect(await canvas.locator(':scope > g').first().getAttribute('transform')).not.toBe(beforePan);
  expect(Number(await page.getByLabel('Room width', { exact: true }).inputValue())).toBeCloseTo(3 / scale, 6);
});

test('a floor rests on the ground: ISO 13370 U-value, fixed ground temperature and ground loss', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await page.getByRole('button', { name: 'New empty experiment', exact: true }).click();
  const canvas = page.locator('.construction-canvas'), box = (await canvas.boundingBox())!;
  await page.getByRole('button', { name: 'Draw Thermal Space', exact: true }).click();
  await page.mouse.move(box.x + 100, box.y + 110); await page.mouse.down(); await page.mouse.move(box.x + 500, box.y + 410, { steps: 8 }); await page.mouse.up();
  await expect(page.getByTestId('ground-hint')).toHaveCount(0);
  // Walls cannot rest on the ground; the floor can.
  await expect(page.getByLabel('North adjacency', { exact: true }).locator('option[value="ground"]')).toHaveCount(0);
  await page.getByLabel('Floor adjacency', { exact: true }).selectOption('ground');
  await expect(page.getByTestId('ground-hint')).toContainText('assumed default 10 °C');
  await expect(page.getByLabel('Floor U-value', { exact: true })).toBeEnabled(); // entered U until R_f is given
  await page.getByLabel('Floor U-value source', { exact: true }).selectOption('iso');
  await expect(page.getByLabel('Floor U-value', { exact: true })).toBeDisabled();
  // 4 × 3 m room: B′ = 12/7 m; R_f 3 → d_t 6.72 m ≥ B′ → U = 2/(0.457·12/7 + 6.72) = 0.2665 W/(m²·K).
  await expect(page.getByTestId('slab-basis')).toContainText('B′ = A/(½P) = 1.71 m');
  await expect(page.getByLabel('Floor U-value', { exact: true })).toHaveValue('0.2665');
  await page.getByLabel('Ground temperature', { exact: true }).fill('7'); await page.getByLabel('Ground temperature', { exact: true }).press('Enter');
  await expect(page.getByTestId('ground-hint')).not.toContainText('assumed default');
  await page.getByRole('button', { name: 'Advance 60 s', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Advance 60 s', exact: true })).toBeEnabled();
  // 20 °C room over 7 °C ground through 12 m² at 0.2665 W/(m²·K): about 41.6 W.
  await expect(page.locator('.room-reading', { hasText: 'ground Loss' }).locator('b')).toContainText(/^41\.[4-6]/);
  expect(errors).toEqual([]);
});

test('a temperature sensor on a room names the room on its face', async ({ page }) => {
  await page.goto('/'); await openExample(page, 'Heated living room');
  await page.locator('.library-component').filter({ has: page.getByText('Temperature sensor', { exact: true }) }).click();
  const sensor = page.locator('[data-component="sensor"]').last();
  await expect(sensor).toContainText('No target');
  await page.getByLabel('Thermal target', { exact: true }).selectOption({ label: 'Living Room · room air temperature' });
  await expect(sensor).toContainText('→ Living Room');
  await expect(sensor).not.toContainText('No target');
});
