import type { Page } from '@playwright/test';
export async function openExample(page: Page, title: string) {
  await page.locator('.file-menu > summary').click();
  await page.getByRole('button', { name: 'Starters & examples', exact: true }).click();
  await page.getByRole('button', { name: `Open ${title}`, exact: true }).click();
}
export async function addMissionEquipment(page: Page, mode: 'light' | 'heat' | 'transfer') {
  await page.getByRole('button', { name: 'Let’s build' }).click();
  const canvas = page.locator('.construction-canvas');
  const kit = mode === 'transfer'
    ? [['DC power supply', 80, 110], ['DC motor', 320, 110], ['Centrifugal pump', 320, 370], ['Pipe', 570, 370], ['Manual valve', 800, 370]] as const
    : [['DC power supply', 100, 160], ['Switch', 360, 90], [mode === 'heat' ? 'Immersion heater' : 'Filament lamp', 630, 160]] as const;
  for (const [label, x, y] of kit) {
    await page.locator('.library-component').filter({ has: page.getByText(label, { exact: true }) }).dragTo(canvas, { targetPosition: { x, y } });
    if (label === 'DC power supply' && mode === 'heat') {
      await page.getByLabel('Voltage setpoint', { exact: true }).fill('240');
      await page.getByLabel('Voltage setpoint', { exact: true }).press('Enter');
    }
  }
  await page.getByRole('button', { name: 'Fit experiment', exact: true }).first().click();
}
