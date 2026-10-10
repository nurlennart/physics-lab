import { test, expect, type Page } from "@playwright/test";
async function commit(page: Page, label: string, value: string) {
  const field = page.getByLabel(label, { exact: true });
  await field.fill(value);
  await field.press("Enter");
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-component="tank"]')).toBeVisible();
});
test("sandbox heater scales with derived resistance, presets and adaptive long advance", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator('[data-component="heater"]').click();
  await commit(page, "Nominal heating power", "30k");
  await commit(page, "Nominal voltage", "400");
  const resistance = page.getByLabel("Resistance", { exact: true });
  await expect(resistance).toBeDisabled();
  await expect(resistance).toHaveValue("5.33333");
  await expect(page.locator(".derived-list")).toContainText("Rated current");
  // Only the nominal rating changed: the 2 kW element body (UA 180 W/K) would burn out.
  // The 30 kW bank preset scales immersion conductance and element mass with power.
  await page.getByLabel("Apply component preset").selectOption({ label: "Heating bank 30 kW / 400 V" });
  await expect(page.getByLabel("Immersion conductance (UA)", { exact: true })).toHaveValue("2700");
  await page.locator('[data-component="source"]').click();
  await page.getByLabel("Component variant").selectOption("powerBus");
  await commit(page, "Voltage setpoint", "400");
  await expect(page.locator(".rating-bar").first()).toContainText("A");
  await page.locator('[data-component="tank"]').click();
  await page.getByLabel("Apply component preset").selectOption({ label: "Process tank 2,000 L" });
  await expect(page.getByLabel("Initial water volume", { exact: true })).toHaveValue("2000");
  await expect(page.locator(".advance-mode")).toHaveText("ADAPTIVE");
  await page.getByLabel("Advance by").selectOption("3600");
  await expect(page.getByRole("button", { name: "Advance 60 s" })).toBeEnabled({ timeout: 30000 });
  await expect(page.locator(".simulation-clock strong")).toHaveText("01:00:00.00");
  const temperature = Number(await page.locator(".primary-reading span").textContent());
  // ≈ 29.7 kW for 1 h into 2,000 L water + 150 kJ/K steel: about +12.5 K.
  expect(temperature).toBeGreaterThan(31.5);
  expect(temperature).toBeLessThan(33.5);
  expect(errors).toEqual([]);
});
test("custom presets are saved and reused; challenges keep catalog ratings locked", async ({ page }) => {
  await page.locator('[data-component="heater"]').click();
  await commit(page, "Nominal heating power", "6k");
  await page.getByLabel("Preset name").fill("Stage element 6 kW");
  await page.getByRole("button", { name: "Save as preset" }).click();
  await expect(page.getByRole("status")).toContainText("Stage element 6 kW");
  await page.getByRole("button", { name: "Reset to defaults" }).click();
  await expect(page.getByLabel("Nominal heating power", { exact: true })).toHaveValue("2000");
  await page.getByLabel("Apply component preset").selectOption({ label: "Stage element 6 kW" });
  await expect(page.getByLabel("Nominal heating power", { exact: true })).toHaveValue("6000");
  await page.getByRole("button", { name: /Challenges/ }).click();
  await page.getByRole("button", { name: "Start assignment" }).nth(1).click();
  await page.getByRole('button', { name: 'Let’s build' }).click();
  await page.locator('.library-component').filter({ has: page.getByText('Immersion heater', { exact: true }) }).click();
  await page.locator('[data-component="heater"]').click();
  await expect(page.getByLabel("Nominal heating power", { exact: true })).toBeDisabled();
  await expect(page.locator(".lock-reason").first()).toContainText("catalog");
  await expect(page.getByLabel("Apply component preset")).toBeVisible();
});
test("environment and live-versus-reset editing are explained", async ({ page }) => {
  await page.locator('[data-component="tank"]').click();
  await page.getByRole("button", { name: "Advance 60 s" }).click();
  await expect(page.getByRole("button", { name: "Advance 60 s" })).toBeEnabled();
  await expect(page.getByLabel("Initial water volume", { exact: true })).toBeDisabled();
  await expect(page.locator(".inspector")).toContainText("reset the experiment to edit");
  await expect(page.getByLabel("Ambient temperature", { exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "New empty experiment" }).click();
  await expect(page.getByLabel("Laboratory ambient temperature")).toBeVisible();
});
test("new protection, thermal, hydraulic, automation and three-phase components render and configure", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "New empty experiment" }).click();
  // Added last, the breaker stays selected (library placement may overlap symbols).
  for (const name of ["Motor-protective breaker", "Thermal mass / heat sink", "Heat exchanger", "Pressure-reducing valve", "Three-phase supply", "First-order filter", "Signal selector", "Circuit breaker"]) {
    await page.getByLabel("Search component library").fill(name);
    await page.getByRole("button", { name: new RegExp(name.replace(/[/()]/g, ".")) }).first().click();
    await expect(page.locator(".inspector h3").first()).toHaveText(name);
  }
  await page.getByLabel("Search component library").fill("");
  await expect(page.locator(".inspector")).toContainText("PROTECTION STATE");
  await expect(page.getByRole("button", { name: "Re-close after trip" })).toBeDisabled();
  await expect(page.locator(".derived-list")).toContainText("Trip time at 3 × In");
  expect(errors).toEqual([]);
});
