import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const bundle = await build({
  stdin: { contents: 'export { runValidation } from "./src/simulation/validation"; export { runHydraulicValidation } from "./src/simulation/hydraulic-validation"; export { runSpatialValidation } from "./src/simulation/spatial-validation";', resolveDir: process.cwd() },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { runValidation, runHydraulicValidation, runSpatialValidation } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0].text).toString("base64")
);
const rows = [...runValidation(), ...runHydraulicValidation(), ...runSpatialValidation()];
const report = {
  executedAt: new Date().toISOString(),
  timestepSeconds: 1 / 60,
  passed: rows.filter((r) => r.pass).length,
  total: rows.length,
  results: rows,
};
await mkdir("validation", { recursive: true });
// Unchanged results keep the committed report (and its timestamp), so re-running the gate leaves the tree clean.
const previous = await readFile("validation/latest.json", "utf8").then(JSON.parse, () => null);
const unchanged = previous && JSON.stringify(previous.results) === JSON.stringify(JSON.parse(JSON.stringify(rows)));
if (unchanged) { report.executedAt = previous.executedAt; if ("wallSeconds" in previous) report.wallSeconds = previous.wallSeconds; }
await writeFile(
  "validation/latest.json",
  JSON.stringify(report, null, 2) + "\n",
);
await writeFile(
  "validation/latest.md",
  `# Executed physics validation\n\nExecuted: ${report.executedAt}. ${report.passed}/${report.total} checks passed.\n\n| Experiment | Domain | Expected | Measured | Absolute error | Relative error | Tolerance | Result | Assumptions |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n` +
    rows
      .map(
        (r) =>
          `| ${r.name} | ${r.domain} | ${r.expected} | ${r.measured} | ${r.absoluteError.toExponential(3)} | ${r.relativeError === null ? "—" : r.relativeError.toExponential(3)} | ${r.tolerance} | ${r.pass ? "PASS" : "FAIL"} | ${r.assumptions} |`,
      )
      .join("\n") +
    "\n",
);
for (const r of rows)
  console.log(
    `${r.pass ? "PASS" : "FAIL"} ${r.name}: measured ${r.measured}, expected ${r.expected}, |error| ${r.absoluteError.toExponential(3)} ≤ ${r.tolerance}`,
  );
console.log(
  `Validation: ${report.passed}/${report.total}. Reports: validation/latest.json and validation/latest.md`,
);
if (report.passed !== report.total) process.exitCode = 1;
