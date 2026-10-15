import { openExample, addMissionEquipment } from "./learning-helpers";
import { test, expect, type Page } from "@playwright/test";
const port = (p: Page, name: string) => p.locator(`[data-port="${name}"]`);
async function wire(p: Page, a: string, b: string) {
  await port(p, a).click();
  await port(p, b).click();
}
async function startChallenge(p: Page, index: number) {
  await p.getByRole("button", { name: /Challenges/ }).click();
  await p.getByRole("button", { name: "Start assignment" }).nth(index).click();
}
async function wireCircuit(p: Page, load: string) {
  await wire(p, "PS-01:a", "S-01:a");
  await wire(p, "S-01:b", `${load}:a`);
  await wire(p, `${load}:b`, "PS-01:b");
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-component="tank"]')).toBeVisible();
});
test("heats, pauses, resets and preserves energy", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const time = await page.locator(".simulation-clock strong").textContent();
  await page.waitForTimeout(150);
  expect(await page.locator(".simulation-clock strong").textContent()).toBe(
    time,
  );
  await page.getByRole("button", { name: "Advance 60 s" }).click();
  await expect(
    page.getByRole("button", { name: "Advance 60 s" }),
  ).toBeEnabled();
  await expect(page.locator(".primary-reading")).not.toContainText("20.00");
  await page.getByRole("button", { name: "Energy balance" }).click();
  await expect(page.locator(".energy-error")).toContainText(
    "Conservation residual",
  );
  await page.getByRole("button", { name: "Reset simulation" }).click();
  await expect(page.locator(".primary-reading")).toContainText("20.00");
  await expect(page.locator(".simulation-clock strong")).toHaveText(
    "00:00:00.00",
  );
  expect(errors).toEqual([]);
});
test("builds a functioning light circuit and completes challenge 001", async ({
  page,
}) => {
  await startChallenge(page, 0);
  await addMissionEquipment(page, "light");
  await expect(page.locator(".status-footer")).toContainText("0 connections");
  await wireCircuit(page, "L-01");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator(".challenge-strip")).toContainText("3 stars · 100/100", {
    timeout: 15000,
  });
  await expect(page.locator('[data-component="lamp"] .face-state')).toHaveText("Illuminated");
  await page.locator('[data-component="switch"]').dblclick();
  await expect(page.locator('[data-component="lamp"] .face-state')).toHaveText("Unpowered");
});
test("builds and completes heating challenge 002 using real fixed steps", { tag: "@slow" }, async ({
  page,
}) => {
  test.setTimeout(180000);
  await startChallenge(page, 1);
  await addMissionEquipment(page, "heat");
  await wireCircuit(page, "H-01");
  await wire(page, "H-01:heat", "TK-01:heat");
  for (let i = 0; i < 25; i++) {
    await page.getByRole("button", { name: "Advance 60 s" }).click();
    await expect(
      page.getByRole("button", { name: "Advance 60 s" }),
    ).toBeEnabled({ timeout: 30000 });
    if (
      (await page.locator(".challenge-strip").textContent())?.includes("stars")
    )
      break;
  }
  await expect(page.locator(".challenge-strip")).toContainText("3 stars");
  await expect(
    page.locator('[data-component="tank"] .tank-number'),
  ).toContainText("80.00");
});
test("validates connections and supports editing, undo, zoom and drag placement", async ({
  page,
}) => {
  await wire(page, "PS-01:a", "TK-01:heat");
  await expect(page.getByRole("status")).toContainText(
    "Electrical and thermal terminals cannot",
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: /Resistor/ })
    .first()
    .dragTo(page.locator(".construction-canvas"), {
      targetPosition: { x: 220, y: 230 },
    });
  await expect(page.locator('[data-component="resistor"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Duplicate selected" }).click();
  await expect(page.locator('[data-component="resistor"]')).toHaveCount(2);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator('[data-component="resistor"]')).toHaveCount(1);
  await page.locator('[data-component="resistor"]').click();
  await page.getByRole("button", { name: "Rotate selected" }).click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(page.locator(".zoom-controls")).not.toContainText("95%");
  await page.getByRole("button", { name: "Delete selected" }).click();
  await expect(page.locator('[data-component="resistor"]')).toHaveCount(0);
});
test("saves, imports, rejects invalid files, and exports measured CSV", async ({
  page,
}) => {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toMatch(/physics.json$/);
  const path = await saved.path();
  expect(path).toBeTruthy();
  await page.getByRole("button", { name: "New empty experiment" }).click();
  await expect(page.locator(".empty-canvas")).toBeVisible();
  await page.locator("input[type=file]").setInputFiles(path!);
  await expect(page.locator('[data-component="tank"]')).toBeVisible();
  await expect(page.locator(".status-footer")).toContainText("4 connections");
  await page.locator("input[type=file]").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":99}'),
  });
  await expect(page.getByRole("status")).toContainText(
    "Unsupported project version",
  );
  await page.getByRole("button", { name: "Advance 60 s" }).click();
  await expect(
    page.getByRole("button", { name: "Advance 60 s" }),
  ).toBeEnabled();
  const csvPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  expect((await csvPromise).suggestedFilename()).toContain("measurements.csv");
});
test("replays recorded user input and recovers identical thermal state", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Advance 60 s" }).click();
  await expect(
    page.getByRole("button", { name: "Advance 60 s" }),
  ).toBeEnabled();
  await page.locator('[data-component="switch"]').dblclick();
  await page.getByRole("button", { name: "Advance 60 s" }).click();
  await expect(
    page.getByRole("button", { name: "Advance 60 s" }),
  ).toBeEnabled();
  const before = await page
    .locator('[data-component="tank"] .tank-number')
    .textContent();
  await page.getByRole("button", { name: /Event log/ }).click();
  await page.getByRole("button", { name: "Replay experiment" }).click();
  expect(
    await page.locator('[data-component="tank"] .tank-number').textContent(),
  ).toBe(before);
  await expect(page.locator(".event-log")).toContainText(
    "Deterministic replay completed",
  );
});
test("registers browser tools against the interface contract and validates inputs", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const registry: Record<string, unknown> = {};
    Object.assign(window, { labTools: registry });
    Object.defineProperty(document, "modelContext", {
      value: {
        registerTool: (
          tool: { name: string },
          opts: { signal: AbortSignal },
        ) => {
          registry[tool.name] = tool;
          opts.signal.addEventListener(
            "abort",
            () => delete registry[tool.name],
          );
        },
      },
    });
  });
  await page.reload();
  await page.waitForFunction(
    () =>
      Object.keys((window as unknown as { labTools: object }).labTools ?? {})
        .length === 3,
  );
  const result = await page.evaluate(async () => {
    const tools = (
      window as unknown as {
        labTools: Record<
          string,
          {
            execute: (input: unknown) => Record<string, unknown>;
            inputSchema: object;
          }
        >;
      }
    ).labTools;
    const before = tools.read_lab_measurements.execute({});
    await tools.advance_lab_simulation.execute({ seconds: 1 });
    const after = tools.read_lab_measurements.execute({});
    let invalid = false;
    try {
      await tools.advance_lab_simulation.execute({ seconds: -1 });
    } catch {
      invalid = true;
    }
    return {
      before: before.time,
      after: after.time,
      invalid,
      count: Object.keys(tools).length,
    };
  });
  expect(result.count).toBe(3);
  expect(result.before).toBe(0);
  expect(result.after).toBeCloseTo(1, 6);
  expect(result.invalid).toBe(true);
  await expect(page.locator(".simulation-clock strong")).toHaveText(
    "00:00:01.00",
  );
});
test("mobile workspace remains usable without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".construction-canvas")).toBeVisible();
  expect(await page.evaluate(() => document.body.scrollWidth)).toBe(390);
  await page.getByRole("button", { name: "Toggle component library" }).click();
  await expect(
    page.getByRole("heading", { name: "Component library" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Toggle component library" }).click();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
});
test("closed-loop starter exposes actual faults, probes, independent safety and replay", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openExample(page, "A heater that thinks");
  await expect(page.locator(".status-footer")).toContainText("8 connections");
  await page.locator('[data-component="sensor"]').click();
  await expect(page.locator(".primary-reading")).toContainText("20.00");
  await page.getByRole("button", { name: "Advance 60 s" }).click();
  await expect(
    page.getByRole("button", { name: "Advance 60 s" }),
  ).toBeEnabled();
  await expect(page.getByLabel("Thermal target")).toBeDisabled();
  if (!(await page.getByLabel("Inject component fault").isVisible()))
    await page
      .locator("summary")
      .filter({ hasText: "Experiment faults" })
      .click();
  await page.getByLabel("Inject component fault").selectOption("sensorFault");
  await expect(page.locator('[data-component="relay"] .face-value')).toHaveText("Open");
  await expect(page.locator(".trace-readouts")).toContainText("0.000 W");
  await page.locator('[data-component="relay"]').click();
  if (!(await page.getByLabel("Inject component fault").isVisible()))
    await page
      .locator("summary")
      .filter({ hasText: "Experiment faults" })
      .click();
  await page.getByLabel("Inject component fault").selectOption("stuckClosed");
  await expect(page.locator('[data-component="relay"] .face-value')).toHaveText("Closed");
  await page.locator('[data-component="safety"]').click();
  if (!(await page.getByLabel("Inject component fault").isVisible()))
    await page
      .locator("summary")
      .filter({ hasText: "Experiment faults" })
      .click();
  await page.getByLabel("Inject component fault").selectOption("sensorFault");
  await expect(page.locator('[data-component="safety"] .face-value')).toHaveText("Tripped / latched");
  await expect(page.locator(".trace-readouts")).toContainText("0.000 W");
  await page.getByRole("button", { name: /Event log/ }).click();
  await page.getByRole("button", { name: "Replay experiment" }).click();
  await expect(page.locator(".event-log")).toContainText(
    "Deterministic replay completed",
  );
  await expect(page.locator('[data-component="safety"] .face-value')).toHaveText("Tripped / latched");
  await page.getByRole("button", { name: "Live telemetry" }).click();
  await page.getByRole("button", { name: "Manage traces" }).click();
  await page.getByLabel("Trace component").selectOption({ label: "RY-01" });
  await page.getByLabel("Chart measurement").selectOption("current");
  await page.getByRole("button", { name: "Add trace", exact: true }).click();
  await expect(page.locator(".probe-row")).toHaveCount(4);
  expect(errors).toEqual([]);
});
test("connected duplication, undo, reusable assemblies and node probes preserve topology", async ({
  page,
}) => {
  await openExample(page, "A heater that thinks");
  await page.keyboard.press("Control+a");
  await page.getByRole("button", { name: "Duplicate selected" }).click();
  await expect(page.locator(".status-footer")).toContainText("16 connections");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".status-footer")).toContainText("8 connections");
  await page.keyboard.press("Control+a");
  await page.locator("input[name=assembly]").fill("Protected heater");
  await page.getByRole("button", { name: "Save selection" }).click();
  await page.getByRole("button", { name: "Insert Protected heater" }).click();
  await expect(page.locator(".status-footer")).toContainText("16 connections");
  await page.getByRole("button", { name: "Node measurement mode" }).click();
  await port(page, "PS-01:b").click();
  await port(page, "H-01:a").click();
  await expect(page.locator(".trace-readouts")).toContainText("nodeVoltage");
});
test("wires expose movable orthogonal bends and maintain connection endpoints", async ({
  page,
}) => {
  const wire = page.locator(".wire-hit").first();
  const before = await wire.getAttribute("d");
  const point = await wire.evaluate((el) => {
    const path = el as SVGPathElement,
      m = path.getScreenCTM()!;
    for (let i = 1; i < 20; i++) {
      const p = path.getPointAtLength((path.getTotalLength() * i) / 20),
        q = new DOMPoint(p.x, p.y).matrixTransform(m);
      if (document.elementFromPoint(q.x, q.y) === path)
        return { x: q.x, y: q.y };
    }
    throw Error("No visible wire hit segment");
  });
  await page.mouse.click(point.x, point.y);
  await expect(page.locator(".bend-handle").first()).toBeVisible();
  const handle = page.locator(".bend-handle").first(),
    box = await handle.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + 6, box!.y + 6);
  await page.mouse.down();
  await page.mouse.move(box!.x + 35, box!.y + 40, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator(".status-footer")).toContainText("4 connections");
  await expect(wire).not.toHaveAttribute("d", before!);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(wire).toHaveAttribute("d", before!);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(wire).not.toHaveAttribute("d", before!);
});
test("plays Thermal Runaway through wiring, physical fault, safety latch and manual recovery", { tag: "@slow" }, async ({
  page,
}) => {
  test.setTimeout(240000);
  await startChallenge(page, 2);
  await addMissionEquipment(page, "runaway");
  for (const [a, b] of [
    ["PS-01:a", "RY-01:a"],
    ["RY-01:b", "ST-01:a"],
    ["ST-01:b", "H-01:a"],
    ["H-01:b", "PS-01:b"],
    ["H-01:heat", "TK-01:heat"],
    ["TS-01:out", "HC-01:in"],
    ["HC-01:out", "RY-01:in"],
    ["CJ-01:heat", "TK-01:heat"],
  ])
    await wire(page, a, b);
  await page.locator('[data-component="tank"]').click();
  await expect(page.getByLabel("Ambient environment", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Ambient environment", { exact: true })).toHaveValue("inherit");
  await expect(page.getByLabel("Ambient temperature", { exact: true })).toHaveCount(0);
  let reset = false;
  for (let i = 0; i < 65; i++) {
    await page.getByRole("button", { name: "Advance 60 s" }).click();
    await expect(
      page.getByRole("button", { name: "Advance 60 s" }),
    ).toBeEnabled({ timeout: 60000 });
    const text = await page.locator(".challenge-strip").textContent();
    if (text?.includes("stars")) break;
    if (text?.includes("recovery") && !reset) {
      const temp = Number(
        (await page.locator(".tank-number").textContent())
          ?.replace("°C", "")
          .trim(),
      );
      if (temp <= 85) {
        await page.locator('[data-component="safety"]').click();
        await page
          .getByRole("button", { name: "Manually reset safety latch" })
          .click();
        reset = true;
      }
    }
  }
  expect(reset).toBe(true);
  await expect(page.locator(".challenge-strip")).toContainText("stars");
  await page.getByRole("button", { name: /Event log/ }).click();
  await expect(page.locator(".event-log")).toContainText(
    "independent cutoff interrupted",
  );
  await expect(page.locator(".event-log")).toContainText(
    "safety latch manually reset",
  );
});
