import type { Page } from '@playwright/test';
export async function openExample(page: Page, title: string) {
  await page.locator('.file-menu > summary').click();
  await page.getByRole('button', { name: 'Starters & examples', exact: true }).click();
  await page.getByRole('button', { name: `Open ${title}`, exact: true }).click();
}
export async function addMissionEquipment(page: Page, mode: 'light' | 'heat' | 'transfer' | 'runaway') {
  await page.getByRole('button', { name: 'Let’s build' }).click();
  const canvas = page.locator('.construction-canvas');
  if (mode === 'runaway') {
    // Seven parts: zoom out so terminals of neighbouring symbols cannot overlap, then lay the kit
    // out in a row above and a row below the fixed process vessel.
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    const box = (await canvas.boundingBox())!, tank = (await page.locator('[data-component="tank"]').boundingBox())!;
    // Drop positions are symbol centres. Rows sit just above and below the fixed vessel, clear of the
    // floating toolbar and of the panels at the canvas edges; 190 px pitch leaves terminals apart.
    const above = Math.max(80, tank.y - box.y - 95), below = Math.min(box.height - 60, tank.y - box.y + tank.height + 60);
    const kit = [['DC power supply', 110, above], ['Control relay', 300, above], ['Independent cutoff', 490, above], ['Immersion heater', 680, above], ['Temperature sensor', 110, below], ['Hysteresis controller', 300, below], ['Cooling jacket', 680, below]] as const;
    for (const [label, x, y] of kit) {
      await page.locator('.library-component').filter({ has: page.getByText(label, { exact: true }) }).dragTo(canvas, { targetPosition: { x, y } });
      if (label === 'DC power supply') {
        await page.getByLabel('Voltage setpoint', { exact: true }).fill('240');
        await page.getByLabel('Voltage setpoint', { exact: true }).press('Enter');
      }
      if (label === 'Independent cutoff' || label === 'Temperature sensor')
        await page.getByLabel('Thermal target', { exact: true }).selectOption({ label: 'TK-01 · Water tank · mixed water + vessel temperature' });
    }
    return;
  }
  const kit = mode === 'transfer'
    ? [['DC power supply', 80, 110], ['DC motor', 320, 110], ['Centrifugal pump', 320, 370], ['Pipe', 570, 370], ['Manual valve', 800, 370]] as const
    : [['DC power supply', 100, 160], ['Switch', 360, 90], [mode === 'heat' ? 'Immersion heater' : 'Filament lamp', 630, 160]] as const;
  // Kit coordinates were laid out for a 924 px stage; scale them to the actual stage width.
  const stage = (await canvas.boundingBox())!, fit = Math.min(1, (stage.width - 60) / 860);
  for (const [label, x, y] of kit) {
    await page.locator('.library-component').filter({ has: page.getByText(label, { exact: true }) }).dragTo(canvas, { targetPosition: { x: x * fit, y } });
    if (label === 'DC power supply' && mode === 'heat') {
      await page.getByLabel('Voltage setpoint', { exact: true }).fill('240');
      await page.getByLabel('Voltage setpoint', { exact: true }).press('Enter');
    }
  }
  await page.getByRole('button', { name: 'Fit experiment', exact: true }).first().click();
}
