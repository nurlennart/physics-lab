import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
const bundle = await build({
  entryPoints: ["src/simulation/validation.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { runValidation } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0].text).toString("base64")
);
const rows = runValidation();
const report = {
  executedAt: new Date().toISOString(),
  timestepSeconds: 1 / 60,
  passed: rows.filter((r) => r.pass).length,
  total: rows.length,
  results: rows,
};
await mkdir("validation", { recursive: true });
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
