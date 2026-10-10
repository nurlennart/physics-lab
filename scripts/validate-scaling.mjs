import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
const bundle = await build({
  stdin: { contents: 'export { runScalingValidation } from "./src/simulation/scaling-validation";', resolveDir: process.cwd() },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
let rows, started;
try {
  const { runScalingValidation } = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
  started = performance.now();
  rows = runScalingValidation();
} catch (e) {
  // Keep the bundled source (a data: URL) out of the console.
  console.error(String(e?.message ?? e).slice(0, 1000));
  console.error(String(e?.stack ?? "").split("\n").slice(1, 10).map((l) => l.replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, "<bundle>")).join("\n"));
  process.exit(1);
}
const report = {
  executedAt: new Date().toISOString(),
  wallSeconds: Number(((performance.now() - started) / 1000).toFixed(2)),
  passed: rows.filter((r) => r.pass).length,
  total: rows.length,
  results: rows,
};
await mkdir("validation", { recursive: true });
await writeFile("validation/scaling.json", JSON.stringify(report, null, 2) + "\n");
await writeFile(
  "validation/scaling.md",
  `# Executed scale-validation campaign\n\nExecuted: ${report.executedAt}. ${report.passed}/${report.total} checks passed in ${report.wallSeconds} s wall time.\n\n| Experiment | Domain | Expected | Measured | Absolute error | Relative error | Tolerance | Result | Assumptions |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n` +
    rows.map((r) => `| ${r.name} | ${r.domain} | ${Number(r.expected.toPrecision(8))} | ${Number(r.measured.toPrecision(8))} | ${r.absoluteError.toExponential(3)} | ${r.relativeError === null ? "—" : r.relativeError.toExponential(3)} | ${r.tolerance} | ${r.pass ? "PASS" : "FAIL"} | ${r.assumptions} |`).join("\n") + "\n",
);
for (const r of rows) console.log(`${r.pass ? "PASS" : "FAIL"} ${r.name}: measured ${Number(r.measured.toPrecision(8))}, expected ${Number(r.expected.toPrecision(8))}`);
console.log(`${report.passed}/${report.total} passed in ${report.wallSeconds} s`);
if (report.passed !== report.total) process.exitCode = 1;
